import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent, Challenge, Epoch, Contribution, NetworkStats } from '../../entities';
import { ChainService } from '../chain/chain.service';
import { Logger } from '../../utils/logger';

@Injectable()
export class SyncService implements OnModuleInit {
  private logger = new Logger('SyncService');

  constructor(
    @InjectRepository(Agent)
    private agentRepo: Repository<Agent>,
    @InjectRepository(Challenge)
    private challengeRepo: Repository<Challenge>,
    @InjectRepository(Epoch)
    private epochRepo: Repository<Epoch>,
    @InjectRepository(Contribution)
    private contributionRepo: Repository<Contribution>,
    @InjectRepository(NetworkStats)
    private networkStatsRepo: Repository<NetworkStats>,
    private chainService: ChainService,
  ) {}

  async onModuleInit() {
    this.logger.log('Starting initial sync...');
    try {
      await this.initialSync();
      this.logger.log('Initial sync completed');
    } catch (error) {
      this.logger.error('Initial sync failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async initialSync() {
    if (!this.chainService.agentRegistry || !this.chainService.rewardPool) {
      this.logger.warn('Chain services not ready, skipping initial sync');
      return;
    }

    try {
      const allAgents = await this.chainService.agentRegistry.getAllAgents();
      this.logger.log(`Syncing ${allAgents.length} agents...`);

      for (const agentAddress of allAgents) {
        try {
          const agentData = await this.chainService.agentRegistry.getAgent(agentAddress);
          await this.agentRepo.save({
            wallet: agentAddress.toLowerCase(),
            nodeId: agentData.nodeId || '',
            metadata: agentData.metadata || '',
            registeredAt: agentData.registeredAt.toString(),
            lastHeartbeat: agentData.lastHeartbeat.toString(),
            status: agentData.status,
            stake: agentData.stake.toString(),
          });
        } catch (error) {
          this.logger.error(`Failed to sync agent ${agentAddress}`, error instanceof Error ? error.message : 'Unknown error');
        }
      }

      const currentEpoch = await this.chainService.getCurrentEpoch();
      const epochNum = Number(currentEpoch);

      if (epochNum > 0) {
        this.logger.log(`Syncing last 50 epochs (current: ${epochNum})...`);
        const startEpoch = Math.max(0, epochNum - 50);

        for (let i = startEpoch; i <= epochNum; i++) {
          try {
            const epochReward = await this.chainService.rewardPool.epochRewards(BigInt(i));
            const epochAgentsList = await this.chainService.rewardPool.getEpochAgents(BigInt(i));
            const distributed = await this.chainService.rewardPool.epochDistributed(BigInt(i));

            await this.epochRepo.save({
              number: i,
              reward: epochReward.toString(),
              agentCount: epochAgentsList.length,
              distributed,
            });

            for (const agentAddress of allAgents) {
              try {
                const contribution = await this.chainService.rewardPool.getEpochContribution(BigInt(i), agentAddress);
                if (contribution.lastUpdated > 0n) {
                  await this.contributionRepo.save({
                    wallet: agentAddress.toLowerCase(),
                    epoch: i,
                    taskCount: Number(contribution.taskCount),
                    uptimeSeconds: Number(contribution.uptimeSeconds),
                    responseScore: Number(contribution.responseScore),
                    lastUpdated: contribution.lastUpdated.toString(),
                  });
                }
              } catch (error) {
                // Skip if contribution doesn't exist
              }
            }
          } catch (error) {
            this.logger.error(`Failed to sync epoch ${i}`, error instanceof Error ? error.message : 'Unknown error');
          }
        }
      }

      if (this.chainService.challengeManager) {
        try {
          const totalChallenges = await this.chainService.challengeManager.getTotalChallenges();
          const total = Number(totalChallenges);

          if (total > 0) {
            this.logger.log(`Syncing challenges (total: ${total})...`);
            const challengeHistory = await this.chainService.challengeManager.getChallengeHistory(0, total);

            for (let i = 0; i < challengeHistory.length; i++) {
              const ch = challengeHistory[i];
              try {
                await this.challengeRepo.save({
                  id: Number(ch.id),
                  difficulty: Number(ch.difficulty),
                  seed: ch.seed,
                  createdAt: ch.createdAt.toString(),
                  expiresAt: ch.expiresAt.toString(),
                  solved: ch.solved,
                  solver: ch.solver === '0x0000000000000000000000000000000000000000' ? null : ch.solver,
                  rewardBonus: ch.rewardBonus.toString(),
                });
              } catch (error) {
                this.logger.error(`Failed to sync challenge ${ch.id}`, error instanceof Error ? error.message : 'Unknown error');
              }
            }
          }
        } catch (error) {
          this.logger.error('Failed to sync challenges', error instanceof Error ? error.message : 'Unknown error');
        }
      }

      await this.updateNetworkStats();
    } catch (error) {
      this.logger.error('Initial sync error', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async syncAgents(agents: any[]) {
    try {
      for (const agent of agents) {
        await this.agentRepo.save({
          wallet: agent.address.toLowerCase(),
          nodeId: agent.nodeId || '',
          metadata: agent.metadata || '',
          registeredAt: agent.registeredAt?.toString() || '0',
          lastHeartbeat: agent.lastHeartbeat?.toString() || '0',
          status: agent.status ?? (agent.isActive ? 1 : 0),
          stake: agent.stake?.toString() || '0',
        });
      }
    } catch (error) {
      this.logger.error('Failed to sync agents', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async syncChallenge(challenge: any) {
    try {
      await this.challengeRepo.save({
        id: Number(challenge.id),
        difficulty: Number(challenge.difficulty),
        seed: challenge.seed,
        createdAt: challenge.createdAt.toString(),
        expiresAt: challenge.expiresAt.toString(),
        solved: challenge.solved,
        solver: challenge.solver === '0x0000000000000000000000000000000000000000' ? null : challenge.solver,
        rewardBonus: challenge.rewardBonus.toString(),
      });
    } catch (error) {
      this.logger.error('Failed to sync challenge', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async syncEpoch(epochNumber: bigint) {
    try {
      if (!this.chainService.rewardPool) return;

      const epochReward = await this.chainService.rewardPool.epochRewards(epochNumber);
      const epochAgentsList = await this.chainService.rewardPool.getEpochAgents(epochNumber);
      const distributed = await this.chainService.rewardPool.epochDistributed(epochNumber);

      await this.epochRepo.save({
        number: Number(epochNumber),
        reward: epochReward.toString(),
        agentCount: epochAgentsList.length,
        distributed,
      });
    } catch (error) {
      this.logger.error(`Failed to sync epoch ${epochNumber}`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async syncContribution(wallet: string, epoch: number, contribution: any) {
    try {
      await this.contributionRepo.save({
        wallet: wallet.toLowerCase(),
        epoch,
        taskCount: Number(contribution.taskCount),
        uptimeSeconds: Number(contribution.uptimeSeconds),
        responseScore: Number(contribution.responseScore),
        lastUpdated: contribution.lastUpdated.toString(),
      });
    } catch (error) {
      this.logger.error(`Failed to sync contribution for ${wallet} epoch ${epoch}`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async updateNetworkStats() {
    try {
      const blockNumber = await this.chainService.provider.getBlockNumber();
      const currentEpoch = await this.chainService.getCurrentEpoch();

      const totalAgents = await this.agentRepo.count();
      const activeAgents = await this.agentRepo.count({ where: { status: 1 } });

      await this.networkStatsRepo.save({
        id: 1,
        blockNumber: blockNumber.toString(),
        activeAgents,
        totalAgents,
        currentEpoch: Number(currentEpoch),
      });
    } catch (error) {
      this.logger.error('Failed to update network stats', error instanceof Error ? error.message : 'Unknown error');
    }
  }
}
