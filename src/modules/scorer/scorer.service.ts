import { Injectable } from '@nestjs/common';
import { Logger } from '../../utils/logger';

export interface AgentScore {
  address: string;
  taskCount: number;
  uptimeSeconds: number;
  responseScore: number;
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

  calculateScore(
    taskCount: number,
    uptimeSeconds: number,
    responseScore: number,
  ): number {
    const TASK_WEIGHT = 50;
    const UPTIME_WEIGHT = 30;
    const RESPONSE_WEIGHT = 20;

    return (
      taskCount * TASK_WEIGHT +
      uptimeSeconds * UPTIME_WEIGHT +
      responseScore * RESPONSE_WEIGHT
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

  getAgentScore(agentAddress: string): AgentScore {
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
    const totalScore = this.calculateScore(taskCount, uptimeSeconds, responseScore);

    return {
      address: agentAddress,
      taskCount,
      uptimeSeconds,
      responseScore,
      totalScore,
    };
  }

  getAllAgentScores(agentAddresses: string[]): AgentScore[] {
    return agentAddresses.map(address => this.getAgentScore(address));
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
