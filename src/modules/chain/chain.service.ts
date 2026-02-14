import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  getContract,
  keccak256,
  toBytes,
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
  public account: Account;
  public publicClient: PublicClient;
  public wsClient: PublicClient;
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

      try {
        const wsTransport = webSocket(chainConfig.wsUrl, {
          keepAlive: true,
          reconnect: { attempts: 10, delay: 5_000 },
        });
        this.wsClient = createPublicClient({
          chain: plumise,
          transport: wsTransport,
        });
        this.logger.log(`WebSocket transport: ${chainConfig.wsUrl}`);
      } catch (error) {
        this.logger.warn(`WebSocket init failed, using HTTP fallback: ${error instanceof Error ? error.message : 'Unknown'}`);
        this.wsClient = this.publicClient;
      }

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

  async getAgentMeta(address: string): Promise<any> {
    try {
      return await this.publicClient.request({
        method: 'agent_getAgentMeta' as any,
        params: [address as `0x${string}`, 'latest'],
      } as any);
    } catch (error) {
      this.logger.debug(`Failed to get agent meta for ${address}`, error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  async isAgentAccount(address: string): Promise<boolean> {
    try {
      return await this.publicClient.request({
        method: 'agent_isAgentAccount' as any,
        params: [address as `0x${string}`, 'latest'],
      } as any);
    } catch (error) {
      this.logger.debug(`Failed to check agent account for ${address}`, error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Sponsor-register an agent on-chain via precompile 0x21.
   * Oracle pays gas; the agent address is set as beneficiary.
   * Input: name(32B) + modelHash(32B) + capCount(32B) + beneficiary(32B)
   */
  async sponsorRegisterAgent(agentAddress: string, model: string): Promise<`0x${string}`> {
    const PRECOMPILE_REGISTER = '0x0000000000000000000000000000000000000021' as const;

    // Name: "plumise-agent" right-padded to 32 bytes (hex)
    const nameHex = Buffer.from('plumise-agent').toString('hex').padEnd(64, '0');

    // Model hash: keccak256 of model string bytes
    const modelHash = keccak256(toBytes(model)).slice(2); // remove 0x prefix

    // Cap count: 0
    const capCount = '0'.repeat(64);

    // Beneficiary: agent address left-padded to 32 bytes
    const beneficiary = agentAddress.toLowerCase().replace('0x', '').padStart(64, '0');

    const data = ('0x' + nameHex + modelHash + capCount + beneficiary) as `0x${string}`;

    const hash = await this.walletClient.sendTransaction({
      to: PRECOMPILE_REGISTER,
      data,
      gas: 300_000n,
      chain: plumise,
      account: this.account,
    });

    this.logger.log(`Sponsor registration tx sent: ${hash} for ${agentAddress}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    if (receipt.status !== 'success') {
      throw new Error(`Sponsor registration tx reverted: ${hash}`);
    }

    this.logger.log(`Sponsor registration confirmed for ${agentAddress}`);
    return hash;
  }

  /**
   * Send sponsored heartbeat for an agent via precompile 0x22.
   * Input: agentAddress(32B) — Oracle pays gas on behalf of agent.
   */
  async sponsorHeartbeat(agentAddress: string): Promise<`0x${string}`> {
    const PRECOMPILE_HEARTBEAT = '0x0000000000000000000000000000000000000022' as const;

    const beneficiary = agentAddress.toLowerCase().replace('0x', '').padStart(64, '0');
    const data = ('0x' + beneficiary) as `0x${string}`;

    const hash = await this.walletClient.sendTransaction({
      to: PRECOMPILE_HEARTBEAT,
      data,
      gas: 100_000n,
      chain: plumise,
      account: this.account,
    });

    return hash;
  }
}
