import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent, Challenge, Epoch, Contribution, NetworkStats } from '../../entities';
import { ChainService } from '../chain/chain.service';

@Controller('api')
export class ApiController {
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

  @Get('stats')
  async getStats() {
    const stats = await this.networkStatsRepo.findOne({ where: { id: 1 } });
    if (!stats) {
      return {
        blockNumber: '0',
        activeAgents: 0,
        totalAgents: 0,
        currentEpoch: 0,
      };
    }
    return {
      blockNumber: stats.blockNumber,
      activeAgents: stats.activeAgents,
      totalAgents: stats.totalAgents,
      currentEpoch: stats.currentEpoch,
      updatedAt: stats.updatedAt,
    };
  }

  @Get('agents')
  async getAllAgents() {
    const agents = await this.agentRepo.find({ order: { registeredAt: 'DESC' } });
    return agents.map(a => ({
      wallet: a.wallet,
      nodeId: a.nodeId,
      metadata: a.metadata,
      registeredAt: a.registeredAt,
      lastHeartbeat: a.lastHeartbeat,
      status: a.status,
      stake: a.stake,
      updatedAt: a.updatedAt,
    }));
  }

  @Get('agents/active')
  async getActiveAgents() {
    const agents = await this.agentRepo.find({
      where: { status: 1 },
      order: { lastHeartbeat: 'DESC' },
    });
    return agents.map(a => ({
      wallet: a.wallet,
      nodeId: a.nodeId,
      metadata: a.metadata,
      registeredAt: a.registeredAt,
      lastHeartbeat: a.lastHeartbeat,
      status: a.status,
      stake: a.stake,
      updatedAt: a.updatedAt,
    }));
  }

  @Get('agents/:address')
  async getAgent(@Param('address') address: string) {
    const agent = await this.agentRepo.findOne({ where: { wallet: address.toLowerCase() } });
    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    const contributions = await this.contributionRepo.find({
      where: { wallet: address.toLowerCase() },
      order: { epoch: 'DESC' },
      take: 50,
    });

    return {
      wallet: agent.wallet,
      nodeId: agent.nodeId,
      metadata: agent.metadata,
      registeredAt: agent.registeredAt,
      lastHeartbeat: agent.lastHeartbeat,
      status: agent.status,
      stake: agent.stake,
      updatedAt: agent.updatedAt,
      contributions: contributions.map(c => ({
        epoch: c.epoch,
        taskCount: c.taskCount,
        uptimeSeconds: c.uptimeSeconds,
        responseScore: c.responseScore,
        processedTokens: c.processedTokens,
        avgLatencyInv: c.avgLatencyInv,
        lastUpdated: c.lastUpdated,
      })),
    };
  }

  @Get('epochs')
  async getEpochs() {
    const epochs = await this.epochRepo.find({
      order: { number: 'DESC' },
      take: 50,
    });
    return epochs.map(e => ({
      number: e.number,
      reward: e.reward,
      agentCount: e.agentCount,
      distributed: e.distributed,
      syncedAt: e.syncedAt,
    }));
  }

  @Get('epochs/:number')
  async getEpoch(@Param('number') number: string) {
    const epochNum = parseInt(number);
    if (isNaN(epochNum)) {
      throw new NotFoundException('Invalid epoch number');
    }

    const epoch = await this.epochRepo.findOne({ where: { number: epochNum } });
    if (!epoch) {
      throw new NotFoundException('Epoch not found');
    }

    const contributions = await this.contributionRepo.find({
      where: { epoch: epochNum },
      order: { taskCount: 'DESC' },
    });

    return {
      number: epoch.number,
      reward: epoch.reward,
      agentCount: epoch.agentCount,
      distributed: epoch.distributed,
      syncedAt: epoch.syncedAt,
      contributions: contributions.map(c => ({
        wallet: c.wallet,
        taskCount: c.taskCount,
        uptimeSeconds: c.uptimeSeconds,
        responseScore: c.responseScore,
        lastUpdated: c.lastUpdated,
      })),
    };
  }

  @Get('challenges')
  async getChallenges() {
    const challenges = await this.challengeRepo.find({
      order: { id: 'DESC' },
      take: 50,
    });
    return challenges.map(c => ({
      id: c.id,
      difficulty: c.difficulty,
      seed: c.seed,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      solved: c.solved,
      solver: c.solver,
      rewardBonus: c.rewardBonus,
      syncedAt: c.syncedAt,
    }));
  }

  @Get('challenges/current')
  async getCurrentChallenge() {
    const now = Math.floor(Date.now() / 1000);
    const challenges = await this.challengeRepo
      .createQueryBuilder('challenge')
      .where('challenge.solved = :solved', { solved: false })
      .andWhere('challenge.expiresAt > :now', { now: now.toString() })
      .orderBy('challenge.id', 'DESC')
      .limit(1)
      .getMany();

    if (challenges.length === 0) {
      return null;
    }

    const c = challenges[0];
    return {
      id: c.id,
      difficulty: c.difficulty,
      seed: c.seed,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      solved: c.solved,
      solver: c.solver,
      rewardBonus: c.rewardBonus,
      syncedAt: c.syncedAt,
    };
  }

  @Get('rewards/:address')
  async getRewards(@Param('address') address: string) {
    if (!this.chainService.rewardPool) {
      throw new NotFoundException('RewardPool not configured');
    }

    const pendingReward = await this.chainService.rewardPool.getPendingReward(address);

    const contributions = await this.contributionRepo.find({
      where: { wallet: address.toLowerCase() },
      order: { epoch: 'DESC' },
      take: 50,
    });

    return {
      wallet: address,
      pendingReward: pendingReward.toString(),
      contributions: contributions.map(c => ({
        epoch: c.epoch,
        taskCount: c.taskCount,
        uptimeSeconds: c.uptimeSeconds,
        responseScore: c.responseScore,
        processedTokens: c.processedTokens,
        avgLatencyInv: c.avgLatencyInv,
        lastUpdated: c.lastUpdated,
      })),
    };
  }

  @Get('formula')
  async getFormula() {
    return {
      task: 50,
      uptime: 30,
      response: 20,
    };
  }
}
