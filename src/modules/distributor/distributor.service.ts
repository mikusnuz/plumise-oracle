import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ChainService } from '../chain/chain.service';
import { Logger } from '../../utils/logger';
import { chainConfig } from '../../config/chain.config';

@Injectable()
export class DistributorService {
  private logger = new Logger('DistributorService');
  private lastCheckedEpoch: bigint = 0n;

  constructor(private chainService: ChainService) {}

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
      }
    } catch (error) {
      this.logger.error('Error checking epoch distribution', process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async distributeEpochRewards(epoch: bigint) {
    try {
      const isDistributed = await this.chainService.rewardPool.epochDistributed(epoch);

      if (isDistributed) {
        this.logger.debug(`Epoch ${epoch} already distributed`);
        return;
      }

      this.logger.log(`Distributing rewards for epoch ${epoch}`);

      const syncTx = await this.chainService.rewardPool.syncRewards();
      this.logger.log(`Syncing rewards, tx: ${syncTx.hash}`);
      await syncTx.wait();

      const distributeTx = await this.chainService.rewardPool.distributeRewards(epoch);
      this.logger.log(`Distribution tx submitted: ${distributeTx.hash}`);

      const receipt = await distributeTx.wait();
      this.logger.log(`Epoch ${epoch} rewards distributed successfully`, {
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
      });
    } catch (error) {
      this.logger.error(`Failed to distribute rewards for epoch ${epoch}`, process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }
}
