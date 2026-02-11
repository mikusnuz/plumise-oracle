import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  createPublicClient,
  createWalletClient,
  http,
  getContract,
  type PublicClient,
  type WalletClient,
  type GetContractReturnType,
  type Address,
  type Account,
  type WriteContractParameters,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  plumise,
  addresses,
  agentRegistryAbi,
  rewardPoolAbi,
  challengeManagerAbi,
  formatPLM,
} from '@plumise/core';
import { chainConfig } from '../../config/chain.config';
import { Logger } from '../../utils/logger';

@Injectable()
export class ChainService implements OnModuleInit {
  private logger = new Logger('ChainService');
  private account: Account;
  public publicClient: PublicClient;
  public walletClient: WalletClient;
  public agentRegistry: GetContractReturnType<typeof agentRegistryAbi, { public: PublicClient; wallet: WalletClient }> | null = null;
  public rewardPool: GetContractReturnType<typeof rewardPoolAbi, { public: PublicClient; wallet: WalletClient }>;
  public challengeManager: GetContractReturnType<typeof challengeManagerAbi, { public: PublicClient; wallet: WalletClient }> | null = null;

  async onModuleInit() {
    try {
      this.logger.log('Initializing chain connection...');

      if (!process.env.ORACLE_PRIVATE_KEY) {
        throw new Error('ORACLE_PRIVATE_KEY not set in environment');
      }

      const transport = http(chainConfig.rpcUrl);
      const account = privateKeyToAccount(process.env.ORACLE_PRIVATE_KEY as `0x${string}`);
      this.account = account;

      this.publicClient = createPublicClient({
        chain: plumise,
        transport,
      });

      this.walletClient = createWalletClient({
        account,
        chain: plumise,
        transport,
      });

      const chainId = await this.publicClient.getChainId();
      this.logger.log(`Connected to chain ${chainId}`);

      const balance = await this.publicClient.getBalance({ address: account.address });
      this.logger.log(`Oracle wallet: ${account.address}`);
      this.logger.log(`Balance: ${formatPLM(balance)} PLM`);

      const agentRegistryAddr = chainConfig.contracts.agentRegistry || addresses.mainnet.AgentRegistry;
      if (agentRegistryAddr) {
        this.agentRegistry = getContract({
          address: agentRegistryAddr as Address,
          abi: agentRegistryAbi,
          client: { public: this.publicClient, wallet: this.walletClient },
        });
        this.logger.log(`AgentRegistry: ${agentRegistryAddr}`);
      } else {
        this.logger.warn('AgentRegistry address not configured - related features disabled');
      }

      const rewardPoolAddr = chainConfig.contracts.rewardPool || addresses.mainnet.RewardPool;
      this.rewardPool = getContract({
        address: rewardPoolAddr as Address,
        abi: rewardPoolAbi,
        client: { public: this.publicClient, wallet: this.walletClient },
      });
      this.logger.log(`RewardPool: ${rewardPoolAddr}`);

      const challengeManagerAddr = chainConfig.contracts.challengeManager || addresses.mainnet.ChallengeManager;
      if (challengeManagerAddr) {
        this.challengeManager = getContract({
          address: challengeManagerAddr as Address,
          abi: challengeManagerAbi,
          client: { public: this.publicClient, wallet: this.walletClient },
        });
        this.logger.log(`ChallengeManager: ${challengeManagerAddr}`);
      } else {
        this.logger.warn('ChallengeManager address not configured - related features disabled');
      }

      const currentEpoch = await this.rewardPool.read.getCurrentEpoch();
      this.logger.log(`Current epoch: ${currentEpoch}`);
    } catch (error) {
      const isDev = process.env.NODE_ENV !== 'production';
      this.logger.error(
        'Failed to initialize chain service',
        isDev && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  async getCurrentBlock(): Promise<number> {
    return Number(await this.publicClient.getBlockNumber());
  }

  async getCurrentEpoch(): Promise<bigint> {
    return await this.rewardPool.read.getCurrentEpoch();
  }

  async writeContract(params: Omit<WriteContractParameters, 'chain' | 'account'>): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      ...params,
      chain: plumise,
      account: this.account,
    } as any);
  }
}
