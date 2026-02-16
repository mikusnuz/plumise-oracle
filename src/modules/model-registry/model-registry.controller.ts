import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ModelRegistryService } from './model-registry.service';
import { RegisterModelDto } from './dto/register-model.dto';
import { UpdateModelDto } from './dto/update-model.dto';
import { AddHashDto } from './dto/add-hash.dto';

@Controller('api/models')
export class ModelRegistryController {
  constructor(private modelRegistryService: ModelRegistryService) {}

  @Post()
  async registerModel(@Body() dto: RegisterModelDto) {
    const model = await this.modelRegistryService.registerModel(dto);
    return {
      modelId: model.modelId,
      displayName: model.displayName,
      activeParams: model.activeParams,
      totalParams: model.totalParams,
      arch: model.arch,
      minMemoryMb: model.minMemoryMb,
      totalLayers: model.totalLayers,
      multiplier: model.multiplier,
      status: model.status,
      createdAt: model.createdAt,
    };
  }

  @Get()
  async listModels() {
    const models = await this.modelRegistryService.getActiveModels();
    return models.map(m => ({
      modelId: m.modelId,
      displayName: m.displayName,
      activeParams: m.activeParams,
      totalParams: m.totalParams,
      arch: m.arch,
      minMemoryMb: m.minMemoryMb,
      totalLayers: m.totalLayers,
      multiplier: m.multiplier,
      status: m.status,
      createdAt: m.createdAt,
    }));
  }

  @Get('all')
  async listAllModels() {
    const models = await this.modelRegistryService.getAllModels();
    return models.map(m => ({
      modelId: m.modelId,
      displayName: m.displayName,
      activeParams: m.activeParams,
      totalParams: m.totalParams,
      arch: m.arch,
      minMemoryMb: m.minMemoryMb,
      totalLayers: m.totalLayers,
      multiplier: m.multiplier,
      status: m.status,
      createdAt: m.createdAt,
      deprecatedAt: m.deprecatedAt,
    }));
  }

  @Get(':id')
  async getModel(@Param('id') id: string) {
    const model = await this.modelRegistryService.getModel(id);
    const hashes = await this.modelRegistryService.getModelHashes(id);

    return {
      modelId: model.modelId,
      displayName: model.displayName,
      activeParams: model.activeParams,
      totalParams: model.totalParams,
      arch: model.arch,
      minMemoryMb: model.minMemoryMb,
      totalLayers: model.totalLayers,
      multiplier: model.multiplier,
      status: model.status,
      createdAt: model.createdAt,
      deprecatedAt: model.deprecatedAt,
      hashes: hashes.map(h => ({
        hash: h.ggufHash,
        quantType: h.quantType,
        fileSizeMb: h.fileSizeMb,
      })),
    };
  }

  @Patch(':id')
  async updateModel(@Param('id') id: string, @Body() dto: UpdateModelDto) {
    const model = await this.modelRegistryService.updateModel(id, dto);
    return {
      modelId: model.modelId,
      displayName: model.displayName,
      activeParams: model.activeParams,
      totalParams: model.totalParams,
      arch: model.arch,
      minMemoryMb: model.minMemoryMb,
      totalLayers: model.totalLayers,
      multiplier: model.multiplier,
      status: model.status,
      createdAt: model.createdAt,
      deprecatedAt: model.deprecatedAt,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deprecateModel(@Param('id') id: string) {
    await this.modelRegistryService.deprecateModel(id);
  }

  @Post(':id/hashes')
  async addHash(@Param('id') id: string, @Body() dto: AddHashDto) {
    const hash = await this.modelRegistryService.addHash(id, dto);
    return {
      id: hash.id,
      modelId: hash.modelId,
      hash: hash.ggufHash,
      quantType: hash.quantType,
      fileSizeMb: hash.fileSizeMb,
    };
  }

  @Delete(':id/hashes/:hash')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeHash(@Param('id') id: string, @Param('hash') hash: string) {
    await this.modelRegistryService.removeHash(id, hash);
  }
}
