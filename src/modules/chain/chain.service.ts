import { Injectable, OnModuleInit } from '@nestjs/common';
import { ethers } from 'ethers';
import { chainConfig } from '../../config/chain.config';
import { Logger } from '../../utils/logger';
import AgentRegistryAbi from '../../contracts/AgentRegistry.json';
import RewardPoolAbi from '../../contracts/RewardPool.json';
import ChallengeManagerAbi from '../../contracts/ChallengeManager.json';

@Injectable()
export class ChainService implements OnModuleInit {
  private logger = new Logger('ChainService');
  public provider: ethers.JsonRpcProvider;
  public wallet: ethers.Wallet;
  public agentRegistry: ethers.Contract;
  public rewardPool: ethers.Contract;
  public challengeManager: ethers.Contract;

  async onModuleInit() {
    try {
      this.logger.log('Initializing chain connection...');

      if (!process.env.ORACLE_PRIVATE_KEY) {
        throw new Error('ORACLE_PRIVATE_KEY not set in environment');
      }

      this.provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
      this.wallet = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY, this.provider);

      const network = await this.provider.getNetwork();
      this.logger.log(`Connected to chain ${network.chainId} (${network.name})`);

      const balance = await this.provider.getBalance(this.wallet.address);
      this.logger.log(`Oracle wallet: ${this.wallet.address}`);
      this.logger.log(`Balance: ${ethers.formatEther(balance)} PLM`);

      this.agentRegistry = new ethers.Contract(
        chainConfig.contracts.agentRegistry,
        AgentRegistryAbi,
        this.wallet,
      );

      this.rewardPool = new ethers.Contract(
        chainConfig.contracts.rewardPool,
        RewardPoolAbi,
        this.wallet,
      );

      this.challengeManager = new ethers.Contract(
        chainConfig.contracts.challengeManager,
        ChallengeManagerAbi,
        this.wallet,
      );

      this.logger.log('Contract instances created', {
        agentRegistry: chainConfig.contracts.agentRegistry,
        rewardPool: chainConfig.contracts.rewardPool,
        challengeManager: chainConfig.contracts.challengeManager,
      });

      const currentEpoch = await this.rewardPool.getCurrentEpoch();
      this.logger.log(`Current epoch: ${currentEpoch}`);
    } catch (error) {
      this.logger.error('Failed to initialize chain service', error.stack);
      throw error;
    }
  }

  async getCurrentBlock(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getCurrentEpoch(): Promise<bigint> {
    return await this.rewardPool.getCurrentEpoch();
  }
}
