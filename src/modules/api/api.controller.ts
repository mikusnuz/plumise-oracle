import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
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

    const pendingReward = await this.chainService.rewardPool.read.getPendingReward([address as `0x${string}`]);

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

  private leaderboardCache: { data: any; ts: number } | null = null;
  private readonly LEADERBOARD_TTL = 60_000;

  @Get('v1/leaderboard')
  async getLeaderboard(@Query('limit') limitStr?: string) {
    const limit = Math.min(parseInt(limitStr ?? '50') || 50, 200);

    const now = Date.now();
    if (this.leaderboardCache && now - this.leaderboardCache.ts < this.LEADERBOARD_TTL) {
      return this.leaderboardCache.data;
    }

    const TOKEN_WEIGHT = 40n;
    const TASK_WEIGHT = 25n;
    const UPTIME_WEIGHT = 20n;
    const LATENCY_WEIGHT = 15n;

    const allContribs = await this.contributionRepo.find();
    const epochMap = new Map<number, Epoch>();
    const epochs = await this.epochRepo.find();
    for (const e of epochs) {
      epochMap.set(e.number, e);
    }

    // epoch별 전체 가중 점수 합산
    const epochTotalScore = new Map<number, bigint>();
    for (const c of allContribs) {
      const score =
        (BigInt(c.processedTokens) * TOKEN_WEIGHT) +
        (BigInt(c.taskCount) * 100_000_000_000_000n * TASK_WEIGHT) +
        (BigInt(c.uptimeSeconds) * 10_000_000_000n * UPTIME_WEIGHT) +
        (BigInt(c.avgLatencyInv) * 10_000_000_000n * LATENCY_WEIGHT);
      epochTotalScore.set(c.epoch, (epochTotalScore.get(c.epoch) ?? 0n) + score);
    }

    // 에이전트별 집계
    const agentMap = new Map<string, {
      totalRewardShare: bigint;
      epochCount: number;
      totalTaskCount: number;
      totalTokensProcessed: bigint;
      totalUptimeSeconds: number;
    }>();

    for (const c of allContribs) {
      const epochData = epochMap.get(c.epoch);
      if (!epochData) continue;
      const totalScore = epochTotalScore.get(c.epoch) ?? 0n;
      if (totalScore === 0n) continue;

      const agentScore =
        (BigInt(c.processedTokens) * TOKEN_WEIGHT) +
        (BigInt(c.taskCount) * 100_000_000_000_000n * TASK_WEIGHT) +
        (BigInt(c.uptimeSeconds) * 10_000_000_000n * UPTIME_WEIGHT) +
        (BigInt(c.avgLatencyInv) * 10_000_000_000n * LATENCY_WEIGHT);

      const epochReward = BigInt(epochData.reward);
      const share = (epochReward * agentScore) / totalScore;

      const existing = agentMap.get(c.wallet);
      if (existing) {
        existing.totalRewardShare += share;
        existing.epochCount += 1;
        existing.totalTaskCount += c.taskCount;
        existing.totalTokensProcessed += BigInt(c.processedTokens);
        existing.totalUptimeSeconds += c.uptimeSeconds;
      } else {
        agentMap.set(c.wallet, {
          totalRewardShare: share,
          epochCount: 1,
          totalTaskCount: c.taskCount,
          totalTokensProcessed: BigInt(c.processedTokens),
          totalUptimeSeconds: c.uptimeSeconds,
        });
      }
    }

    const sorted = Array.from(agentMap.entries())
      .sort((a, b) => (a[1].totalRewardShare > b[1].totalRewardShare ? -1 : 1))
      .slice(0, limit);

    const totalDistributed = sorted.reduce((acc, [, v]) => acc + v.totalRewardShare, 0n);

    const agents = sorted.map(([wallet, v], idx) => ({
      rank: idx + 1,
      wallet,
      totalRewardShare: v.totalRewardShare.toString(),
      epochCount: v.epochCount,
      totalTaskCount: v.totalTaskCount,
      totalTokensProcessed: v.totalTokensProcessed.toString(),
      totalUptimeSeconds: v.totalUptimeSeconds,
    }));

    const result = {
      updatedAt: new Date().toISOString(),
      totalDistributed: totalDistributed.toString(),
      agents,
    };

    this.leaderboardCache = { data: result, ts: now };
    return result;
  }

  @Get('v1/rewards/history/:address')
  async getRewardHistory(
    @Param('address') address: string,
    @Query('limit') limitStr?: string,
  ) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new NotFoundException('Invalid address');
    }
    const limit = Math.min(parseInt(limitStr ?? '50') || 50, 200);
    const wallet = address.toLowerCase();

    const TOKEN_WEIGHT = 40n;
    const TASK_WEIGHT = 25n;
    const UPTIME_WEIGHT = 20n;
    const LATENCY_WEIGHT = 15n;

    const contribs = await this.contributionRepo.find({
      where: { wallet },
      order: { epoch: 'DESC' },
      take: limit,
    });

    if (contribs.length === 0) {
      return { wallet: address, totalEstimated: '0', epochs: [] };
    }

    const epochNums = contribs.map(c => c.epoch);

    const allEpochContribs = await this.contributionRepo
      .createQueryBuilder('c')
      .where('c.epoch IN (:...epochs)', { epochs: epochNums })
      .getMany();

    const epochTotalScore = new Map<number, bigint>();
    for (const c of allEpochContribs) {
      const score =
        (BigInt(c.processedTokens) * TOKEN_WEIGHT) +
        (BigInt(c.taskCount) * 100_000_000_000_000n * TASK_WEIGHT) +
        (BigInt(c.uptimeSeconds) * 10_000_000_000n * UPTIME_WEIGHT) +
        (BigInt(c.avgLatencyInv) * 10_000_000_000n * LATENCY_WEIGHT);
      epochTotalScore.set(c.epoch, (epochTotalScore.get(c.epoch) ?? 0n) + score);
    }

    const epochDataMap = new Map<number, Epoch>();
    const epochRecords = await this.epochRepo
      .createQueryBuilder('e')
      .where('e.number IN (:...epochs)', { epochs: epochNums })
      .getMany();
    for (const e of epochRecords) {
      epochDataMap.set(e.number, e);
    }

    let totalEstimated = 0n;
    const epochResults = contribs.map(c => {
      const epochData = epochDataMap.get(c.epoch);
      const totalScore = epochTotalScore.get(c.epoch) ?? 0n;

      const agentScore =
        (BigInt(c.processedTokens) * TOKEN_WEIGHT) +
        (BigInt(c.taskCount) * 100_000_000_000_000n * TASK_WEIGHT) +
        (BigInt(c.uptimeSeconds) * 10_000_000_000n * UPTIME_WEIGHT) +
        (BigInt(c.avgLatencyInv) * 10_000_000_000n * LATENCY_WEIGHT);

      let estimatedReward = 0n;
      if (epochData && totalScore > 0n) {
        estimatedReward = (BigInt(epochData.reward) * agentScore) / totalScore;
      }
      totalEstimated += estimatedReward;

      return {
        epoch: c.epoch,
        estimatedReward: estimatedReward.toString(),
        totalEpochReward: epochData ? epochData.reward : '0',
        agentCount: epochData ? epochData.agentCount : 0,
        contribution: {
          taskCount: c.taskCount,
          uptimeSeconds: c.uptimeSeconds,
          responseScore: c.responseScore,
          processedTokens: c.processedTokens,
        },
      };
    });

    return {
      wallet: address,
      totalEstimated: totalEstimated.toString(),
      epochs: epochResults,
    };
  }

  private tokenomicsCache: { data: any; ts: number } | null = null;
  private readonly TOKENOMICS_TTL = 120_000;
  private readonly BLOCKS_PER_EPOCH = 1200;
  private readonly HALVING_INTERVAL = 42_048_000;
  private readonly ALLOCATION_ADDRESSES = [
    { key: 'rewardPool', address: '0x0000000000000000000000000000000000001000' },
    { key: 'foundation', address: '0x0000000000000000000000000000000000001001' },
    { key: 'ecosystem', address: '0x0000000000000000000000000000000000001002' },
    { key: 'team', address: '0x0000000000000000000000000000000000001003' },
    { key: 'liquidity', address: '0x0000000000000000000000000000000000001004' },
  ] as const;

  @Get('v1/tokenomics')
  async getTokenomics() {
    const now = Date.now();
    if (this.tokenomicsCache && now - this.tokenomicsCache.ts < this.TOKENOMICS_TTL) {
      return this.tokenomicsCache.data;
    }

    const [currentBlockBig, currentEpochBig, ...balances] = await Promise.all([
      this.chainService.publicClient.getBlockNumber(),
      this.chainService.rewardPool.read.getCurrentEpoch(),
      ...this.ALLOCATION_ADDRESSES.map(({ address }) =>
        this.chainService.publicClient.getBalance({ address: address as `0x${string}` }),
      ),
    ]);

    const currentBlock = Number(currentBlockBig);
    const halvingCount = Math.floor(currentBlock / this.HALVING_INTERVAL);
    const blockRewardPLM = 10 / Math.pow(2, halvingCount);
    const nextHalvingBlock = (halvingCount + 1) * this.HALVING_INTERVAL;
    const blocksUntilHalving = nextHalvingBlock - currentBlock;
    const nextHalvingEstDate = new Date(Date.now() + blocksUntilHalving * 3000).toISOString();

    const allocations: Record<string, string> = {};
    this.ALLOCATION_ADDRESSES.forEach(({ key }, idx) => {
      allocations[key] = balances[idx].toString();
    });

    const result = {
      currentBlock,
      currentEpoch: Number(currentEpochBig),
      blocksPerEpoch: this.BLOCKS_PER_EPOCH,
      blockRewardPLM: blockRewardPLM.toString(),
      halvingInterval: this.HALVING_INTERVAL,
      halvingCount,
      nextHalvingBlock,
      blocksUntilHalving,
      nextHalvingEstDate,
      genesisSupply: '159000000',
      allocations,
    };

    this.tokenomicsCache = { data: result, ts: now };
    return result;
  }
}
