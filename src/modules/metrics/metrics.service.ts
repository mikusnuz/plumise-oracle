import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { InferenceMetrics } from '../../entities';
import { Logger } from '../../utils/logger';
import { ChainService } from '../chain/chain.service';
import { ReportMetricsDto } from './dto/report-metrics.dto';
import { NodesService } from '../nodes/nodes.service';
import { ProofService } from '../proof/proof.service';

@Injectable()
export class MetricsService {
  private logger = new Logger('MetricsService');

  constructor(
    @InjectRepository(InferenceMetrics)
    private metricsRepo: Repository<InferenceMetrics>,
    private chainService: ChainService,
    private nodesService: NodesService,
    private proofService: ProofService,
  ) {}

  async verifySignature(dto: ReportMetricsDto): Promise<boolean> {
    try {
      const message = JSON.stringify({
        agent: dto.wallet,
        processed_tokens: dto.tokensProcessed,
        timestamp: dto.timestamp,
      });

      const recoveredAddress = ethers.verifyMessage(message, dto.signature);
      return recoveredAddress.toLowerCase() === dto.wallet.toLowerCase();
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
        });
      }

      const prevTokens = BigInt(metrics.tokensProcessed || '0');
      const prevRequests = metrics.requestCount;
      const prevLatency = metrics.avgLatencyMs;

      metrics.tokensProcessed = String(prevTokens + BigInt(dto.tokensProcessed));
      metrics.requestCount = prevRequests + dto.requestCount;

      if (metrics.requestCount > 0) {
        const totalLatency = prevLatency * prevRequests + dto.avgLatencyMs * dto.requestCount;
        metrics.avgLatencyMs = totalLatency / metrics.requestCount;
      }

      metrics.uptimeSeconds = dto.uptimeSeconds;
      metrics.lastUpdated = String(Math.floor(Date.now() / 1000));

      await this.metricsRepo.save(metrics);

      await this.nodesService.updateNodeMetricReport(wallet);

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
  }
}
