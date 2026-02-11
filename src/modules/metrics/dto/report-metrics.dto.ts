import { IsEthereumAddress, IsNumber, IsString, Min, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { InferenceProofDto } from '../../proof/dto/inference-proof.dto';

export class ReportMetricsDto {
  @IsEthereumAddress()
  @Transform(({ obj }) => obj.agent || obj.wallet)
  wallet: string;

  @IsNumber()
  @Min(0)
  @Transform(({ obj }) => obj.processed_tokens ?? obj.tokensProcessed)
  tokensProcessed: number;

  @IsNumber()
  @Min(0)
  @Transform(({ obj }) => obj.avg_latency_ms ?? obj.avgLatencyMs)
  avgLatencyMs: number;

  @IsNumber()
  @Min(0)
  @Transform(({ obj }) => obj.tasks_completed ?? obj.requestCount)
  requestCount: number;

  @IsNumber()
  @Min(0)
  @Transform(({ obj }) => obj.uptime_seconds ?? obj.uptimeSeconds)
  uptimeSeconds: number;

  @IsNumber()
  @Min(0)
  timestamp: number;

  @IsString()
  signature: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InferenceProofDto)
  proofs?: InferenceProofDto[];
}
