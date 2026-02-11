import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReporterService } from './reporter.service';
import { ChainModule } from '../chain/chain.module';
import { MonitorModule } from '../monitor/monitor.module';
import { ScorerModule } from '../scorer/scorer.module';
import { Contribution } from '../../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contribution]),
    ChainModule,
    MonitorModule,
    ScorerModule,
  ],
  providers: [ReporterService],
  exports: [ReporterService],
})
export class ReporterModule {}
