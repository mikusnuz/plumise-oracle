import { IsEthereumAddress, IsString, IsArray, IsUrl, IsNumber, Min, IsOptional } from 'class-validator';

export class RegisterNodeDto {
  @IsEthereumAddress()
  address: string;

  @IsUrl({ require_protocol: true })
  endpoint: string;

  @IsArray()
  @IsString({ each: true })
  capabilities: string[];

  @IsNumber()
  @Min(0)
  timestamp: number;

  @IsString()
  signature: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  benchmarkTokPerSec?: number;
}
