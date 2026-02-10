import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ChainModule } from './modules/chain/chain.module';
import { MonitorModule } from './modules/monitor/monitor.module';
import { ScorerModule } from './modules/scorer/scorer.module';
import { ReporterModule } from './modules/reporter/reporter.module';
import { ChallengeModule } from './modules/challenge/challenge.module';
import { DistributorModule } from './modules/distributor/distributor.module';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), '.env'),
    }),
    ScheduleModule.forRoot(),
    ChainModule,
    MonitorModule,
    ScorerModule,
    ReporterModule,
    ChallengeModule,
    DistributorModule,
  ],
})
export class AppModule {}
