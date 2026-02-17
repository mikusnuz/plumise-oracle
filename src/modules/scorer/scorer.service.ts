import { Injectable } from '@nestjs/common';
import { Logger } from '../../utils/logger';
import { NodesService } from '../nodes/nodes.service';
import { ProofService } from '../proof/proof.service';
import { ChainService } from '../chain/chain.service';

export interface AgentScore {
  address: string;
  taskCount: number;
  uptimeSeconds: number;
  responseScore: number;
  processedTokens: bigint;
  avgLatencyInv: number;
  totalScore: number;
  verifiedTokens?: bigint;
  proofVerificationRate?: number;
}

interface TaskRecord {
  challengeId: number;
  solvedAt: number;
  solveTime: number;
}

@Injectable()
export class ScorerService {
  private logger = new Logger('ScorerService');
  private agentTasks: Map<string, TaskRecord[]> = new Map();
  private agentUptimes: Map<string, number> = new Map();
  private epochStartTime: number = Date.now();
  private metricsService: any;
  private chainService: ChainService;

  constructor(
    private nodesService: NodesService,
    private proofService: ProofService,
  ) {}

  setMetricsService(metricsService: any) {
    this.metricsService = metricsService;
  }

  setChainService(chainService: ChainService) {
    this.chainService = chainService;
  }

  calculateScore(
    taskCount: number,
    uptimeSeconds: number,
    responseScore: number,
    processedTokens: bigint = BigInt(0),
    avgLatencyInv: number = 0,
  ): number {
    const TASK_WEIGHT = 50;
    const UPTIME_WEIGHT = 30;
    const RESPONSE_WEIGHT = 20;

    const EXPECTED_TASKS_PER_EPOCH = 100;
    const EPOCH_DURATION_SECONDS = 3600;

    // Idle penalty: agents with no actual work (no tasks AND no tokens processed)
    // get their uptime/response scores reduced to 10%.
    // This prevents idle agents from earning disproportionate rewards just for being online.
    const hasWork = taskCount > 0 || processedTokens > BigInt(0);
    const IDLE_MULTIPLIER = hasWork ? 1.0 : 0.1;

    const taskScoreNormalized = Math.min(100, (taskCount / EXPECTED_TASKS_PER_EPOCH) * 100);
    const uptimeScoreNormalized = Math.min(100, (uptimeSeconds / EPOCH_DURATION_SECONDS) * 100);
    const responseScoreNormalized = Math.min(100, responseScore);

    return (
      (taskScoreNormalized * TASK_WEIGHT +
        uptimeScoreNormalized * UPTIME_WEIGHT * IDLE_MULTIPLIER +
        responseScoreNormalized * RESPONSE_WEIGHT * IDLE_MULTIPLIER) /
      100
    );
  }

  calculateScoreV3(params: {
    verifiedTokens: number;
    modelMultiplier: number;
    clusterSize: number;
    modelMinMemMb: number;
    nodeMaxMemMb: number;
    successRate: number;
    targetP95ms: number;
    actualP95ms: number;
  }): number {
    const multiplier = params.modelMultiplier / 100;

    const need = Math.max(
      0,
      Math.min(1, (params.modelMinMemMb - params.nodeMaxMemMb) / params.modelMinMemMb),
    );
    const clusterExtra = 0.12 * Math.min(params.clusterSize - 1, 5) * need;
    const clusterBonus = 1 + clusterExtra;

    const ucu = params.verifiedTokens * multiplier * clusterBonus;

    const reliability = Math.pow(Math.max(0, Math.min(1, params.successRate)), 2);

    const latencyFactor = Math.max(0.5, Math.min(1.2, params.targetP95ms / params.actualP95ms));

    return Math.floor(ucu * reliability * latencyFactor);
  }

  recordTask(agentAddress: string, challengeId: number, solveTime: number) {
    const tasks = this.agentTasks.get(agentAddress) || [];
    tasks.push({
      challengeId,
      solvedAt: Date.now(),
      solveTime,
    });
    this.agentTasks.set(agentAddress, tasks);

    this.logger.debug(`Task recorded for ${agentAddress}`, {
      challengeId,
      solveTime,
      totalTasks: tasks.length,
    });
  }

  updateUptime(agentAddress: string, uptimeSeconds: number) {
    this.agentUptimes.set(agentAddress, uptimeSeconds);
  }

  async getAgentScore(agentAddress: string): Promise<AgentScore> {
    const tasks = this.agentTasks.get(agentAddress) || [];
    const taskCount = tasks.length;

    const uptimeSeconds = this.agentUptimes.get(agentAddress) || 0;

    // responseScore: 0 when no tasks (no work = no quality score),
    // calculated from solve speed when tasks exist
    let responseScore = 0;
    if (tasks.length > 0) {
      const totalSolveTime = tasks.reduce((sum, task) => sum + task.solveTime, 0);
      const avgSolveTime = totalSolveTime / tasks.length;
      const normalizedSpeed = Math.min(100, Math.max(0, 100 - avgSolveTime / 10));
      responseScore = Math.floor(normalizedSpeed);
    }

    let processedTokens = BigInt(0);
    let avgLatencyInv = 0;
    let verifiedTokens = BigInt(0);
    let proofVerificationRate = 0;

    if (this.metricsService) {
      try {
        const metrics = await this.metricsService.getAgentMetrics(agentAddress);
        if (metrics) {
          processedTokens = BigInt(metrics.tokensProcessed);
          if (metrics.avgLatencyMs > 0) {
            avgLatencyInv = Math.floor(Math.max(0, 10000 - metrics.avgLatencyMs));
          }
        }
      } catch (error) {
        this.logger.debug(`No inference metrics for ${agentAddress}`);
      }
    }

    if (this.chainService) {
      try {
        const currentEpoch = Number(await this.chainService.getCurrentEpoch());
        const proofStats = await this.proofService.getProofStats(agentAddress, currentEpoch);
        verifiedTokens = BigInt(proofStats.verifiedTokens);
        proofVerificationRate = proofStats.verificationRate;

        if (verifiedTokens > processedTokens) {
          processedTokens = verifiedTokens;
        }
      } catch (error) {
        this.logger.debug(`No proof stats for ${agentAddress}`);
      }
    }

    const totalScore = this.calculateScore(
      taskCount,
      uptimeSeconds,
      responseScore,
      processedTokens,
      avgLatencyInv,
    );

    await this.nodesService.updateNodeScore(agentAddress, totalScore);

    return {
      address: agentAddress,
      taskCount,
      uptimeSeconds,
      responseScore,
      processedTokens,
      avgLatencyInv,
      totalScore,
      verifiedTokens,
      proofVerificationRate,
    };
  }

  async getAllAgentScores(agentAddresses: string[]): Promise<AgentScore[]> {
    return await Promise.all(agentAddresses.map(address => this.getAgentScore(address)));
  }

  resetEpochData() {
    this.logger.log('Resetting epoch data');
    this.agentTasks.clear();
    this.agentUptimes.clear();
    this.epochStartTime = Date.now();
  }

  getEpochStartTime(): number {
    return this.epochStartTime;
  }
}
