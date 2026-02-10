import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ChainService } from '../chain/chain.service';
import { Logger } from '../../utils/logger';
import { chainConfig } from '../../config/chain.config';

interface AgentInfo {
  address: string;
  lastHeartbeat: number;
  isActive: boolean;
  registeredAt: number;
}

@Injectable()
export class MonitorService {
  private logger = new Logger('MonitorService');
  private agents: Map<string, AgentInfo> = new Map();

  constructor(private chainService: ChainService) {}

  @Interval(chainConfig.intervals.monitor)
  async monitorAgents() {
    try {
      const activeAgents: string[] = await this.chainService.agentRegistry.getActiveAgents();

      this.logger.debug(`Found ${activeAgents.length} active agents`);

      for (const agentAddress of activeAgents) {
        await this.updateAgentInfo(agentAddress);
      }

      this.detectInactiveAgents();
    } catch (error) {
      this.logger.error('Error monitoring agents', process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async updateAgentInfo(address: string) {
    try {
      const agentData = await this.chainService.agentRegistry.getAgent(address);

      const agentInfo: AgentInfo = {
        address,
        lastHeartbeat: Number(agentData.lastHeartbeat),
        isActive: agentData.status === 1, // AgentStatus.Active = 1
        registeredAt: Number(agentData.registeredAt),
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
