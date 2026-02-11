import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChainModule } from './modules/chain/chain.module';
import { MonitorModule } from './modules/monitor/monitor.module';
import { ScorerModule } from './modules/scorer/scorer.module';
import { ReporterModule } from './modules/reporter/reporter.module';
import { ChallengeModule } from './modules/challenge/challenge.module';
import { DistributorModule } from './modules/distributor/distributor.module';
import { SyncModule } from './modules/sync/sync.module';
import { ApiModule } from './modules/api/api.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { NodesModule } from './modules/nodes/nodes.module';
import { ProofModule } from './modules/proof/proof.module';
import { Agent, AgentNode, Challenge, Epoch, Contribution, NetworkStats, InferenceMetrics, InferenceProof } from './entities';
import { MonitorService } from './modules/monitor/monitor.service';
import { ChallengeService } from './modules/challenge/challenge.service';
import { DistributorService } from './modules/distributor/distributor.service';
import { SyncService } from './modules/sync/sync.service';
import { ScorerService } from './modules/scorer/scorer.service';
import { MetricsService } from './modules/metrics/metrics.service';
import { ChainService } from './modules/chain/chain.service';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), '.env'),
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get('DB_HOST', 'localhost'),
        port: parseInt(configService.get('DB_PORT', '15411')),
        username: configService.get('DB_USERNAME', 'root'),
        password: configService.get('DB_PASSWORD', 'plumbug!db!1q2w3e4r'),
        database: configService.get('DB_DATABASE', 'plumise_dashboard'),
        entities: [Agent, AgentNode, Challenge, Epoch, Contribution, NetworkStats, InferenceMetrics, InferenceProof],
        synchronize: true,
        logging: false,
      }),
    }),
    ChainModule,
    SyncModule,
    MonitorModule,
    ScorerModule,
    ReporterModule,
    ChallengeModule,
    DistributorModule,
    ApiModule,
    MetricsModule,
    NodesModule,
    ProofModule,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(
    @Inject(MonitorService) private monitorService: MonitorService,
    @Inject(ChallengeService) private challengeService: ChallengeService,
    @Inject(DistributorService) private distributorService: DistributorService,
    @Inject(SyncService) private syncService: SyncService,
    @Inject(ScorerService) private scorerService: ScorerService,
    @Inject(MetricsService) private metricsService: MetricsService,
    @Inject(ChainService) private chainService: ChainService,
  ) {}

  async onModuleInit() {
    this.monitorService.syncService = this.syncService;
    this.challengeService.setSyncService(this.syncService);
    this.distributorService.setSyncService(this.syncService);
    this.scorerService.setMetricsService(this.metricsService);
    this.scorerService.setChainService(this.chainService);

    // Initialize services after all modules are ready (ChainService connected)
    await this.challengeService.initialize();
    try {
      await this.syncService.initialSync();
    } catch (error) {
      // Non-fatal: monitor cycle will populate data over time
    }
  }
}
