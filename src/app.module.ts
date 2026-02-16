import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { WatcherModule } from './modules/watcher/watcher.module';
import { ClusterModule } from './modules/cluster/cluster.module';
import { ClusterService } from './modules/cluster/cluster.service';
import { Agent, AgentNode, Challenge, Epoch, Contribution, NetworkStats, InferenceMetrics, InferenceProof, PipelineAssignment } from './entities';
import { NodesService } from './modules/nodes/nodes.service';
import { MonitorService } from './modules/monitor/monitor.service';
import { ChallengeService } from './modules/challenge/challenge.service';
import { DistributorService } from './modules/distributor/distributor.service';
import { SyncService } from './modules/sync/sync.service';
import { ScorerService } from './modules/scorer/scorer.service';
import { MetricsService } from './modules/metrics/metrics.service';
import { ChainService } from './modules/chain/chain.service';
import { WatcherService } from './modules/watcher/watcher.service';
import { Logger } from './utils/logger';
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
      useFactory: (configService: ConfigService) => {
        // OR-07 FIX: Production-safe defaults
        const nodeEnv = configService.get('NODE_ENV', 'development');
        const password = configService.get('DB_PASSWORD');

        if (!password) {
          if (nodeEnv === 'production') {
            throw new Error('DB_PASSWORD environment variable is required in production');
          }
          console.warn('[DEV] DB_PASSWORD not set, using development default');
        }

        return {
          type: 'mysql',
          host: configService.get('DB_HOST', 'localhost'),
          port: parseInt(configService.get('DB_PORT', '15411')),
          username: configService.get('DB_USERNAME', 'root'),
          password: password || 'plumbug!db!1q2w3e4r',
          database: configService.get('DB_DATABASE', 'plumise_dashboard'),
          entities: [Agent, AgentNode, Challenge, Epoch, Contribution, NetworkStats, InferenceMetrics, InferenceProof, PipelineAssignment],
          synchronize: nodeEnv !== 'production', // OR-07 FIX: Disable auto-sync in production
          logging: false,
        };
      },
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
    PipelineModule,
    WatcherModule,
    ClusterModule,
  ],
})
export class AppModule implements OnModuleInit {
  private logger = new Logger('AppModule');

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    @Inject(ConfigService) private configService: ConfigService,
    @Inject(NodesService) private nodesService: NodesService,
    @Inject(ClusterService) private clusterService: ClusterService,
    @Inject(MonitorService) private monitorService: MonitorService,
    @Inject(ChallengeService) private challengeService: ChallengeService,
    @Inject(DistributorService) private distributorService: DistributorService,
    @Inject(SyncService) private syncService: SyncService,
    @Inject(ScorerService) private scorerService: ScorerService,
    @Inject(MetricsService) private metricsService: MetricsService,
    @Inject(ChainService) private chainService: ChainService,
    @Inject(WatcherService) private watcherService: WatcherService,
  ) {}

  async onModuleInit() {
    // OR-04 FIX: Verify migration state in production before starting
    const nodeEnv = this.configService.get('NODE_ENV', 'development');
    if (nodeEnv === 'production') {
      await this.verifyMigrations();
    }

    this.nodesService.setClusterService(this.clusterService);
    this.monitorService.syncService = this.syncService;
    this.challengeService.setSyncService(this.syncService);
    this.distributorService.setSyncService(this.syncService);
    this.scorerService.setMetricsService(this.metricsService);
    this.scorerService.setChainService(this.chainService);
    this.metricsService.setScorerService(this.scorerService); // OR-03 FIX
    this.watcherService.setSyncService(this.syncService);

    // Initialize services after all modules are ready (ChainService connected)
    await this.challengeService.initialize();
    try {
      await this.syncService.initialSync();
    } catch (error) {
      // Non-fatal: monitor cycle will populate data over time
    }
  }

  private async verifyMigrations(): Promise<void> {
    try {
      this.logger.log('Verifying database schema migrations...');

      // Verify agent_nodes table exists (migration 001)
      const agentNodesCheck = await this.dataSource.query(
        `SELECT COUNT(*) as count FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_nodes'`,
      );

      if (agentNodesCheck[0].count === 0) {
        throw new Error(
          'MIGRATION FAILED: agent_nodes table does not exist. ' +
          'Please run migration 001_add_agent_nodes_table.sql',
        );
      }

      // Verify inference_metrics has lastRawTokens and lastRawRequests columns (migration 002)
      const metricsColumnsCheck = await this.dataSource.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'inference_metrics'
         AND COLUMN_NAME IN ('lastRawTokens', 'lastRawRequests')`,
      );

      const columnNames = metricsColumnsCheck.map((row: any) => row.COLUMN_NAME);

      if (!columnNames.includes('lastRawTokens') || !columnNames.includes('lastRawRequests')) {
        throw new Error(
          'MIGRATION FAILED: inference_metrics table is missing required columns. ' +
          'Missing columns: ' +
          (!columnNames.includes('lastRawTokens') ? 'lastRawTokens ' : '') +
          (!columnNames.includes('lastRawRequests') ? 'lastRawRequests ' : '') +
          '\nPlease run migration 002_add_inference_metrics_raw_columns.sql',
        );
      }

      // Verify pipeline_assignments has benchmarkTokPerSec column (migration 003)
      const pipelineColumnsCheck = await this.dataSource.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'pipeline_assignments'
         AND COLUMN_NAME = 'benchmarkTokPerSec'`,
      );

      if (pipelineColumnsCheck.length === 0) {
        this.logger.warn(
          'MIGRATION WARNING: pipeline_assignments.benchmarkTokPerSec column missing. ' +
          'Run: ALTER TABLE pipeline_assignments ADD COLUMN benchmarkTokPerSec FLOAT DEFAULT 0;',
        );
      }

      this.logger.log('Database schema verification passed');
    } catch (error) {
      this.logger.error('Database migration verification failed', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }
}
