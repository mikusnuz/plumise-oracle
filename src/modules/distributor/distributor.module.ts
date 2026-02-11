import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DistributorService } from './distributor.service';
import { ChainModule } from '../chain/chain.module';
import { Contribution } from '../../entities';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Contribution]),
    ChainModule,
  ],
  providers: [DistributorService],
  exports: [DistributorService],
})
export class DistributorModule {}
