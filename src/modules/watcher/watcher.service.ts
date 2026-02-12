import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from '../../entities';
import { ChainService } from '../chain/chain.service';
import { Logger } from '../../utils/logger';
import { hexToString, keccak256, toBytes } from 'viem';

const REWARD_CLAIMED_TOPIC = keccak256(toBytes('RewardClaimed(address)'));

const PRECOMPILE_ADDRESSES = {
  VERIFY_INFERENCE: '0x0000000000000000000000000000000000000020',
  AGENT_REGISTER: '0x0000000000000000000000000000000000000021',
  AGENT_HEARTBEAT: '0x0000000000000000000000000000000000000022',
  CLAIM_REWARD: '0x0000000000000000000000000000000000000023',
} as const;

interface AgentMeta {
  name?: string;
  modelHash?: string;
  capabilityCount?: number;
  capabilities?: string[];
  registeredAt?: bigint;
  lastHeartbeat?: bigint;
  inferenceCount?: bigint;
  totalTokensProcessed?: bigint;
  stake?: bigint;
  status?: number;
}

@Injectable()
export class WatcherService implements OnModuleInit {
  private logger = new Logger('WatcherService');
  private syncService: any;
  private isWatching = false;

  constructor(
    @InjectRepository(Agent)
    private agentRepo: Repository<Agent>,
    private chainService: ChainService,
  ) {}

  async onModuleInit() {
    try {
      this.logger.log('Initializing block watcher...');
      await this.startWatching();
    } catch (error) {
      this.logger.error(
        'Failed to initialize watcher',
        process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  setSyncService(syncService: any) {
    this.syncService = syncService;
  }

  private async startWatching() {
    if (this.isWatching) {
      this.logger.warn('Already watching blocks');
      return;
    }

    this.isWatching = true;

    try {
      const unwatch = this.chainService.wsClient.watchBlocks({
        onBlock: async (block) => {
          try {
            await this.processBlock(block.number);
          } catch (error) {
            this.logger.error(
              `Error processing block ${block.number}`,
              process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error'
            );
          }
        },
        onError: (error) => {
          this.logger.error('Block watch error', error.message);
          this.isWatching = false;
          setTimeout(() => this.startWatching(), 5000);
        },
      });

      this.logger.log('Block watcher started successfully');
    } catch (error) {
      this.logger.error(
        'Failed to start block watcher',
        process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error'
      );
      this.isWatching = false;
      setTimeout(() => this.startWatching(), 5000);
    }
  }

  private async processBlock(blockNumber: bigint) {
    try {
      const block = await this.chainService.wsClient.getBlock({
        blockNumber,
        includeTransactions: true,
      });

      if (!block.transactions || block.transactions.length === 0) {
        return;
      }

      for (const tx of block.transactions) {
        if (typeof tx === 'string') continue;

        const to = tx.to?.toLowerCase();
        if (!to) continue;

        if (
          to === PRECOMPILE_ADDRESSES.VERIFY_INFERENCE.toLowerCase() ||
          to === PRECOMPILE_ADDRESSES.AGENT_REGISTER.toLowerCase() ||
          to === PRECOMPILE_ADDRESSES.AGENT_HEARTBEAT.toLowerCase() ||
          to === PRECOMPILE_ADDRESSES.CLAIM_REWARD.toLowerCase()
        ) {
          const receipt = await this.chainService.wsClient.getTransactionReceipt({
            hash: tx.hash,
          });

          if (receipt.status === 'success') {
            await this.handlePrecompileTransaction(to, tx, receipt);
          }
        }
      }
    } catch (error) {
      this.logger.debug(
        `Error processing block ${blockNumber}`,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async handlePrecompileTransaction(to: string, tx: any, receipt: any) {
    try {
      switch (to) {
        case PRECOMPILE_ADDRESSES.AGENT_REGISTER.toLowerCase():
          await this.handleAgentRegister(tx, receipt);
          break;
        case PRECOMPILE_ADDRESSES.AGENT_HEARTBEAT.toLowerCase():
          await this.handleAgentHeartbeat(tx);
          break;
        case PRECOMPILE_ADDRESSES.VERIFY_INFERENCE.toLowerCase():
          await this.handleVerifyInference(tx);
          break;
        case PRECOMPILE_ADDRESSES.CLAIM_REWARD.toLowerCase():
          await this.handleClaimReward(tx, receipt);
          break;
      }
    } catch (error) {
      this.logger.error(
        `Error handling precompile tx ${tx.hash}`,
        process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async handleAgentRegister(tx: any, receipt: any) {
    try {
      const input = tx.input as `0x${string}`;
      // Min 96 bytes = 192 hex chars + "0x" prefix = 194
      if (input.length < 194) {
        this.logger.warn(`Invalid agentRegister input length: ${input.length}`);
        return;
      }

      const nameHex = input.slice(2, 66);
      const modelHashHex = input.slice(66, 130);
      const capCountHex = input.slice(130, 194);

      const name = hexToString(`0x${nameHex}`).replace(/\0/g, '').trim();
      const modelHash = `0x${modelHashHex}`;
      const capCount = parseInt(capCountHex, 16);

      let beneficiary: string | null = null;
      const expectedMinLength = 194 + capCount * 64;
      if (input.length > expectedMinLength + 64) {
        const beneficiaryHex = input.slice(input.length - 64);
        beneficiary = `0x${beneficiaryHex.slice(24)}`;
      }

      const targetAddress = (beneficiary || tx.from).toLowerCase();

      const agentMeta = await this.chainService.getAgentMeta(targetAddress);
      if (!agentMeta) {
        this.logger.warn(`No agent meta found for ${targetAddress} after registration`);
        return;
      }

      const blockNum = Number(receipt.blockNumber);
      const now = String(Math.floor(Date.now() / 1000));

      await this.agentRepo.save({
        wallet: targetAddress,
        nodeId: agentMeta.name || name,
        metadata: modelHash,
        registeredAt: agentMeta.registeredAt ? agentMeta.registeredAt.toString() : now,
        lastHeartbeat: agentMeta.lastHeartbeat ? agentMeta.lastHeartbeat.toString() : now,
        status: agentMeta.status ?? 1,
        stake: agentMeta.stake ? agentMeta.stake.toString() : '0',
      });

      this.logger.log(`Agent registered via precompile: ${targetAddress}`, {
        name,
        modelHash,
        capCount,
        beneficiary: beneficiary || 'self',
        block: blockNum,
      });
    } catch (error) {
      this.logger.error(
        'Error handling agentRegister',
        process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async handleAgentHeartbeat(tx: any) {
    try {
      const agentAddress = tx.from.toLowerCase();

      const agentMeta = await this.chainService.getAgentMeta(agentAddress);
      if (!agentMeta) {
        this.logger.debug(`No agent meta found for heartbeat from ${agentAddress}`);
        return;
      }

      const existing = await this.agentRepo.findOne({ where: { wallet: agentAddress } });
      if (!existing) {
        const now = String(Math.floor(Date.now() / 1000));
        await this.agentRepo.save({
          wallet: agentAddress,
          nodeId: agentMeta.name || '',
          metadata: agentMeta.modelHash || '',
          registeredAt: agentMeta.registeredAt ? agentMeta.registeredAt.toString() : now,
          lastHeartbeat: agentMeta.lastHeartbeat ? agentMeta.lastHeartbeat.toString() : now,
          status: agentMeta.status ?? 1,
          stake: agentMeta.stake ? agentMeta.stake.toString() : '0',
        });
        this.logger.log(`Agent auto-registered from heartbeat: ${agentAddress}`);
      } else {
        await this.agentRepo.update(
          { wallet: agentAddress },
          {
            lastHeartbeat: agentMeta.lastHeartbeat ? agentMeta.lastHeartbeat.toString() : existing.lastHeartbeat,
            status: agentMeta.status ?? existing.status,
          }
        );
        this.logger.debug(`Agent heartbeat updated: ${agentAddress}`);
      }
    } catch (error) {
      this.logger.error(
        'Error handling agentHeartbeat',
        process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async handleVerifyInference(tx: any) {
    try {
      const input = tx.input as `0x${string}`;
      if (input.length < 194) {
        this.logger.warn(`Invalid verifyInference input length: ${input.length}`);
        return;
      }

      const agentHex = input.slice(194, 258);
      const agentAddress = `0x${agentHex.slice(24)}`.toLowerCase();

      const agentMeta = await this.chainService.getAgentMeta(agentAddress);
      if (!agentMeta) {
        this.logger.debug(`No agent meta found for inference from ${agentAddress}`);
        return;
      }

      const existing = await this.agentRepo.findOne({ where: { wallet: agentAddress } });
      if (!existing) {
        if (this.syncService) {
          await this.syncService.ensurePrecompileAgent(agentAddress);
        }
      }

      this.logger.debug(`Inference verified for agent: ${agentAddress}`, {
        inferenceCount: agentMeta.inferenceCount?.toString(),
        tokensProcessed: agentMeta.totalTokensProcessed?.toString(),
      });
    } catch (error) {
      this.logger.error(
        'Error handling verifyInference',
        process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async handleClaimReward(tx: any, receipt: any) {
    try {
      const agentAddress = tx.from.toLowerCase();

      let claimed = false;
      if (receipt.logs && receipt.logs.length > 0) {
        for (const log of receipt.logs) {
          if (log.topics && log.topics.length >= 2 && log.topics[0] === REWARD_CLAIMED_TOPIC) {
            claimed = true;
            break;
          }
        }
      }

      this.logger.log(`Reward claimed by agent: ${agentAddress}`, {
        claimed,
        txHash: tx.hash,
      });
    } catch (error) {
      this.logger.error(
        'Error handling claimReward',
        process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
}
