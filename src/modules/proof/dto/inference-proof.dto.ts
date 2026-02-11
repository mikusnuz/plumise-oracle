import { IsHexadecimal, IsNumber, Min, IsString, Length } from 'class-validator';

export class InferenceProofDto {
  @IsString()
  @IsHexadecimal()
  @Length(66, 66)
  modelHash: string;

  @IsString()
  @IsHexadecimal()
  @Length(66, 66)
  inputHash: string;

  @IsString()
  @IsHexadecimal()
  @Length(66, 66)
  outputHash: string;

  @IsNumber()
  @Min(1)
  tokenCount: number;
}
