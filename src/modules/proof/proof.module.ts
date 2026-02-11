import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InferenceProof } from '../../entities/inference-proof.entity';
import { ProofService } from './proof.service';

@Module({
  imports: [TypeOrmModule.forFeature([InferenceProof])],
  providers: [ProofService],
  exports: [ProofService],
})
export class ProofModule {}
