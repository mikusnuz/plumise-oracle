import { Module, Global } from '@nestjs/common';
import { DistributorService } from './distributor.service';
import { ChainModule } from '../chain/chain.module';

@Global()
@Module({
  imports: [ChainModule],
  providers: [DistributorService],
  exports: [DistributorService],
})
export class DistributorModule {}
