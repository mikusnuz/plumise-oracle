import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChainService } from '../chain/chain.service';
import { Contribution } from '../../entities';
import { Logger } from '../../utils/logger';
import { chainConfig } from '../../config/chain.config';

@Injectable()
export class DistributorService {
  private logger = new Logger('DistributorService');
  private lastCheckedEpoch: bigint = 0n;
  private syncService: any;

  constructor(
    @InjectRepository(Contribution)
    private contributionRepo: Repository<Contribution>,
    private chainService: ChainService,
  ) {}

  @Interval(60000) // Check every minute
  async checkAndDistributeRewards() {
    try {
      const currentEpoch = await this.chainService.getCurrentEpoch();

      if (currentEpoch === 0n) {
        return;
      }

      if (this.lastCheckedEpoch === 0n) {
        this.lastCheckedEpoch = currentEpoch;
        return;
      }

      if (currentEpoch > this.lastCheckedEpoch) {
        const previousEpoch = currentEpoch - 1n;
        await this.distributeEpochRewards(previousEpoch);
        this.lastCheckedEpoch = currentEpoch;

        if (this.syncService) {
          try {
            await this.syncService.syncEpoch(previousEpoch);
            await this.syncService.syncEpoch(currentEpoch);
          } catch (error) {
            this.logger.error('Failed to sync epoch to DB', error instanceof Error ? error.message : 'Unknown error');
          }
        }
      }
    } catch (error) {
      this.logger.error('Error checking epoch distribution', process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async distributeEpochRewards(epoch: bigint) {
    try {
      const isDistributed = await this.chainService.rewardPool.read.epochDistributed([epoch]);

      if (isDistributed) {
        this.logger.debug(`Epoch ${epoch} already distributed`);
        await this.syncEpochContributions(epoch);
        return;
      }

      this.logger.log(`Distributing rewards for epoch ${epoch}`);

      const syncHash = await this.chainService.writeContract({
        address: this.chainService.rewardPool.address,
        abi: this.chainService.rewardPool.abi,
        functionName: 'syncRewards',
      });
      this.logger.log(`Syncing rewards, tx: ${syncHash}`);
      await this.chainService.publicClient.waitForTransactionReceipt({ hash: syncHash });

      const distributeHash = await this.chainService.writeContract({
        address: this.chainService.rewardPool.address,
        abi: this.chainService.rewardPool.abi,
        functionName: 'distributeRewards',
        args: [epoch],
      });
      this.logger.log(`Distribution tx submitted: ${distributeHash}`);

      const receipt = await this.chainService.publicClient.waitForTransactionReceipt({ hash: distributeHash });
      this.logger.log(`Epoch ${epoch} rewards distributed successfully`, {
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString(),
      });

      await this.syncEpochContributions(epoch);
    } catch (error) {
      this.logger.error(`Failed to distribute rewards for epoch ${epoch}`, process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async syncEpochContributions(epoch: bigint) {
    try {
      const epochNum = Number(epoch);
      const epochAgents = await this.chainService.rewardPool.read.getEpochAgents([epoch]);

      this.logger.log(`Syncing contributions for ${epochAgents.length} agents in epoch ${epochNum}`);

      for (const agentAddress of epochAgents) {
        try {
          const contribution = await this.chainService.rewardPool.read.getEpochContribution([epoch, agentAddress as `0x${string}`]);

          if (contribution.lastUpdated > 0n) {
            const wallet = agentAddress.toLowerCase();

            let dbContribution = await this.contributionRepo.findOne({
              where: { wallet, epoch: epochNum },
            });

            if (!dbContribution) {
              dbContribution = this.contributionRepo.create({
                wallet,
                epoch: epochNum,
              });
            }

            dbContribution.taskCount = Number(contribution.taskCount);
            dbContribution.uptimeSeconds = Number(contribution.uptimeSeconds);
            dbContribution.responseScore = Number(contribution.responseScore);
            dbContribution.processedTokens = contribution.processedTokens.toString();
            dbContribution.avgLatencyInv = Number(contribution.avgLatencyInv);
            dbContribution.lastUpdated = contribution.lastUpdated.toString();

            await this.contributionRepo.save(dbContribution);

            this.logger.debug(`Contribution synced for ${wallet}`, {
              epoch: epochNum,
              taskCount: dbContribution.taskCount,
              processedTokens: dbContribution.processedTokens,
            });
          }
        } catch (error) {
          this.logger.error(
            `Failed to sync contribution for ${agentAddress} in epoch ${epochNum}`,
            error instanceof Error ? error.message : 'Unknown error',
          );
        }
      }

      this.logger.log(`Completed syncing ${epochAgents.length} contributions for epoch ${epochNum}`);
    } catch (error) {
      this.logger.error(
        `Failed to sync epoch ${epoch} contributions`,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  setSyncService(syncService: any) {
    this.syncService = syncService;
  }
}
