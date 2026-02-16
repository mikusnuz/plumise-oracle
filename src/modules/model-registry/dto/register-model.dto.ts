import { IsString, IsNotEmpty, IsNumber, IsEnum, IsOptional, Min } from 'class-validator';

export class RegisterModelDto {
  @IsString()
  @IsNotEmpty()
  modelId: string;

  @IsString()
  @IsNotEmpty()
  displayName: string;

  @IsNumber()
  @Min(0)
  activeParams: number;

  @IsNumber()
  @Min(0)
  totalParams: number;

  @IsEnum(['dense', 'moe'])
  arch: 'dense' | 'moe';

  @IsNumber()
  @Min(0)
  minMemoryMb: number;

  @IsNumber()
  @Min(1)
  totalLayers: number;

  @IsEnum(['active', 'deprecated', 'disabled'])
  @IsOptional()
  status?: 'active' | 'deprecated' | 'disabled';
}
