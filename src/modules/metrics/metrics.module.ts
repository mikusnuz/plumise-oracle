import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InferenceMetrics } from '../../entities';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { ChainModule } from '../chain/chain.module';
import { NodesModule } from '../nodes/nodes.module';

@Module({
  imports: [TypeOrmModule.forFeature([InferenceMetrics]), ChainModule, NodesModule],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
