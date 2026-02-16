import { IsString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';

export class AddHashDto {
  @IsString()
  @IsNotEmpty()
  ggufHash: string;

  @IsString()
  @IsOptional()
  quantType?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  fileSizeMb?: number;
}
