import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ChainService } from '../chain/chain.service';
import { NodesService } from '../nodes/nodes.service';
import { Logger } from '../../utils/logger';
import { chainConfig } from '../../config/chain.config';

interface AgentInfo {
  address: string;
  lastHeartbeat: number;
  isActive: boolean;
  registeredAt: number;
  nodeId?: string;
  metadata?: string;
  status?: number;
  stake?: bigint;
}

@Injectable()
export class MonitorService {
  private logger = new Logger('MonitorService');
  private agents: Map<string, AgentInfo> = new Map();
  public syncService: any;

  constructor(
    private chainService: ChainService,
    private nodesService: NodesService,
  ) {}

  @Interval(chainConfig.intervals.monitor)
  async monitorAgents() {
    try {
      // 1. Discover contract-registered agents
      if (this.chainService.agentRegistry) {
        try {
          const activeAgents = await this.chainService.agentRegistry!.read.getActiveAgents();
          this.logger.debug(`Found ${activeAgents.length} contract agents`);
          for (const agentAddress of activeAgents) {
            await this.updateAgentInfo(agentAddress);
          }
        } catch (error) {
          this.logger.error('Failed to read contract agents', error instanceof Error ? error.message : 'Unknown error');
        }
      }

      // 2. Discover precompile agents from active nodes (auto-registered via metrics)
      const activeNodes = await this.nodesService.getActiveNodes();
      for (const node of activeNodes) {
        if (!this.agents.has(node.address)) {
          this.agents.set(node.address, {
            address: node.address,
            lastHeartbeat: Number(node.lastHeartbeat),
            isActive: true,
            registeredAt: Math.floor(node.createdAt.getTime() / 1000),
            nodeId: '',
            metadata: 'precompile-registered',
            status: 1,
            stake: 0n,
          });
          this.logger.debug(`Discovered precompile agent from nodes: ${node.address}`);
        } else {
          // Update heartbeat from node data
          const existing = this.agents.get(node.address)!;
          const nodeHb = Number(node.lastHeartbeat);
          if (nodeHb > existing.lastHeartbeat) {
            this.agents.set(node.address, { ...existing, lastHeartbeat: nodeHb, isActive: true });
          }
        }
      }

      this.detectInactiveAgents();

      if (this.syncService) {
        try {
          await this.syncService.syncAgents(Array.from(this.agents.values()));
          await this.syncService.updateNetworkStats();
        } catch (error) {
          this.logger.error('Failed to sync to DB', error instanceof Error ? error.message : 'Unknown error');
        }
      }

      await this.nodesService.markInactiveNodes();
    } catch (error) {
      this.logger.error('Error monitoring agents', process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async updateAgentInfo(address: string) {
    try {
      const agentData = await this.chainService.agentRegistry!.read.getAgent([address as `0x${string}`]);

      const agentInfo: AgentInfo = {
        address,
        lastHeartbeat: Number(agentData.lastHeartbeat),
        isActive: agentData.status === 1,
        registeredAt: Number(agentData.registeredAt),
        nodeId: agentData.nodeId || '',
        metadata: agentData.metadata || '',
        status: agentData.status,
        stake: agentData.stake,
      };

      const existingAgent = this.agents.get(address);

      if (!existingAgent) {
        this.logger.log(`New agent registered: ${address}`);
        this.agents.set(address, agentInfo);
      } else if (existingAgent.lastHeartbeat !== agentInfo.lastHeartbeat) {
        this.logger.debug(`Agent heartbeat: ${address} at ${agentInfo.lastHeartbeat}`);
        this.agents.set(address, agentInfo);
      }
    } catch (error) {
      this.logger.error(`Error updating agent info for ${address}`, process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private detectInactiveAgents() {
    const now = Math.floor(Date.now() / 1000);
    const HEARTBEAT_TIMEOUT = 300; // 5 minutes

    for (const [address, agent] of this.agents) {
      const timeSinceHeartbeat = now - agent.lastHeartbeat;

      if (agent.isActive && timeSinceHeartbeat > HEARTBEAT_TIMEOUT) {
        this.logger.warn(`Agent ${address} inactive for ${timeSinceHeartbeat}s`);
        this.agents.set(address, { ...agent, isActive: false });
      }
    }
  }

  getActiveAgents(): AgentInfo[] {
    return Array.from(this.agents.values()).filter(agent => agent.isActive);
  }

  getAgent(address: string): AgentInfo | undefined {
    return this.agents.get(address);
  }

  getAllAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }
}
