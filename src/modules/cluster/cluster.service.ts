import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { AgentNode, PipelineAssignment } from '../../entities';
import { Logger } from '../../utils/logger';
import { ClusterAssignment } from '../nodes/nodes.service';
import { PipelineGateway } from '../pipeline/pipeline.gateway';
import { randomBytes } from 'crypto';

// Model memory requirements in MB (minimum RAM to load full model)
const MODEL_MEMORY_REQUIREMENTS: Record<string, number> = {
  'qwen/qwen3-32b': 20_000,            // ~20GB Q4
  'qwen/qwen3.5-397b-a17b': 220_000,   // ~220GB Q4
};

const MODEL_LAYERS: Record<string, number> = {
  'qwen/qwen3-32b': 64,
  'qwen/qwen3.5-397b-a17b': 96,
};

const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000;
const CLUSTER_MIN_AGE_MS = 5 * 60 * 1000;       // 5 min minimum before re-formation
const NODE_OFFLINE_GRACE_MS = 2 * 60 * 1000;     // 2 min grace before dissolving cluster

interface ClusterInfo {
  id: string;
  modelName: string;
  coordinatorAddress: string;
  members: ClusterMember[];
  createdAt: number;
  lastValidatedAt: number;
}

interface ClusterMember {
  address: string;
  mode: 'coordinator' | 'rpc-server';
  lanIp: string;
  rpcPort: number;
  tokPerSec: number;
  availableMemoryMb: number;
  layerStart: number;
  layerEnd: number;
}

@Injectable()
export class ClusterService {
  private logger = new Logger('ClusterService');
  // In-memory cluster state (source of truth is DB, this is cache)
  private clusters: Map<string, ClusterInfo> = new Map();
  private nodeOfflineTimestamps: Map<string, number> = new Map();

  constructor(
    @InjectRepository(AgentNode)
    private nodeRepo: Repository<AgentNode>,
    @InjectRepository(PipelineAssignment)
    private assignmentRepo: Repository<PipelineAssignment>,
    private gateway: PipelineGateway,
  ) {}

  /**
   * Get the cluster assignment for a specific node.
   * Returns undefined if node is standalone.
   */
  async getNodeAssignment(address: string): Promise<ClusterAssignment | undefined> {
    const addr = address.toLowerCase();

    // Check pipeline_assignments for cluster info
    const assignments = await this.assignmentRepo.find({
      where: { nodeAddress: addr },
    });

    // Find assignment that's part of a cluster
    const clustered = assignments.find(a => a.clusterId && a.nodeMode !== 'standalone');
    if (!clustered) return undefined;

    // If coordinator, gather rpcPeers
    let rpcPeers: string[] | null = null;
    if (clustered.nodeMode === 'coordinator' && clustered.clusterId) {
      const clusterMembers = await this.assignmentRepo.find({
        where: { clusterId: clustered.clusterId! },
      });
      rpcPeers = clusterMembers
        .filter(m => m.nodeMode === 'rpc-server' && m.lanIp)
        .map(m => `${m.lanIp}:${m.rpcPort}`);
    }

    return {
      mode: clustered.nodeMode as 'standalone' | 'rpc-server' | 'coordinator',
      clusterId: clustered.clusterId,
      rpcPort: clustered.rpcPort,
      rpcPeers,
    };
  }

  /**
   * Main cluster formation algorithm.
   * Called on node registration, stale removal, and periodic rebalancing.
   */
  async formClusters(modelName?: string): Promise<void> {
    try {
      const models = modelName ? [modelName] : Object.keys(MODEL_LAYERS);

      for (const model of models) {
        await this.formClustersForModel(model);
      }
    } catch (error) {
      this.logger.error('Cluster formation failed', error instanceof Error ? error.message : 'Unknown');
    }
  }

  private async formClustersForModel(model: string): Promise<void> {
    const totalLayers = MODEL_LAYERS[model] || 32;
    const requiredMemoryMb = MODEL_MEMORY_REQUIREMENTS[model] || 12_000;
    const cutoffTime = String(Math.floor((Date.now() - HEARTBEAT_TIMEOUT_MS) / 1000));

    // Get all active nodes that can distribute for this model
    const allNodes = await this.nodeRepo.find({ where: { status: 'active' } });
    const activeNodes = allNodes.filter(
      n => BigInt(n.lastHeartbeat) > BigInt(cutoffTime)
        && n.canDistribute
        && n.lanIp
    );

    if (activeNodes.length === 0) return;

    // Separate: nodes that CAN run standalone vs those that NEED clustering
    const standaloneCapable: AgentNode[] = [];
    const needsClustering: AgentNode[] = [];

    for (const node of activeNodes) {
      const availMem = this.getAvailableMemory(node);
      if (availMem >= requiredMemoryMb) {
        standaloneCapable.push(node);
      } else {
        needsClustering.push(node);
      }
    }

    // Standalone-capable nodes: keep as standalone (no cluster needed)
    for (const node of standaloneCapable) {
      await this.ensureStandaloneAssignment(node, model, totalLayers);
    }

    // Nodes that can't run solo: group by LAN subnet
    const subnetGroups = this.groupBySubnet(needsClustering);

    for (const [subnet, nodes] of subnetGroups) {
      // Check if existing cluster is still valid (sticky + min age)
      const existingCluster = this.findExistingCluster(subnet, model);
      if (existingCluster && !this.shouldReformCluster(existingCluster, nodes)) {
        continue;
      }

      // Greedy cluster formation: add nodes by tok/s until memory requirement met
      await this.formClusterFromNodes(nodes, model, totalLayers, requiredMemoryMb);
    }
  }

  /**
   * Form a cluster from a group of nodes on the same subnet.
   */
  private async formClusterFromNodes(
    nodes: AgentNode[],
    model: string,
    totalLayers: number,
    requiredMemoryMb: number,
  ): Promise<void> {
    // Sort by tok/s descending (strongest nodes first)
    const sorted = [...nodes].sort((a, b) => b.benchmarkTokPerSec - a.benchmarkTokPerSec);

    let totalMemory = 0;
    const selected: AgentNode[] = [];

    for (const node of sorted) {
      selected.push(node);
      totalMemory += this.getAvailableMemory(node);
      if (totalMemory >= requiredMemoryMb) break;
    }

    if (totalMemory < requiredMemoryMb) {
      this.logger.warn(
        `Subnet group has insufficient memory for ${model}: ` +
        `${totalMemory}MB < ${requiredMemoryMb}MB (${selected.length} nodes)`
      );
      return;
    }

    if (selected.length < 2) return; // Need at least 2 nodes for a cluster

    // Coordinator = highest tok/s node
    const coordinator = selected[0];
    const clusterId = `cluster-${randomBytes(8).toString('hex')}`;

    // Distribute layers proportional to tok/s
    const totalTokPerSec = selected.reduce((sum, n) => sum + (n.benchmarkTokPerSec || 1), 0);
    let currentLayer = 0;

    for (let i = 0; i < selected.length; i++) {
      const node = selected[i];
      const isCoordinator = node.address === coordinator.address;
      const tokPerSec = node.benchmarkTokPerSec || 1;
      const proportion = tokPerSec / totalTokPerSec;

      let layerCount: number;
      if (i === selected.length - 1) {
        layerCount = totalLayers - currentLayer;
      } else {
        layerCount = Math.max(1, Math.round(totalLayers * proportion));
        // Ensure we don't exceed total
        if (currentLayer + layerCount > totalLayers) {
          layerCount = totalLayers - currentLayer;
        }
      }

      // Also verify memory constraint per layer
      const memPerLayer = requiredMemoryMb / totalLayers;
      const maxLayersForNode = Math.floor(this.getAvailableMemory(node) / memPerLayer);
      if (layerCount > maxLayersForNode) {
        layerCount = Math.max(1, maxLayersForNode);
      }

      await this.upsertClusterAssignment(node, model, {
        layerStart: currentLayer,
        layerEnd: currentLayer + layerCount,
        totalLayers,
        nodeMode: isCoordinator ? 'coordinator' : 'rpc-server',
        clusterId,
        rpcPort: 50052,
        lanIp: node.lanIp,
      });

      currentLayer += layerCount;
    }

    // Cache cluster info
    this.clusters.set(clusterId, {
      id: clusterId,
      modelName: model,
      coordinatorAddress: coordinator.address,
      members: selected.map((n, i) => ({
        address: n.address,
        mode: n.address === coordinator.address ? 'coordinator' : 'rpc-server',
        lanIp: n.lanIp!,
        rpcPort: 50052,
        tokPerSec: n.benchmarkTokPerSec || 1,
        availableMemoryMb: this.getAvailableMemory(n),
        layerStart: 0, // will be set from DB
        layerEnd: 0,
      })),
      createdAt: Date.now(),
      lastValidatedAt: Date.now(),
    });

    this.logger.log(
      `Cluster ${clusterId} formed for ${model}: ` +
      `coordinator=${coordinator.address.slice(0, 10)}, ` +
      `${selected.length} nodes, ${totalLayers} layers, ` +
      `total tok/s=${totalTokPerSec.toFixed(1)}`
    );

    // Emit topology change
    const topology = await this.assignmentRepo.find({
      where: { clusterId },
      order: { pipelineOrder: 'ASC' },
    });
    this.gateway.emitTopologyChange(model, topology);
  }

  /**
   * Ensure a standalone node has proper assignment.
   */
  private async ensureStandaloneAssignment(
    node: AgentNode,
    model: string,
    totalLayers: number,
  ): Promise<void> {
    let assignment = await this.assignmentRepo.findOne({
      where: { nodeAddress: node.address, modelName: model },
    });

    if (assignment && assignment.nodeMode === 'standalone') return; // Already standalone

    if (!assignment) {
      assignment = this.assignmentRepo.create({
        nodeAddress: node.address,
        modelName: model,
        grpcEndpoint: `standalone://${node.address}`,
        httpEndpoint: node.endpoint || '',
        ramMb: 0,
        device: 'auto',
        vramMb: 0,
        benchmarkTokPerSec: node.benchmarkTokPerSec,
      });
    }

    assignment.layerStart = 0;
    assignment.layerEnd = totalLayers;
    assignment.totalLayers = totalLayers;
    assignment.nodeMode = 'standalone';
    assignment.clusterId = null;
    assignment.pipelineOrder = 0;
    assignment.ready = true;

    await this.assignmentRepo.save(assignment);
  }

  /**
   * Upsert a cluster member's pipeline assignment.
   */
  private async upsertClusterAssignment(
    node: AgentNode,
    model: string,
    data: {
      layerStart: number;
      layerEnd: number;
      totalLayers: number;
      nodeMode: string;
      clusterId: string;
      rpcPort: number;
      lanIp: string | null;
    },
  ): Promise<void> {
    let assignment = await this.assignmentRepo.findOne({
      where: { nodeAddress: node.address, modelName: model },
    });

    if (!assignment) {
      assignment = this.assignmentRepo.create({
        nodeAddress: node.address,
        modelName: model,
        grpcEndpoint: `rpc://${node.lanIp}:${data.rpcPort}`,
        httpEndpoint: node.endpoint || '',
        ramMb: 0,
        device: 'auto',
        vramMb: 0,
        benchmarkTokPerSec: node.benchmarkTokPerSec,
      });
    }

    assignment.layerStart = data.layerStart;
    assignment.layerEnd = data.layerEnd;
    assignment.totalLayers = data.totalLayers;
    assignment.nodeMode = data.nodeMode;
    assignment.clusterId = data.clusterId;
    assignment.rpcPort = data.rpcPort;
    assignment.lanIp = data.lanIp;
    assignment.pipelineOrder = data.layerStart; // order by layer position
    assignment.ready = false; // will be set true when node confirms

    await this.assignmentRepo.save(assignment);
  }

  /**
   * Group nodes by /24 subnet (same LAN).
   */
  private groupBySubnet(nodes: AgentNode[]): Map<string, AgentNode[]> {
    const groups = new Map<string, AgentNode[]>();

    for (const node of nodes) {
      if (!node.lanIp) continue;
      const subnet = this.getSubnet(node.lanIp);
      const group = groups.get(subnet) || [];
      group.push(node);
      groups.set(subnet, group);
    }

    return groups;
  }

  /**
   * Extract /24 subnet from IP address (e.g., "192.168.0.101" → "192.168.0").
   */
  private getSubnet(ip: string): string {
    const parts = ip.split('.');
    return parts.slice(0, 3).join('.');
  }

  /**
   * Get available memory for a node (VRAM for GPU, RAM for CPU).
   */
  private getAvailableMemory(node: AgentNode): number {
    // benchmarkTokPerSec already captures GPU vs CPU efficiency
    // For memory calculation, use whatever's available
    // We don't have direct VRAM/RAM fields on AgentNode, estimate from benchmark
    // TODO: agent-app should report ramMb/vramMb during registration
    // For now, use a heuristic: higher tok/s = more capable hardware
    // Base assumption: 8GB minimum for any node that opted in
    return 8_000;
  }

  /**
   * Find existing cluster for a subnet + model.
   */
  private findExistingCluster(subnet: string, model: string): ClusterInfo | null {
    for (const cluster of this.clusters.values()) {
      if (cluster.modelName !== model) continue;
      const member = cluster.members[0];
      if (member && this.getSubnet(member.lanIp) === subnet) {
        return cluster;
      }
    }
    return null;
  }

  /**
   * Check if a cluster should be reformed.
   * Respects hysteresis (offline grace) and minimum age.
   */
  private shouldReformCluster(cluster: ClusterInfo, currentNodes: AgentNode[]): boolean {
    // Don't reform clusters younger than 5 minutes
    if (Date.now() - cluster.createdAt < CLUSTER_MIN_AGE_MS) return false;

    // Check if all members are still present
    const currentAddresses = new Set(currentNodes.map(n => n.address));
    const missingMembers = cluster.members.filter(m => !currentAddresses.has(m.address));

    if (missingMembers.length === 0) return false; // All present, no reform needed

    // Apply hysteresis: only reform if member has been offline > 2 minutes
    for (const missing of missingMembers) {
      const offlineSince = this.nodeOfflineTimestamps.get(missing.address);
      if (!offlineSince) {
        // First detection: mark as offline but don't reform yet
        this.nodeOfflineTimestamps.set(missing.address, Date.now());
        return false;
      }
      if (Date.now() - offlineSince < NODE_OFFLINE_GRACE_MS) {
        return false; // Still within grace period
      }
    }

    // Grace period expired, reform cluster
    this.logger.log(
      `Reforming cluster ${cluster.id}: ${missingMembers.length} members offline > ${NODE_OFFLINE_GRACE_MS / 1000}s`
    );
    return true;
  }

  /**
   * Handle node going offline: apply hysteresis and potentially dissolve cluster.
   */
  async onNodeOffline(address: string): Promise<void> {
    const addr = address.toLowerCase();

    // Find clusters containing this node
    const assignments = await this.assignmentRepo.find({
      where: { nodeAddress: addr },
    });

    for (const assignment of assignments) {
      if (!assignment.clusterId) continue;

      this.nodeOfflineTimestamps.set(addr, Date.now());

      // Schedule delayed cluster check
      setTimeout(async () => {
        const stillOffline = this.nodeOfflineTimestamps.get(addr);
        if (stillOffline && Date.now() - stillOffline >= NODE_OFFLINE_GRACE_MS) {
          await this.dissolveCluster(assignment.clusterId!);
          this.nodeOfflineTimestamps.delete(addr);
        }
      }, NODE_OFFLINE_GRACE_MS + 1000);
    }
  }

  /**
   * Dissolve a cluster: reset all members to unassigned.
   */
  async dissolveCluster(clusterId: string): Promise<void> {
    try {
      const members = await this.assignmentRepo.find({ where: { clusterId } });
      if (members.length === 0) return;

      const model = members[0].modelName;

      for (const member of members) {
        member.nodeMode = 'standalone';
        member.clusterId = null;
        member.ready = false;
        await this.assignmentRepo.save(member);
      }

      this.clusters.delete(clusterId);
      this.logger.log(`Dissolved cluster ${clusterId} (${members.length} members)`);

      // Re-run cluster formation for the affected model
      await this.formClusters(model);

      // Emit topology change
      const topology = await this.assignmentRepo.find({
        where: { modelName: model },
        order: { pipelineOrder: 'ASC' },
      });
      this.gateway.emitTopologyChange(model, topology);
    } catch (error) {
      this.logger.error('Failed to dissolve cluster', error instanceof Error ? error.message : 'Unknown');
    }
  }

  /**
   * Periodic rebalancing: check cluster health and reform if needed.
   */
  @Cron('*/120 * * * * *') // Every 2 minutes
  async rebalanceClusters(): Promise<void> {
    try {
      await this.formClusters();
    } catch (error) {
      this.logger.error('Cluster rebalancing failed', error instanceof Error ? error.message : 'Unknown');
    }
  }

  /**
   * Get all active clusters for dashboard/API.
   */
  async getActiveClusters(): Promise<{
    clusterId: string;
    modelName: string;
    coordinator: string;
    members: { address: string; mode: string; layerStart: number; layerEnd: number; lanIp: string | null }[];
  }[]> {
    const clusteredAssignments = await this.assignmentRepo
      .createQueryBuilder('pa')
      .where('pa.clusterId IS NOT NULL')
      .andWhere('pa.nodeMode != :standalone', { standalone: 'standalone' })
      .orderBy('pa.clusterId', 'ASC')
      .addOrderBy('pa.pipelineOrder', 'ASC')
      .getMany();

    const clusterMap = new Map<string, typeof clusteredAssignments>();
    for (const a of clusteredAssignments) {
      const list = clusterMap.get(a.clusterId!) || [];
      list.push(a);
      clusterMap.set(a.clusterId!, list);
    }

    return Array.from(clusterMap.entries()).map(([clusterId, members]) => ({
      clusterId,
      modelName: members[0].modelName,
      coordinator: members.find(m => m.nodeMode === 'coordinator')?.nodeAddress || '',
      members: members.map(m => ({
        address: m.nodeAddress,
        mode: m.nodeMode,
        layerStart: m.layerStart,
        layerEnd: m.layerEnd,
        lanIp: m.lanIp,
      })),
    }));
  }
}
