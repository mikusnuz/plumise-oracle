import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineAssignment } from '../../entities/pipeline-assignment.entity';
import { PipelineService } from './pipeline.service';
import { PipelineController } from './pipeline.controller';
import { ChainModule } from '../chain/chain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PipelineAssignment]),
    ChainModule,
  ],
  providers: [PipelineService],
  controllers: [PipelineController],
  exports: [PipelineService],
})
export class PipelineModule {}
