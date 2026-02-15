import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { verifyMessage } from 'viem';
import { InferenceMetrics } from '../../entities';
import { PipelineAssignment } from '../../entities/pipeline-assignment.entity';
import { Logger } from '../../utils/logger';
import { ChainService } from '../chain/chain.service';
import { ReportMetricsDto } from './dto/report-metrics.dto';
import { NodesService } from '../nodes/nodes.service';
import { ProofService } from '../proof/proof.service';
import { SyncService } from '../sync/sync.service';

@Injectable()
export class MetricsService implements OnModuleInit {
  private logger = new Logger('MetricsService');
  private agentLastReportedTokens: Map<string, bigint> = new Map();
  private agentLastReportedRequests: Map<string, number> = new Map();
  private agentLastTimestamp: Map<string, number> = new Map(); // Re-audit #4 FIX: monotonic timestamp guard
  private scorerService: any; // OR-03 FIX: Scorer service for uptime updates

  constructor(
    @InjectRepository(InferenceMetrics)
    private metricsRepo: Repository<InferenceMetrics>,
    @InjectRepository(PipelineAssignment)
    private assignmentRepo: Repository<PipelineAssignment>,
    private chainService: ChainService,
    private nodesService: NodesService,
    private proofService: ProofService,
    private syncService: SyncService,
  ) {}

  /**
   * Re-audit #1 FIX: Restore delta tracking Maps from DB on startup
   * Prevents double-counting when the Oracle process restarts mid-epoch.
   */
  async onModuleInit() {
    try {
      const currentEpoch = Number(await this.chainService.getCurrentEpoch());
      const metrics = await this.metricsRepo.find({ where: { epoch: currentEpoch } });

      for (const m of metrics) {
        // Re-audit #1 FIX: Restore from lastRawTokens/lastRawRequests (agent's actual last cumulative),
        // NOT from tokensProcessed (accumulated delta sum). Using tokensProcessed would cause
        // false reset detection after Oracle restart if agent had reset mid-epoch.
        this.agentLastReportedTokens.set(m.wallet, BigInt(m.lastRawTokens || '0'));
        this.agentLastReportedRequests.set(m.wallet, m.lastRawRequests || 0);
        // Restore monotonic timestamp guard from DB
        const storedTimestamp = parseInt(m.lastUpdated || '0');
        if (storedTimestamp > 0) {
          this.agentLastTimestamp.set(m.wallet, storedTimestamp);
        }
      }

      if (metrics.length > 0) {
        this.logger.log(`Restored delta tracking for ${metrics.length} agents from epoch ${currentEpoch}`);
      }
    } catch (error) {
      this.logger.warn('Failed to restore delta tracking from DB (will start fresh)', error instanceof Error ? error.message : '');
    }
  }

  setScorerService(scorerService: any) {
    this.scorerService = scorerService;
  }

  async verifySignature(dto: ReportMetricsDto): Promise<boolean> {
    try {
      // OR-02 FIX: Anti-replay protection with timestamp freshness check
      const now = Math.floor(Date.now() / 1000);
      const timestampDiff = Math.abs(now - dto.timestamp);
      const TIMESTAMP_WINDOW_SECONDS = 60;

      if (timestampDiff > TIMESTAMP_WINDOW_SECONDS) {
        this.logger.warn(`Timestamp outside valid window: ${timestampDiff}s difference for ${dto.wallet}`);
        return false;
      }

      const message = JSON.stringify({
        agent: dto.wallet,
        processed_tokens: dto.tokensProcessed,
        timestamp: dto.timestamp,
      });

      const valid = await verifyMessage({
        address: dto.wallet as `0x${string}`,
        message,
        signature: dto.signature as `0x${string}`,
      });
      return valid;
    } catch (error) {
      this.logger.error('Signature verification failed', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  async recordMetrics(dto: ReportMetricsDto): Promise<{ success: boolean; shouldReset: boolean; error?: string }> {
    try {
      const wallet = dto.wallet.toLowerCase();

      const isRegistered = await this.nodesService.isAgentRegisteredOnChain(wallet);
      if (!isRegistered) {
        this.logger.warn(`Rejected metrics from unregistered agent: ${wallet}`);
        return { success: false, shouldReset: false, error: 'Agent not registered on-chain' };
      }

      // Auto-register precompile agent in DB (agents + agent_nodes tables)
      await Promise.all([
        this.syncService.ensurePrecompileAgent(wallet),
        this.nodesService.ensureNodeRegistered(wallet),
      ]);

      // Re-audit #4 FIX: Monotonic timestamp guard prevents replay attacks.
      // Old signed messages (with smaller cumulative values) would trigger false "reset"
      // detection and inflate token counts. Strict monotonic timestamp blocks this.
      const lastTimestamp = this.agentLastTimestamp.get(wallet) || 0;
      if (dto.timestamp <= lastTimestamp) {
        this.logger.warn(`Rejected replay from ${wallet}: timestamp ${dto.timestamp} <= last accepted ${lastTimestamp}`);
        return { success: false, shouldReset: false, error: 'Replay detected: timestamp must be strictly increasing' };
      }

      if (!this.nodesService.validateTokensProcessed(dto.tokensProcessed)) {
        this.logger.warn(`Rejected metrics from ${wallet}: invalid token count ${dto.tokensProcessed}`);
        return { success: false, shouldReset: false, error: 'Token count exceeds maximum allowed' };
      }

      const currentEpoch = Number(await this.chainService.getCurrentEpoch());

      let metrics = await this.metricsRepo.findOne({
        where: { wallet, epoch: currentEpoch },
      });

      const isNewEpoch = !metrics;

      if (!metrics) {
        metrics = this.metricsRepo.create({
          wallet,
          epoch: currentEpoch,
          tokensProcessed: '0',
          avgLatencyMs: 0,
          requestCount: 0,
          uptimeSeconds: 0,
          lastUpdated: String(Math.floor(Date.now() / 1000)),
          lastRawTokens: '0',
          lastRawRequests: 0,
        });
      }

      const prevTokens = BigInt(metrics.tokensProcessed || '0');
      const prevRequests = metrics.requestCount;
      const prevLatency = metrics.avgLatencyMs;

      // OR-01 FIX: Delta-based accumulation for cumulative metrics
      const reportedTokens = BigInt(dto.tokensProcessed);
      const reportedRequests = dto.requestCount;

      const lastReportedTokens = this.agentLastReportedTokens.get(wallet) || BigInt(0);
      const lastReportedRequests = this.agentLastReportedRequests.get(wallet) || 0;

      // Calculate delta (handle reset if reported < last)
      let tokenDelta: bigint;
      let requestDelta: number;

      if (reportedTokens < lastReportedTokens) {
        // Agent reset detected, treat as full delta
        tokenDelta = reportedTokens;
        this.logger.debug(`Agent ${wallet} token reset detected: ${lastReportedTokens} -> ${reportedTokens}`);
      } else {
        tokenDelta = reportedTokens - lastReportedTokens;
      }

      if (reportedRequests < lastReportedRequests) {
        // Agent reset detected
        requestDelta = reportedRequests;
        this.logger.debug(`Agent ${wallet} request reset detected: ${lastReportedRequests} -> ${reportedRequests}`);
      } else {
        requestDelta = reportedRequests - lastReportedRequests;
      }

      // Update last reported values and monotonic timestamp
      this.agentLastReportedTokens.set(wallet, reportedTokens);
      this.agentLastReportedRequests.set(wallet, reportedRequests);
      this.agentLastTimestamp.set(wallet, dto.timestamp);

      // Accumulate deltas to metrics
      metrics.tokensProcessed = String(prevTokens + tokenDelta);
      metrics.requestCount = prevRequests + requestDelta;

      // Re-audit #1 FIX: Persist agent's actual last raw cumulative values
      // These differ from tokensProcessed when agent has reset mid-epoch
      metrics.lastRawTokens = String(reportedTokens);
      metrics.lastRawRequests = reportedRequests;

      if (metrics.requestCount > 0) {
        const totalLatency = prevLatency * prevRequests + dto.avgLatencyMs * dto.requestCount;
        metrics.avgLatencyMs = totalLatency / metrics.requestCount;
      }

      metrics.uptimeSeconds = dto.uptimeSeconds;
      metrics.lastUpdated = String(dto.timestamp); // Store client timestamp for monotonic guard persistence

      await this.metricsRepo.save(metrics);

      await this.nodesService.updateNodeMetricReport(wallet);

      // Touch pipeline_assignments.updatedAt so stale detection stays in sync
      // with metrics heartbeat (unified heartbeat source)
      await this.assignmentRepo
        .createQueryBuilder()
        .update()
        .set({ updatedAt: () => 'NOW()' })
        .where('nodeAddress = :addr', { addr: wallet })
        .execute();

      // OR-03 FIX: Update uptime in scorer service
      if (this.scorerService) {
        this.scorerService.updateUptime(wallet, dto.uptimeSeconds);
      }

      if (dto.proofs && dto.proofs.length > 0) {
        try {
          for (const proof of dto.proofs) {
            await this.proofService.saveProof(wallet, currentEpoch, proof);
          }
          this.logger.debug(`Saved ${dto.proofs.length} proofs for ${wallet}`);
        } catch (error) {
          this.logger.error(
            `Failed to save proofs for ${wallet}`,
            error instanceof Error ? error.message : 'Unknown error',
          );
        }
      }

      this.logger.debug(`Metrics recorded for ${wallet}`, {
        epoch: currentEpoch,
        tokensProcessed: metrics.tokensProcessed,
        avgLatencyMs: metrics.avgLatencyMs.toFixed(2),
        requestCount: metrics.requestCount,
        proofsSubmitted: dto.proofs?.length || 0,
        isNewEpoch,
      });

      return { success: true, shouldReset: isNewEpoch };
    } catch (error) {
      this.logger.error('Failed to record metrics', error instanceof Error ? error.message : 'Unknown error');
      return { success: false, shouldReset: false, error: 'Internal server error' };
    }
  }

  async getAgentMetrics(wallet: string, epoch?: number): Promise<InferenceMetrics | null> {
    try {
      const currentEpoch = epoch ?? Number(await this.chainService.getCurrentEpoch());
      return await this.metricsRepo.findOne({
        where: { wallet: wallet.toLowerCase(), epoch: currentEpoch },
      });
    } catch (error) {
      this.logger.error('Failed to get agent metrics', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  async getAgentMetricsHistory(wallet: string, limit: number = 50): Promise<InferenceMetrics[]> {
    try {
      return await this.metricsRepo.find({
        where: { wallet: wallet.toLowerCase() },
        order: { epoch: 'DESC' },
        take: limit,
      });
    } catch (error) {
      this.logger.error('Failed to get agent metrics history', error instanceof Error ? error.message : 'Unknown error');
      return [];
    }
  }

  async getNetworkMetricsSummary(): Promise<any> {
    try {
      const currentEpoch = Number(await this.chainService.getCurrentEpoch());
      const metrics = await this.metricsRepo.find({ where: { epoch: currentEpoch } });

      if (metrics.length === 0) {
        return {
          epoch: currentEpoch,
          totalAgents: 0,
          totalTokens: '0',
          avgLatency: 0,
          totalRequests: 0,
        };
      }

      const totalTokens = metrics.reduce((sum, m) => sum + BigInt(m.tokensProcessed), BigInt(0));
      const totalRequests = metrics.reduce((sum, m) => sum + m.requestCount, 0);
      const avgLatency = metrics.reduce((sum, m) => sum + m.avgLatencyMs, 0) / metrics.length;

      return {
        epoch: currentEpoch,
        totalAgents: metrics.length,
        totalTokens: totalTokens.toString(),
        avgLatency: avgLatency.toFixed(2),
        totalRequests,
      };
    } catch (error) {
      this.logger.error('Failed to get network metrics summary', error instanceof Error ? error.message : 'Unknown error');
      return {
        epoch: 0,
        totalAgents: 0,
        totalTokens: '0',
        avgLatency: 0,
        totalRequests: 0,
      };
    }
  }

  resetEpochMetrics() {
    this.logger.log('Epoch metrics will be preserved in database for historical records');
    // Clear delta tracking for new epoch
    this.agentLastReportedTokens.clear();
    this.agentLastReportedRequests.clear();
  }

  async getNetworkThroughputHistory(limit: number = 24): Promise<any[]> {
    const results = await this.metricsRepo
      .createQueryBuilder('m')
      .select('m.epoch', 'epoch')
      .addSelect('SUM(CAST(m.tokensProcessed AS UNSIGNED))', 'totalTokens')
      .addSelect('COUNT(DISTINCT m.wallet)', 'agentCount')
      .addSelect('SUM(m.requestCount)', 'totalRequests')
      .addSelect('AVG(m.avgLatencyMs)', 'avgLatency')
      .addSelect('MAX(m.uptimeSeconds)', 'maxUptime')
      .groupBy('m.epoch')
      .orderBy('m.epoch', 'DESC')
      .limit(limit)
      .getRawMany();

    return results.reverse().map(r => ({
      epoch: Number(r.epoch),
      totalTokens: r.totalTokens || '0',
      agentCount: Number(r.agentCount || 0),
      totalRequests: Number(r.totalRequests || 0),
      avgLatency: parseFloat(r.avgLatency || '0').toFixed(2),
      maxUptime: Number(r.maxUptime || 0),
      // throughput: tokens per second (if uptime > 0)
      throughputTokPerSec: Number(r.maxUptime) > 0
        ? (Number(r.totalTokens || 0) / Number(r.maxUptime)).toFixed(2)
        : '0.00',
    }));
  }

  async getAgentCapacities(): Promise<any[]> {
    // Get latest epoch metrics for each agent
    const currentEpoch = Number(await this.chainService.getCurrentEpoch());
    const metrics = await this.metricsRepo.find({
      where: { epoch: currentEpoch },
    });

    return metrics.map(m => ({
      address: m.wallet,
      epoch: m.epoch,
      tokensProcessed: m.tokensProcessed,
      requestCount: m.requestCount,
      uptimeSeconds: m.uptimeSeconds,
      avgLatencyMs: m.avgLatencyMs,
      throughputTokPerSec: Number(m.uptimeSeconds) > 0
        ? (Number(m.tokensProcessed) / Number(m.uptimeSeconds)).toFixed(2)
        : '0.00',
    }));
  }
}
