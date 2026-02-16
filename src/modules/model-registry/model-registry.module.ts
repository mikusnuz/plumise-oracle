import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModelRegistry, ModelHash } from '../../entities';
import { ModelRegistryService } from './model-registry.service';
import { ModelRegistryController } from './model-registry.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ModelRegistry, ModelHash])],
  controllers: [ModelRegistryController],
  providers: [ModelRegistryService],
  exports: [ModelRegistryService],
})
export class ModelRegistryModule {}
