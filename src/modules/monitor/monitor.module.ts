import { Module } from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { ChainModule } from '../chain/chain.module';

@Module({
  imports: [ChainModule],
  providers: [MonitorService],
  exports: [MonitorService],
})
export class MonitorModule {}
