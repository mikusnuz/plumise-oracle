import { Controller, Post, Get, Body, Param, Query, BadRequestException, UnauthorizedException, Headers } from '@nestjs/common';
import { isAddress } from 'viem';
import { MetricsService } from './metrics.service';
import { ReportMetricsDto } from './dto/report-metrics.dto';
import { RegisterNodeDto } from './dto/register-node.dto';
import { NodesService } from '../nodes/nodes.service';
import { ProofService } from '../proof/proof.service';

@Controller()
export class MetricsController {
  constructor(
    private metricsService: MetricsService,
    private nodesService: NodesService,
    private proofService: ProofService,
  ) {}

  @Post('api/metrics')
  async reportMetricsSimple(@Body() dto: ReportMetricsDto, @Headers('x-api-key') apiKey?: string) {
    const oracleKey = process.env.ORACLE_API_KEY;
    const isInternalReport = !!(oracleKey && apiKey === oracleKey);

    if (apiKey && !isInternalReport) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Internal reports (from inference API with ORACLE_API_KEY) skip signature verification
    if (!isInternalReport) {
      const isValid = await this.metricsService.verifySignature(dto);
      if (!isValid) {
        throw new UnauthorizedException('Invalid signature');
      }
    }

    const result = await this.metricsService.recordMetrics(dto);
    if (!result.success) {
      throw new BadRequestException(result.error || 'Failed to record metrics');
    }

    return {
      success: true,
      message: 'Metrics recorded successfully',
      shouldReset: result.shouldReset,
    };
  }

  @Post('api/v1/metrics/report')
  async reportMetrics(@Body() dto: ReportMetricsDto) {
    const isValid = await this.metricsService.verifySignature(dto);
    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    const result = await this.metricsService.recordMetrics(dto);
    if (!result.success) {
      throw new BadRequestException(result.error || 'Failed to record metrics');
    }

    return {
      success: true,
      message: 'Metrics recorded successfully',
      shouldReset: result.shouldReset,
    };
  }

  @Get('api/v1/metrics/agents/:address')
  async getAgentMetrics(
    @Param('address') address: string,
    @Query('epoch') epoch?: string,
  ) {
    const epochNum = epoch ? parseInt(epoch) : undefined;
    if (epoch && isNaN(epochNum!)) {
      throw new BadRequestException('Invalid epoch number');
    }

    const metrics = await this.metricsService.getAgentMetrics(address, epochNum);
    if (!metrics) {
      return { address, metrics: null };
    }

    return {
      address: metrics.wallet,
      epoch: metrics.epoch,
      tokensProcessed: metrics.tokensProcessed,
      avgLatencyMs: metrics.avgLatencyMs,
      requestCount: metrics.requestCount,
      uptimeSeconds: metrics.uptimeSeconds,
      lastUpdated: metrics.lastUpdated,
    };
  }

  @Get('api/v1/metrics/agents/:address/history')
  async getAgentMetricsHistory(
    @Param('address') address: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit) : 50;
    if (limit && isNaN(limitNum)) {
      throw new BadRequestException('Invalid limit');
    }

    const history = await this.metricsService.getAgentMetricsHistory(address, limitNum);
    return {
      address,
      count: history.length,
      metrics: history.map(m => ({
        epoch: m.epoch,
        tokensProcessed: m.tokensProcessed,
        avgLatencyMs: m.avgLatencyMs,
        requestCount: m.requestCount,
        uptimeSeconds: m.uptimeSeconds,
        lastUpdated: m.lastUpdated,
      })),
    };
  }

  @Get('api/v1/metrics/summary')
  async getNetworkSummary() {
    return await this.metricsService.getNetworkMetricsSummary();
  }

  @Get('api/v1/metrics/throughput')
  async getNetworkThroughput(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit) : 24;
    if (limit && (isNaN(limitNum) || limitNum < 1 || limitNum > 100)) {
      throw new BadRequestException('Invalid limit (1-100)');
    }
    return await this.metricsService.getNetworkThroughputHistory(limitNum);
  }

  @Get('api/v1/metrics/capacity')
  async getAgentCapacities() {
    return await this.metricsService.getAgentCapacities();
  }

  @Post('api/nodes/register')
  async registerNode(@Body() dto: RegisterNodeDto) {
    const isValidSignature = await this.nodesService.verifyRegistrationSignature(dto);
    if (!isValidSignature) {
      throw new UnauthorizedException('Invalid signature');
    }

    const result = await this.nodesService.registerNode(dto);
    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    return {
      success: true,
      message: result.message,
      ...(result.assignment && { assignment: result.assignment }),
    };
  }

  @Get('api/nodes')
  async getActiveNodes() {
    const nodes = await this.nodesService.getActiveNodes();
    return {
      count: nodes.length,
      nodes: nodes.map(node => ({
        address: node.address,
        endpoint: node.endpoint,
        status: node.status,
        score: node.score,
        lastHeartbeat: node.lastHeartbeat,
        capabilities: node.capabilities,
      })),
    };
  }

  @Get('api/nodes/:address')
  async getNodeDetails(@Param('address') address: string) {
    if (!isAddress(address)) {
      throw new BadRequestException('Invalid address');
    }

    const node = await this.nodesService.getNodeByAddress(address);
    if (!node) {
      throw new BadRequestException('Node not found');
    }

    return {
      address: node.address,
      endpoint: node.endpoint,
      capabilities: node.capabilities,
      status: node.status,
      score: node.score,
      lastHeartbeat: node.lastHeartbeat,
      lastMetricReport: node.lastMetricReport,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
  }

  @Get('api/v1/proofs/:address')
  async getAgentProofs(
    @Param('address') address: string,
    @Query('limit') limit?: string,
    @Query('verified') verifiedOnly?: string,
  ) {
    if (!isAddress(address)) {
      throw new BadRequestException('Invalid address');
    }

    const limitNum = limit ? parseInt(limit) : 100;
    if (limit && (isNaN(limitNum) || limitNum < 1 || limitNum > 1000)) {
      throw new BadRequestException('Invalid limit (1-1000)');
    }

    const onlyVerified = verifiedOnly === 'true';
    const proofs = await this.proofService.getProofsByAgent(address, limitNum, onlyVerified);

    return {
      address,
      count: proofs.length,
      proofs: proofs.map(p => ({
        id: p.id,
        epoch: p.epoch,
        modelHash: p.modelHash,
        inputHash: p.inputHash,
        outputHash: p.outputHash,
        tokenCount: p.tokenCount,
        verified: p.verified,
        verificationTxHash: p.verificationTxHash,
        createdAt: p.createdAt,
        verifiedAt: p.verifiedAt,
      })),
    };
  }

  @Get('api/v1/proofs/:address/stats')
  async getAgentProofStats(
    @Param('address') address: string,
    @Query('epoch') epoch?: string,
  ) {
    if (!isAddress(address)) {
      throw new BadRequestException('Invalid address');
    }

    const epochNum = epoch ? parseInt(epoch) : undefined;
    if (epoch && isNaN(epochNum!)) {
      throw new BadRequestException('Invalid epoch number');
    }

    const stats = await this.proofService.getProofStats(address, epochNum);

    return {
      address,
      epoch: epochNum,
      ...stats,
    };
  }
}
