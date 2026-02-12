import { IsEthereumAddress, IsString, IsNumber, Min } from 'class-validator';

export class PipelineReadyDto {
  @IsEthereumAddress()
  address: string;

  @IsString()
  model: string;

  @IsNumber()
  @Min(0)
  timestamp: number;

  @IsString()
  signature: string;
}
