import { Module, forwardRef } from '@nestjs/common';
import { ScorerService } from './scorer.service';
import { NodesModule } from '../nodes/nodes.module';

@Module({
  imports: [NodesModule],
  providers: [ScorerService],
  exports: [ScorerService],
})
export class ScorerModule {}
