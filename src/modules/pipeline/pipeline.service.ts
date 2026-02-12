import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { verifyMessage } from 'viem';
import { PipelineAssignment } from '../../entities/pipeline-assignment.entity';
import { Logger } from '../../utils/logger';
import { ChainService } from '../chain/chain.service';
import { RegisterPipelineNodeDto } from './dto/register-pipeline-node.dto';
import { PipelineReadyDto } from './dto/pipeline-ready.dto';
import { PipelineGateway } from './pipeline.gateway';

const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Hardcoded model layer counts
const MODEL_LAYERS: Record<string, number> = {
  'bigscience/bloom-560m': 24,
  'meta-llama/Llama-3.1-8B': 32,
};

@Injectable()
export class PipelineService {
  private logger = new Logger('PipelineService');

  constructor(
    @InjectRepository(PipelineAssignment)
    private assignmentRepo: Repository<PipelineAssignment>,
    private chainService: ChainService,
    @Inject(forwardRef(() => PipelineGateway))
    private gateway: PipelineGateway,
  ) {}

  async verifyRegistrationSignature(dto: RegisterPipelineNodeDto): Promise<boolean> {
    try {
      const message = JSON.stringify({
        address: dto.address,
        grpcEndpoint: dto.grpcEndpoint,
        httpEndpoint: dto.httpEndpoint,
        model: dto.model,
        ramMb: dto.ramMb,
        device: dto.device,
        vramMb: dto.vramMb,
        timestamp: dto.timestamp,
      });

      const valid = await verifyMessage({
        address: dto.address as `0x${string}`,
        message,
        signature: dto.signature as `0x${string}`,
      });
      return valid;
    } catch (error) {
      this.logger.error('Signature verification failed', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  async verifyReadySignature(dto: PipelineReadyDto): Promise<boolean> {
    try {
      const message = JSON.stringify({
        address: dto.address,
        model: dto.model,
        timestamp: dto.timestamp,
      });

      const valid = await verifyMessage({
        address: dto.address as `0x${string}`,
        message,
        signature: dto.signature as `0x${string}`,
      });
      return valid;
    } catch (error) {
      this.logger.error('Signature verification failed', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  async isAgentRegisteredOnChain(address: string): Promise<boolean> {
    try {
      if (!this.chainService.agentRegistry) {
        this.logger.warn('AgentRegistry not configured, skipping on-chain verification');
        return true;
      }

      const result = await this.chainService.publicClient.request({
        method: 'agent_isAgentAccount' as any,
        params: [address, 'latest'] as any
      });
      return result === true;
    } catch (error) {
      this.logger.error('Failed to verify agent on-chain', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  async registerNode(dto: RegisterPipelineNodeDto): Promise<{ success: boolean; message: string }> {
    try {
      const address = dto.address.toLowerCase();

      // Verify on-chain registration
      const isRegistered = await this.isAgentRegisteredOnChain(address);
      if (!isRegistered) {
        return { success: false, message: 'Address not registered as agent on-chain' };
      }

      // Verify signature
      const validSignature = await this.verifyRegistrationSignature(dto);
      if (!validSignature) {
        return { success: false, message: 'Invalid signature' };
      }

      // Find or create assignment
      let assignment = await this.assignmentRepo.findOne({
        where: {
          nodeAddress: address,
          modelName: dto.model,
        },
      });

      const totalLayers = MODEL_LAYERS[dto.model] || 32;

      if (!assignment) {
        assignment = this.assignmentRepo.create({
          nodeAddress: address,
          modelName: dto.model,
          grpcEndpoint: dto.grpcEndpoint,
          httpEndpoint: dto.httpEndpoint,
          ramMb: dto.ramMb,
          device: dto.device,
          vramMb: dto.vramMb,
          totalLayers,
          layerStart: 0,
          layerEnd: 0,
          ready: false,
          pipelineOrder: 0,
        });
        this.logger.log(`New pipeline node registered: ${address} for ${dto.model}`);
      } else {
        // Update existing assignment
        assignment.grpcEndpoint = dto.grpcEndpoint;
        assignment.httpEndpoint = dto.httpEndpoint;
        assignment.ramMb = dto.ramMb;
        assignment.device = dto.device;
        assignment.vramMb = dto.vramMb;
        assignment.totalLayers = totalLayers;
        assignment.ready = false;
        this.logger.log(`Pipeline node updated: ${address} for ${dto.model}`);
      }

      const isNew = !assignment.id;
      await this.assignmentRepo.save(assignment);

      // Emit node joined event if new
      if (isNew) {
        this.gateway.emitNodeJoined(address, dto.model);
      }

      // Run layer assignment algorithm for this model
      await this.assignLayers(dto.model);

      return { success: true, message: 'Pipeline node registered successfully' };
    } catch (error) {
      this.logger.error('Failed to register pipeline node', error instanceof Error ? error.message : 'Unknown error');
      return { success: false, message: 'Internal server error' };
    }
  }

  async markReady(dto: PipelineReadyDto): Promise<{ success: boolean; message: string }> {
    try {
      const address = dto.address.toLowerCase();

      // Verify signature
      const validSignature = await this.verifyReadySignature(dto);
      if (!validSignature) {
        return { success: false, message: 'Invalid signature' };
      }

      const assignment = await this.assignmentRepo.findOne({
        where: {
          nodeAddress: address,
          modelName: dto.model,
        },
      });

      if (!assignment) {
        return { success: false, message: 'Pipeline node not found' };
      }

      assignment.ready = true;
      await this.assignmentRepo.save(assignment);

      // Emit node status change
      this.gateway.emitNodeStatusChange(address, dto.model, true);

      this.logger.log(`Pipeline node marked as ready: ${address} for ${dto.model}`);
      return { success: true, message: 'Pipeline node marked as ready' };
    } catch (error) {
      this.logger.error('Failed to mark pipeline node as ready', error instanceof Error ? error.message : 'Unknown error');
      return { success: false, message: 'Internal server error' };
    }
  }

  async getTopology(model: string): Promise<PipelineAssignment[]> {
    try {
      const cutoffTime = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

      const assignments = await this.assignmentRepo.find({
        where: {
          modelName: model,
        },
        order: {
          pipelineOrder: 'ASC',
        },
      });

      // Filter by recent updates (within heartbeat timeout)
      const activeAssignments = assignments.filter(a => a.updatedAt > cutoffTime);

      return activeAssignments;
    } catch (error) {
      this.logger.error('Failed to get pipeline topology', error instanceof Error ? error.message : 'Unknown error');
      return [];
    }
  }

  async assignLayers(model: string): Promise<void> {
    try {
      const cutoffTime = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

      // Get all active assignments for this model, sorted by creation time
      const assignments = await this.assignmentRepo.find({
        where: {
          modelName: model,
        },
        order: {
          createdAt: 'ASC',
        },
      });

      // Filter by recent updates
      const activeAssignments = assignments.filter(a => a.updatedAt > cutoffTime);

      if (activeAssignments.length === 0) {
        return;
      }

      const totalLayers = MODEL_LAYERS[model] || 32;

      if (activeAssignments.length === 1) {
        // Single node: assign all layers
        const assignment = activeAssignments[0];
        assignment.layerStart = 0;
        assignment.layerEnd = totalLayers;
        assignment.pipelineOrder = 0;
        assignment.totalLayers = totalLayers;
        await this.assignmentRepo.save(assignment);
        this.logger.log(`Assigned all layers [0, ${totalLayers}) to single node: ${assignment.nodeAddress}`);
        return;
      }

      // Multiple nodes: proportional split based on VRAM (or RAM for CPU nodes)
      const weights = activeAssignments.map(a => {
        if (a.device === 'cpu' || a.vramMb === 0) {
          return a.ramMb;
        }
        return a.vramMb;
      });

      const totalWeight = weights.reduce((sum, w) => sum + w, 0);

      if (totalWeight === 0) {
        // Equal distribution if no weight info
        const layersPerNode = Math.floor(totalLayers / activeAssignments.length);
        for (let i = 0; i < activeAssignments.length; i++) {
          const assignment = activeAssignments[i];
          assignment.layerStart = i * layersPerNode;
          assignment.layerEnd = i === activeAssignments.length - 1
            ? totalLayers
            : (i + 1) * layersPerNode;
          assignment.pipelineOrder = i;
          assignment.totalLayers = totalLayers;
          await this.assignmentRepo.save(assignment);
        }
        this.logger.log(`Assigned layers equally across ${activeAssignments.length} nodes`);
        return;
      }

      // Proportional distribution
      let currentLayer = 0;
      for (let i = 0; i < activeAssignments.length; i++) {
        const assignment = activeAssignments[i];
        const weight = weights[i];
        const proportion = weight / totalWeight;
        const layerCount = i === activeAssignments.length - 1
          ? totalLayers - currentLayer
          : Math.round(totalLayers * proportion);

        assignment.layerStart = currentLayer;
        assignment.layerEnd = currentLayer + layerCount;
        assignment.pipelineOrder = i;
        assignment.totalLayers = totalLayers;

        await this.assignmentRepo.save(assignment);

        this.logger.log(
          `Assigned layers [${assignment.layerStart}, ${assignment.layerEnd}) to node ${assignment.nodeAddress} ` +
          `(weight: ${weight}, device: ${assignment.device})`
        );

        currentLayer += layerCount;
      }

      // Emit topology change after layer assignment
      const topology = await this.getTopology(model);
      this.gateway.emitTopologyChange(model, topology);
    } catch (error) {
      this.logger.error('Failed to assign layers', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async removeStaleNodes(): Promise<void> {
    try {
      const cutoffTime = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

      // Get stale assignments before deletion
      const staleAssignments = await this.assignmentRepo.find({
        where: { updatedAt: LessThan(cutoffTime) },
      });

      if (staleAssignments.length === 0) {
        return;
      }

      // Delete stale assignments
      const result = await this.assignmentRepo
        .createQueryBuilder()
        .delete()
        .where('updatedAt < :cutoff', { cutoff: cutoffTime })
        .execute();

      if (result.affected && result.affected > 0) {
        this.logger.log(`Removed ${result.affected} stale pipeline assignments`);

        // Emit node left events
        for (const assignment of staleAssignments) {
          this.gateway.emitNodeLeft(assignment.nodeAddress, assignment.modelName);
        }

        // Get unique affected models
        const affectedModels = [...new Set(staleAssignments.map(a => a.modelName))];

        // Re-assign layers for affected models
        for (const modelName of affectedModels) {
          await this.assignLayers(modelName);
        }
      }
    } catch (error) {
      this.logger.error('Failed to remove stale nodes', error instanceof Error ? error.message : 'Unknown error');
    }
  }
}
