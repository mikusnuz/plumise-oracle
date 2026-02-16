import { IsEthereumAddress, IsString, IsNumber, IsUrl, Min, IsOptional } from 'class-validator';

export class RegisterPipelineNodeDto {
  @IsEthereumAddress()
  address: string;

  @IsUrl({ require_protocol: true })
  grpcEndpoint: string;

  @IsUrl({ require_protocol: true })
  httpEndpoint: string;

  @IsString()
  model: string;

  @IsNumber()
  @Min(0)
  ramMb: number;

  @IsString()
  device: string;

  @IsNumber()
  @Min(0)
  vramMb: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  benchmarkTokPerSec?: number;

  @IsNumber()
  @Min(0)
  timestamp: number;

  @IsString()
  signature: string;
}
