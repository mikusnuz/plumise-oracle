import { Module, Global } from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { ChainModule } from '../chain/chain.module';
import { NodesModule } from '../nodes/nodes.module';

@Global()
@Module({
  imports: [ChainModule, NodesModule],
  providers: [MonitorService],
  exports: [MonitorService],
})
export class MonitorModule {}
