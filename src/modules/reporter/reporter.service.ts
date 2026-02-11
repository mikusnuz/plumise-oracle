import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ChainService } from '../chain/chain.service';
import { MonitorService } from '../monitor/monitor.service';
import { ScorerService } from '../scorer/scorer.service';
import { Logger } from '../../utils/logger';
import { chainConfig } from '../../config/chain.config';

@Injectable()
export class ReporterService {
  private logger = new Logger('ReporterService');
  private lastReportBlock: number = 0;

  constructor(
    private chainService: ChainService,
    private monitorService: MonitorService,
    private scorerService: ScorerService,
  ) {}

  @Interval(60000) // Check every minute
  async checkAndReportContributions() {
    try {
      const currentBlock = await this.chainService.getCurrentBlock();

      if (this.lastReportBlock === 0) {
        this.lastReportBlock = currentBlock;
        return;
      }

      const blocksSinceLastReport = currentBlock - this.lastReportBlock;

      if (blocksSinceLastReport >= chainConfig.intervals.reportBlocks) {
        await this.reportAllContributions();
        this.lastReportBlock = currentBlock;
      }
    } catch (error) {
      this.logger.error('Error checking report interval', process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async reportAllContributions() {
    try {
      this.logger.log('Starting contribution reporting for epoch...');

      const activeAgents = this.monitorService.getActiveAgents();

      if (activeAgents.length === 0) {
        this.logger.warn('No active agents to report');
        return;
      }

      this.logger.log(`Reporting contributions for ${activeAgents.length} agents`);

      for (const agent of activeAgents) {
        await this.reportAgentContribution(agent.address);
      }

      this.logger.log('Contribution reporting completed');
      this.scorerService.resetEpochData();
    } catch (error) {
      this.logger.error('Error reporting contributions', process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async reportAgentContribution(agentAddress: string) {
    try {
      const score = await this.scorerService.getAgentScore(agentAddress);

      const tx = await this.chainService.rewardPool.reportContribution(
        agentAddress,
        score.taskCount,
        score.uptimeSeconds,
        score.responseScore,
        score.processedTokens.toString(),
        score.avgLatencyInv,
      );

      this.logger.log(`Contribution reported for ${agentAddress}`, {
        taskCount: score.taskCount,
        uptimeSeconds: score.uptimeSeconds,
        responseScore: score.responseScore,
        processedTokens: score.processedTokens.toString(),
        avgLatencyInv: score.avgLatencyInv,
        txHash: tx.hash,
      });

      await tx.wait();
      this.logger.debug(`Transaction confirmed: ${tx.hash}`);
    } catch (error) {
      this.logger.error(
        `Failed to report contribution for ${agentAddress}`,
        process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }
}
