import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModelRegistry, ModelHash } from '../../entities';
import { Logger } from '../../utils/logger';
import { RegisterModelDto } from './dto/register-model.dto';
import { UpdateModelDto } from './dto/update-model.dto';
import { AddHashDto } from './dto/add-hash.dto';

@Injectable()
export class ModelRegistryService {
  private logger = new Logger('ModelRegistryService');

  constructor(
    @InjectRepository(ModelRegistry)
    private modelRepo: Repository<ModelRegistry>,
    @InjectRepository(ModelHash)
    private hashRepo: Repository<ModelHash>,
  ) {}

  calculateMultiplier(activeParams: number, totalParams: number): number {
    const LAMBDA = 0.04;
    const ALPHA = 0.9;

    const activeB = activeParams / 1e9;
    const totalB = totalParams / 1e9;
    const effectiveB = activeB + LAMBDA * (totalB - activeB);

    return Math.floor(Math.pow(effectiveB, ALPHA) * 100);
  }

  async registerModel(dto: RegisterModelDto): Promise<ModelRegistry> {
    const existing = await this.modelRepo.findOne({ where: { modelId: dto.modelId } });
    if (existing) {
      throw new ConflictException(`Model ${dto.modelId} already exists`);
    }

    if (dto.activeParams > dto.totalParams) {
      throw new BadRequestException('activeParams cannot exceed totalParams');
    }

    const multiplier = this.calculateMultiplier(dto.activeParams, dto.totalParams);

    const model = this.modelRepo.create({
      modelId: dto.modelId,
      displayName: dto.displayName,
      activeParams: dto.activeParams.toString(),
      totalParams: dto.totalParams.toString(),
      arch: dto.arch,
      minMemoryMb: dto.minMemoryMb,
      totalLayers: dto.totalLayers,
      multiplier,
      status: dto.status || 'active',
    });

    await this.modelRepo.save(model);

    this.logger.log(`Model registered: ${dto.modelId} (multiplier=${multiplier})`);
    return model;
  }

  async getActiveModels(): Promise<ModelRegistry[]> {
    return await this.modelRepo.find({
      where: { status: 'active' },
      order: { multiplier: 'DESC' },
    });
  }

  async getAllModels(): Promise<ModelRegistry[]> {
    return await this.modelRepo.find({
      order: { status: 'ASC', multiplier: 'DESC' },
    });
  }

  async getModel(modelId: string): Promise<ModelRegistry> {
    const model = await this.modelRepo.findOne({ where: { modelId } });
    if (!model) {
      throw new NotFoundException(`Model ${modelId} not found`);
    }
    return model;
  }

  async updateModel(modelId: string, dto: UpdateModelDto): Promise<ModelRegistry> {
    const model = await this.getModel(modelId);

    if (dto.displayName !== undefined) {
      model.displayName = dto.displayName;
    }
    if (dto.arch !== undefined) {
      model.arch = dto.arch;
    }
    if (dto.minMemoryMb !== undefined) {
      model.minMemoryMb = dto.minMemoryMb;
    }
    if (dto.totalLayers !== undefined) {
      model.totalLayers = dto.totalLayers;
    }
    if (dto.status !== undefined) {
      model.status = dto.status;
      if (dto.status === 'deprecated' && !model.deprecatedAt) {
        model.deprecatedAt = new Date();
      }
    }

    if (dto.activeParams !== undefined || dto.totalParams !== undefined) {
      const activeParams = dto.activeParams !== undefined
        ? dto.activeParams
        : Number(model.activeParams);
      const totalParams = dto.totalParams !== undefined
        ? dto.totalParams
        : Number(model.totalParams);

      if (activeParams > totalParams) {
        throw new BadRequestException('activeParams cannot exceed totalParams');
      }

      model.activeParams = activeParams.toString();
      model.totalParams = totalParams.toString();
      model.multiplier = this.calculateMultiplier(activeParams, totalParams);
    }

    await this.modelRepo.save(model);

    this.logger.log(`Model updated: ${modelId}`);
    return model;
  }

  async deprecateModel(modelId: string): Promise<void> {
    const model = await this.getModel(modelId);

    if (model.status === 'deprecated' || model.status === 'disabled') {
      throw new BadRequestException(`Model ${modelId} is already ${model.status}`);
    }

    model.status = 'deprecated';
    model.deprecatedAt = new Date();

    await this.modelRepo.save(model);
    this.logger.log(`Model deprecated: ${modelId}`);
  }

  async disableModel(modelId: string): Promise<void> {
    const model = await this.getModel(modelId);

    if (model.status === 'disabled') {
      throw new BadRequestException(`Model ${modelId} is already disabled`);
    }

    model.status = 'disabled';
    if (!model.deprecatedAt) {
      model.deprecatedAt = new Date();
    }

    await this.modelRepo.save(model);
    this.logger.log(`Model disabled: ${modelId}`);
  }

  async addHash(modelId: string, dto: AddHashDto): Promise<ModelHash> {
    const model = await this.getModel(modelId);

    const existing = await this.hashRepo.findOne({
      where: { modelId, ggufHash: dto.ggufHash },
    });
    if (existing) {
      throw new ConflictException(`Hash ${dto.ggufHash} already exists for model ${modelId}`);
    }

    const hash = this.hashRepo.create({
      modelId,
      ggufHash: dto.ggufHash,
      quantType: dto.quantType,
      fileSizeMb: dto.fileSizeMb,
    });

    await this.hashRepo.save(hash);

    this.logger.log(`Hash added for model ${modelId}: ${dto.ggufHash.substring(0, 16)}...`);
    return hash;
  }

  async removeHash(modelId: string, hash: string): Promise<void> {
    const modelHash = await this.hashRepo.findOne({
      where: { modelId, ggufHash: hash },
    });
    if (!modelHash) {
      throw new NotFoundException(`Hash not found for model ${modelId}`);
    }

    await this.hashRepo.remove(modelHash);
    this.logger.log(`Hash removed from model ${modelId}: ${hash.substring(0, 16)}...`);
  }

  async verifyHash(modelId: string, hash: string): Promise<boolean> {
    const modelHash = await this.hashRepo.findOne({
      where: { modelId, ggufHash: hash },
    });
    return !!modelHash;
  }

  async getModelHashes(modelId: string): Promise<ModelHash[]> {
    await this.getModel(modelId);
    return await this.hashRepo.find({ where: { modelId } });
  }
}
