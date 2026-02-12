import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent } from '../../entities';
import { WatcherService } from './watcher.service';
import { ChainModule } from '../chain/chain.module';

@Module({
  imports: [TypeOrmModule.forFeature([Agent]), ChainModule],
  providers: [WatcherService],
  exports: [WatcherService],
})
export class WatcherModule {}
