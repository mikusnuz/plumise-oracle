import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentNode, PipelineAssignment } from '../../entities';
import { ClusterService } from './cluster.service';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentNode, PipelineAssignment]),
    PipelineModule,
  ],
  providers: [ClusterService],
  exports: [ClusterService],
})
export class ClusterModule {}
