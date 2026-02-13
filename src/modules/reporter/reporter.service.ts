import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChainService } from '../chain/chain.service';
import { MonitorService } from '../monitor/monitor.service';
import { ScorerService } from '../scorer/scorer.service';
import { Contribution } from '../../entities';
import { Logger } from '../../utils/logger';
import { chainConfig } from '../../config/chain.config';

@Injectable()
export class ReporterService {
  private logger = new Logger('ReporterService');
  private lastReportBlock: number = 0;
  private isRunning: boolean = false; // OR-08 FIX: Prevent job overlap

  constructor(
    @InjectRepository(Contribution)
    private contributionRepo: Repository<Contribution>,
    private chainService: ChainService,
    private monitorService: MonitorService,
    private scorerService: ScorerService,
  ) {}

  @Interval(60000) // Check every minute
  async checkAndReportContributions() {
    // OR-08 FIX: Skip if already running
    if (this.isRunning) {
      this.logger.debug('Skipping report check - previous job still running');
      return;
    }

    this.isRunning = true;
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
    } finally {
      this.isRunning = false;
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

      // OR-04 FIX: Track successful reports, only reset if all succeed
      const successfulAgents: string[] = [];
      const failedAgents: string[] = [];

      for (const agent of activeAgents) {
        const success = await this.reportAgentContribution(agent.address);
        if (success) {
          successfulAgents.push(agent.address);
        } else {
          failedAgents.push(agent.address);
        }
      }

      this.logger.log(`Contribution reporting completed: ${successfulAgents.length} succeeded, ${failedAgents.length} failed`);

      if (failedAgents.length > 0) {
        this.logger.warn(`Failed agents will be retried in next epoch: ${failedAgents.join(', ')}`);
      }

      // Only reset epoch data if ALL agents succeeded
      if (failedAgents.length === 0) {
        this.scorerService.resetEpochData();
        this.logger.log('Epoch data reset after successful reporting for all agents');
      } else {
        this.logger.warn('Epoch data NOT reset due to failures - will retry in next interval');
      }
    } catch (error) {
      this.logger.error('Error reporting contributions', process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async reportAgentContribution(agentAddress: string): Promise<boolean> {
    try {
      const currentEpoch = Number(await this.chainService.getCurrentEpoch());
      const score = await this.scorerService.getAgentScore(agentAddress);

      const txHash = await this.chainService.writeContract({
        address: this.chainService.rewardPool.address,
        abi: this.chainService.rewardPool.abi,
        functionName: 'reportContribution',
        args: [
          agentAddress as `0x${string}`,
          BigInt(score.taskCount),
          BigInt(score.uptimeSeconds),
          BigInt(score.responseScore),
          BigInt(score.processedTokens.toString()),
          BigInt(score.avgLatencyInv),
        ],
      });

      this.logger.log(`Contribution reported for ${agentAddress}`, {
        epoch: currentEpoch,
        taskCount: score.taskCount,
        uptimeSeconds: score.uptimeSeconds,
        responseScore: score.responseScore,
        processedTokens: score.processedTokens.toString(),
        avgLatencyInv: score.avgLatencyInv,
        txHash,
      });

      await this.chainService.publicClient.waitForTransactionReceipt({ hash: txHash });
      this.logger.debug(`Transaction confirmed: ${txHash}`);

      await this.saveContributionToDB(agentAddress, currentEpoch, score);

      return true; // OR-04 FIX: Return success
    } catch (error) {
      this.logger.error(
        `Failed to report contribution for ${agentAddress}`,
        process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error',
      );
      return false; // OR-04 FIX: Return failure
    }
  }

  private async saveContributionToDB(agentAddress: string, epoch: number, score: any) {
    try {
      const wallet = agentAddress.toLowerCase();

      let contribution = await this.contributionRepo.findOne({
        where: { wallet, epoch },
      });

      if (!contribution) {
        contribution = this.contributionRepo.create({
          wallet,
          epoch,
          taskCount: 0,
          uptimeSeconds: 0,
          responseScore: 0,
          processedTokens: '0',
          avgLatencyInv: 0,
          lastUpdated: String(Math.floor(Date.now() / 1000)),
        });
      }

      contribution.taskCount = score.taskCount;
      contribution.uptimeSeconds = score.uptimeSeconds;
      contribution.responseScore = score.responseScore;
      contribution.processedTokens = score.processedTokens.toString();
      contribution.avgLatencyInv = score.avgLatencyInv;
      contribution.lastUpdated = String(Math.floor(Date.now() / 1000));

      await this.contributionRepo.save(contribution);

      this.logger.debug(`Contribution saved to DB for ${wallet}`, {
        epoch,
        taskCount: contribution.taskCount,
        processedTokens: contribution.processedTokens,
      });
    } catch (error) {
      this.logger.error(
        `Failed to save contribution to DB for ${agentAddress}`,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }
}
