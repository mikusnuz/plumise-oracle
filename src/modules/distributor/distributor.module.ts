import { Module } from '@nestjs/common';
import { DistributorService } from './distributor.service';
import { ChainModule } from '../chain/chain.module';

@Module({
  imports: [ChainModule],
  providers: [DistributorService],
  exports: [DistributorService],
})
export class DistributorModule {}
