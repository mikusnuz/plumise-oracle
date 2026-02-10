import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncService } from './sync.service';
import { Agent, Challenge, Epoch, Contribution, NetworkStats } from '../../entities';
import { ChainModule } from '../chain/chain.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Agent, Challenge, Epoch, Contribution, NetworkStats]),
    ChainModule,
  ],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
