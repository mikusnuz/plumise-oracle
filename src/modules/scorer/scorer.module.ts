import { Module, forwardRef } from '@nestjs/common';
import { ScorerService } from './scorer.service';
import { NodesModule } from '../nodes/nodes.module';
import { ProofModule } from '../proof/proof.module';
import { ChainModule } from '../chain/chain.module';

@Module({
  imports: [NodesModule, ProofModule, ChainModule],
  providers: [ScorerService],
  exports: [ScorerService],
})
export class ScorerModule {}
