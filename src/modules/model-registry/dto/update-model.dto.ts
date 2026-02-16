import { IsString, IsNumber, IsEnum, IsOptional, Min } from 'class-validator';

export class UpdateModelDto {
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  activeParams?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  totalParams?: number;

  @IsEnum(['dense', 'moe'])
  @IsOptional()
  arch?: 'dense' | 'moe';

  @IsNumber()
  @Min(0)
  @IsOptional()
  minMemoryMb?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  totalLayers?: number;

  @IsEnum(['active', 'deprecated', 'disabled'])
  @IsOptional()
  status?: 'active' | 'deprecated' | 'disabled';
}
