import { Module } from '@nestjs/common';
import { ChallengeService } from './challenge.service';
import { ChainModule } from '../chain/chain.module';
import { ScorerModule } from '../scorer/scorer.module';

@Module({
  imports: [ChainModule, ScorerModule],
  providers: [ChallengeService],
  exports: [ChallengeService],
})
export class ChallengeModule {}
