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
import { NodesService } from '../nodes/nodes.service';

const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Hardcoded model layer counts
const MODEL_LAYERS: Record<string, number> = {
  'openai/gpt-oss-20b': 24,
  'ggml-org/gpt-oss-20b-GGUF': 24,
  'bigscience/bloom-560m': 24,
  'meta-llama/Llama-3.1-8B': 32,
};

@Injectable()
export class PipelineService {
  private logger = new Logger('PipelineService');
  // Re-audit #4 FIX: Monotonic timestamp guards for registration and ready endpoints
  private lastRegistrationTimestamp: Map<string, number> = new Map();
  private lastReadyTimestamp: Map<string, number> = new Map();

  constructor(
    @InjectRepository(PipelineAssignment)
    private assignmentRepo: Repository<PipelineAssignment>,
    private chainService: ChainService,
    @Inject(forwardRef(() => PipelineGateway))
    private gateway: PipelineGateway,
    private nodesService: NodesService,
  ) {}

  async verifyRegistrationSignature(dto: RegisterPipelineNodeDto): Promise<boolean> {
    try {
      // OR-02 FIX: Anti-replay protection with timestamp freshness check
      const now = Math.floor(Date.now() / 1000);
      const timestampDiff = Math.abs(now - dto.timestamp);
      const TIMESTAMP_WINDOW_SECONDS = 60;

      if (timestampDiff > TIMESTAMP_WINDOW_SECONDS) {
        this.logger.warn(`Timestamp outside valid window: ${timestampDiff}s difference for ${dto.address}`);
        return false;
      }

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
      // OR-02 FIX: Anti-replay protection with timestamp freshness check
      const now = Math.floor(Date.now() / 1000);
      const timestampDiff = Math.abs(now - dto.timestamp);
      const TIMESTAMP_WINDOW_SECONDS = 60;

      if (timestampDiff > TIMESTAMP_WINDOW_SECONDS) {
        this.logger.warn(`Timestamp outside valid window: ${timestampDiff}s difference for ${dto.address}`);
        return false;
      }

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

  async registerNode(dto: RegisterPipelineNodeDto): Promise<{ success: boolean; message: string; layerStart?: number; layerEnd?: number; totalLayers?: number }> {
    try {
      const address = dto.address.toLowerCase();

      // Reject non-pipeline nodes: real pipeline nodes must have separate gRPC and HTTP endpoints
      // (e.g., gRPC:50051 for layer forwarding, HTTP:31331 for health).
      // Nodes with grpcEndpoint === httpEndpoint (like agent-app) cannot participate in gRPC pipeline.
      if (dto.grpcEndpoint && dto.httpEndpoint && dto.grpcEndpoint === dto.httpEndpoint) {
        this.logger.warn(`Rejected pipeline registration from ${address}: grpcEndpoint === httpEndpoint (not a pipeline node)`);
        return { success: false, message: 'Pipeline nodes must have separate gRPC and HTTP endpoints' };
      }

      // Re-audit #4 FIX: Monotonic timestamp guard prevents replay within the 60s window
      const lastTs = this.lastRegistrationTimestamp.get(address) || 0;
      if (dto.timestamp <= lastTs) {
        this.logger.warn(`Rejected pipeline registration replay from ${address}: timestamp ${dto.timestamp} <= last ${lastTs}`);
        return { success: false, message: 'Replay detected: timestamp must be strictly increasing' };
      }

      // Verify signature first (before any on-chain actions)
      const validSignature = await this.verifyRegistrationSignature(dto);
      if (!validSignature) {
        return { success: false, message: 'Invalid signature' };
      }

      // Verify on-chain registration; sponsor-register if not yet registered
      let isRegistered = await this.isAgentRegisteredOnChain(address);
      if (!isRegistered) {
        try {
          this.logger.log(`Agent ${address} not registered on-chain, sponsoring registration...`);
          await this.chainService.sponsorRegisterAgent(address, dto.model);
          isRegistered = await this.isAgentRegisteredOnChain(address);
          if (!isRegistered) {
            return { success: false, message: 'Sponsor registration tx succeeded but agent still not found on-chain' };
          }
          this.logger.log(`Agent ${address} sponsor-registered on-chain successfully`);
        } catch (error) {
          this.logger.error(`Sponsor registration failed for ${address}`, error instanceof Error ? error.message : 'Unknown error');
          return { success: false, message: `Sponsor registration failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
      }

      // Find or create assignment
      let assignment = await this.assignmentRepo.findOne({
        where: {
          nodeAddress: address,
          modelName: dto.model,
        },
      });

      const totalLayers = MODEL_LAYERS[dto.model] || 32;

      // OR-06 FIX: Use upsert pattern to handle unique constraint properly
      const isNew = !assignment;

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

      try {
        await this.assignmentRepo.save(assignment);
      } catch (error) {
        // Handle race condition if unique constraint was violated
        if (error instanceof Error && error.message.includes('Duplicate entry')) {
          this.logger.warn(`Duplicate pipeline assignment detected, retrying update for ${address}/${dto.model}`);
          const existing = await this.assignmentRepo.findOne({
            where: { nodeAddress: address, modelName: dto.model },
          });
          if (existing) {
            existing.grpcEndpoint = dto.grpcEndpoint;
            existing.httpEndpoint = dto.httpEndpoint;
            existing.ramMb = dto.ramMb;
            existing.device = dto.device;
            existing.vramMb = dto.vramMb;
            existing.totalLayers = totalLayers;
            existing.ready = false;
            await this.assignmentRepo.save(existing);
          }
        } else {
          throw error;
        }
      }

      // Emit node joined event if new
      if (isNew) {
        this.gateway.emitNodeJoined(address, dto.model);
      }

      // Run layer assignment algorithm for this model
      await this.assignLayers(dto.model);

      // Re-fetch assignment to return updated layer range
      const updated = await this.assignmentRepo.findOne({
        where: { nodeAddress: address, modelName: dto.model },
      });

      // Re-audit #4 FIX: Update monotonic timestamp after successful registration
      this.lastRegistrationTimestamp.set(address, dto.timestamp);

      // Ensure agent_nodes entry exists (for dashboard/monitor discovery)
      await this.nodesService.ensureNodeRegistered(address);

      return {
        success: true,
        message: 'Pipeline node registered successfully',
        layerStart: updated?.layerStart ?? 0,
        layerEnd: updated?.layerEnd ?? 0,
        totalLayers: updated?.totalLayers ?? totalLayers,
      };
    } catch (error) {
      this.logger.error('Failed to register pipeline node', error instanceof Error ? error.message : 'Unknown error');
      return { success: false, message: 'Internal server error' };
    }
  }

  async markReady(dto: PipelineReadyDto): Promise<{ success: boolean; message: string }> {
    try {
      const address = dto.address.toLowerCase();

      // Re-audit #4 FIX: Monotonic timestamp guard prevents replay within the 60s window
      const lastTs = this.lastReadyTimestamp.get(address) || 0;
      if (dto.timestamp <= lastTs) {
        this.logger.warn(`Rejected pipeline ready replay from ${address}: timestamp ${dto.timestamp} <= last ${lastTs}`);
        return { success: false, message: 'Replay detected: timestamp must be strictly increasing' };
      }

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

      // Re-audit #4 FIX: Update monotonic timestamp after successful ready
      this.lastReadyTimestamp.set(address, dto.timestamp);

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
      // Also exclude non-pipeline nodes (grpcEndpoint === httpEndpoint)
      const activeAssignments = assignments.filter(
        a => a.updatedAt > cutoffTime && a.grpcEndpoint !== a.httpEndpoint,
      );

      // Also include standalone agent nodes (agent-app) that serve this model
      const totalLayers = MODEL_LAYERS[model] || 32;
      const standaloneNodes = await this.getStandaloneNodes(model, totalLayers, activeAssignments);

      return [...activeAssignments, ...standaloneNodes];
    } catch (error) {
      this.logger.error('Failed to get pipeline topology', error instanceof Error ? error.message : 'Unknown error');
      return [];
    }
  }

  /**
   * Get standalone agent nodes (e.g. agent-app with full GGUF model) from agent_nodes table.
   * These serve all layers and are shown alongside pipeline nodes in the topology.
   */
  private async getStandaloneNodes(
    model: string,
    totalLayers: number,
    existingPipeline: PipelineAssignment[],
  ): Promise<PipelineAssignment[]> {
    try {
      const activeNodes = await this.nodesService.getActiveNodes();
      const pipelineAddresses = new Set(existingPipeline.map(a => a.nodeAddress.toLowerCase()));

      const result: PipelineAssignment[] = [];
      for (const node of activeNodes) {
        if (pipelineAddresses.has(node.address.toLowerCase())) continue;

        // Check if node serves this model (capabilities contains model name or "inference")
        const servesModel = node.capabilities?.some(
          cap => cap === model || cap === 'openai/gpt-oss-20b',
        );
        if (!servesModel) continue;

        const virtual = new PipelineAssignment();
        virtual.nodeAddress = node.address;
        virtual.modelName = model;
        virtual.layerStart = 0;
        virtual.layerEnd = totalLayers;
        virtual.totalLayers = totalLayers;
        virtual.grpcEndpoint = `standalone://${node.address}`;
        virtual.httpEndpoint = node.endpoint || '';
        virtual.ramMb = 0;
        virtual.device = 'auto';
        virtual.vramMb = 0;
        virtual.ready = true;
        virtual.pipelineOrder = 999;
        virtual.createdAt = node.createdAt;
        virtual.updatedAt = node.updatedAt;
        result.push(virtual);
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to get standalone nodes', error instanceof Error ? error.message : 'Unknown error');
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

      // Filter by recent updates and exclude non-pipeline nodes (grpcEndpoint === httpEndpoint)
      const activeAssignments = assignments.filter(
        a => a.updatedAt > cutoffTime && a.grpcEndpoint !== a.httpEndpoint,
      );

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
        if (a.device === 'cpu' || Number(a.vramMb) === 0) {
          return Number(a.ramMb) || 1;
        }
        return Number(a.vramMb) || 1;
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

  /**
   * Send sponsored heartbeats for all active pipeline nodes.
   * Agents with 0 PLM cannot heartbeat themselves, so Oracle does it for them.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sendSponsoredHeartbeats(): Promise<void> {
    try {
      const cutoffTime = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
      const assignments = await this.assignmentRepo.find();
      const activeAssignments = assignments.filter(a => a.updatedAt > cutoffTime);

      if (activeAssignments.length === 0) return;

      // Deduplicate by address (one heartbeat per agent)
      const uniqueAddresses = [...new Set(activeAssignments.map(a => a.nodeAddress))];

      for (const addr of uniqueAddresses) {
        try {
          await this.chainService.sponsorHeartbeat(addr);
          this.logger.debug(`Sponsored heartbeat sent for ${addr}`);
        } catch (error) {
          this.logger.warn(`Sponsored heartbeat failed for ${addr}: ${error instanceof Error ? error.message : 'Unknown'}`);
        }
      }

      if (uniqueAddresses.length > 0) {
        this.logger.log(`Sent sponsored heartbeats for ${uniqueAddresses.length} agents`);
      }
    } catch (error) {
      this.logger.error('Failed to send sponsored heartbeats', error instanceof Error ? error.message : 'Unknown error');
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
