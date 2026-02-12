import { IsEthereumAddress, IsString, IsNumber, IsUrl, Min } from 'class-validator';

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

  @IsNumber()
  @Min(0)
  timestamp: number;

  @IsString()
  signature: string;
}
