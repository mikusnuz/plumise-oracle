import { Injectable } from '@nestjs/common';
import { Logger } from '../../utils/logger';

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
    const TOKEN_WEIGHT = 40;
    const TASK_WEIGHT = 25;
    const UPTIME_WEIGHT = 20;
    const LATENCY_WEIGHT = 15;

    const tokenScore = Number(processedTokens) / 1000;
    const taskScore = taskCount * TASK_WEIGHT;
    const uptimeScore = uptimeSeconds * UPTIME_WEIGHT;
    const latencyScore = avgLatencyInv * LATENCY_WEIGHT;

    return tokenScore * TOKEN_WEIGHT + taskScore + uptimeScore + latencyScore;
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

    let avgResponseScore = 0;
    if (tasks.length > 0) {
      const totalSolveTime = tasks.reduce((sum, task) => sum + task.solveTime, 0);
      const avgSolveTime = totalSolveTime / tasks.length;
      avgResponseScore = Math.max(0, 100 - avgSolveTime);
    }

    const responseScore = Math.floor(avgResponseScore);

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
