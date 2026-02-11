import { IsEthereumAddress, IsNumber, IsString, Min } from 'class-validator';

export class ReportMetricsDto {
  @IsEthereumAddress()
  wallet: string;

  @IsNumber()
  @Min(0)
  tokensProcessed: number;

  @IsNumber()
  @Min(0)
  avgLatencyMs: number;

  @IsNumber()
  @Min(0)
  requestCount: number;

  @IsNumber()
  @Min(0)
  uptimeSeconds: number;

  @IsString()
  signature: string;
}
