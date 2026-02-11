import { Controller, Post, Get, Body, Param, Query, BadRequestException, UnauthorizedException, Headers } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { ReportMetricsDto } from './dto/report-metrics.dto';

@Controller()
export class MetricsController {
  constructor(private metricsService: MetricsService) {}

  @Post('api/metrics')
  async reportMetricsSimple(@Body() dto: ReportMetricsDto, @Headers('x-api-key') apiKey?: string) {
    if (apiKey && apiKey !== process.env.ORACLE_API_KEY) {
      throw new UnauthorizedException('Invalid API key');
    }

    const isValid = await this.metricsService.verifySignature(dto);
    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    const result = await this.metricsService.recordMetrics(dto);
    if (!result.success) {
      throw new BadRequestException('Failed to record metrics');
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
      throw new BadRequestException('Failed to record metrics');
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
}
