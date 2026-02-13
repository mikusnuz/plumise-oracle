import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InferenceProof } from '../../entities/inference-proof.entity';
import { InferenceMetrics } from '../../entities/inference-metrics.entity';
import { ProofService } from './proof.service';

@Module({
  imports: [TypeOrmModule.forFeature([InferenceProof, InferenceMetrics])],
  providers: [ProofService],
  exports: [ProofService],
})
export class ProofModule {}
