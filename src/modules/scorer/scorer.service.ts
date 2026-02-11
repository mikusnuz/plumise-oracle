import { Injectable } from '@nestjs/common';
import { Logger } from '../../utils/logger';
import { NodesService } from '../nodes/nodes.service';

export interface AgentScore {
  address: string;
  taskCount: number;
  uptimeSeconds: number;
  responseScore: number;
  processedTokens: bigint;
  avgLatencyInv: number;
  totalScore: number;
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

  constructor(private nodesService: NodesService) {}

  setMetricsService(metricsService: any) {
    this.metricsService = metricsService;
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

    const taskScoreNormalized = Math.min(100, (taskCount / EXPECTED_TASKS_PER_EPOCH) * 100);
    const uptimeScoreNormalized = Math.min(100, (uptimeSeconds / EPOCH_DURATION_SECONDS) * 100);
    const responseScoreNormalized = Math.min(100, responseScore);

    return (
      (taskScoreNormalized * TASK_WEIGHT +
        uptimeScoreNormalized * UPTIME_WEIGHT +
        responseScoreNormalized * RESPONSE_WEIGHT) /
      100
    );
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

    let responseScore = 100;
    if (tasks.length > 0) {
      const totalSolveTime = tasks.reduce((sum, task) => sum + task.solveTime, 0);
      const avgSolveTime = totalSolveTime / tasks.length;
      const normalizedSpeed = Math.min(100, Math.max(0, 100 - avgSolveTime / 10));
      responseScore = Math.floor(normalizedSpeed);
    }

    let processedTokens = BigInt(0);
    let avgLatencyInv = 0;

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
