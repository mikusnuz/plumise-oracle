import { Module } from '@nestjs/common';
import { ReporterService } from './reporter.service';
import { ChainModule } from '../chain/chain.module';
import { MonitorModule } from '../monitor/monitor.module';
import { ScorerModule } from '../scorer/scorer.module';

@Module({
  imports: [ChainModule, MonitorModule, ScorerModule],
  providers: [ReporterService],
  exports: [ReporterService],
})
export class ReporterModule {}
