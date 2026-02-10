import { Module, Global } from '@nestjs/common';
import { ChallengeService } from './challenge.service';
import { ChainModule } from '../chain/chain.module';
import { ScorerModule } from '../scorer/scorer.module';

@Global()
@Module({
  imports: [ChainModule, ScorerModule],
  providers: [ChallengeService],
  exports: [ChallengeService],
})
export class ChallengeModule {}
