import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentNode } from '../../entities';
import { NodesService } from './nodes.service';
import { ChainModule } from '../chain/chain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentNode]),
    ChainModule,
  ],
  providers: [NodesService],
  exports: [NodesService],
})
export class NodesModule {}
