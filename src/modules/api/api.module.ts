import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiController } from './api.controller';
import { Agent, Challenge, Epoch, Contribution, NetworkStats } from '../../entities';
import { ChainModule } from '../chain/chain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Agent, Challenge, Epoch, Contribution, NetworkStats]),
    ChainModule,
  ],
  controllers: [ApiController],
})
export class ApiModule {}
