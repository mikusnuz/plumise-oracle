import { Module, Global } from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { ChainModule } from '../chain/chain.module';

@Global()
@Module({
  imports: [ChainModule],
  providers: [MonitorService],
  exports: [MonitorService],
})
export class MonitorModule {}
