import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { verifyMessage } from 'viem';
import { AgentNode } from '../../entities';
import { Logger } from '../../utils/logger';
import { ChainService } from '../chain/chain.service';
import { RegisterNodeDto } from '../metrics/dto/register-node.dto';

const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TOKENS_PER_REPORT = 1_000_000_000; // 1B tokens per report

@Injectable()
export class NodesService {
  private logger = new Logger('NodesService');
  // Re-audit #4 FIX: Monotonic timestamp guard for registration endpoint
  private lastRegistrationTimestamp: Map<string, number> = new Map();

  constructor(
    @InjectRepository(AgentNode)
    private nodeRepo: Repository<AgentNode>,
    private chainService: ChainService,
  ) {}

  async verifyRegistrationSignature(dto: RegisterNodeDto): Promise<boolean> {
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
        endpoint: dto.endpoint,
        capabilities: dto.capabilities,
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

      const result = await this.chainService.publicClient.request({ method: 'agent_isAgentAccount' as any, params: [address, 'latest'] as any });
      return result === true;
    } catch (error) {
      this.logger.error('Failed to verify agent on-chain', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  async registerNode(dto: RegisterNodeDto): Promise<{ success: boolean; message: string }> {
    try {
      const address = dto.address.toLowerCase();

      // Re-audit #4 FIX: Monotonic timestamp guard prevents replay within the 60s window
      const lastTs = this.lastRegistrationTimestamp.get(address) || 0;
      if (dto.timestamp <= lastTs) {
        this.logger.warn(`Rejected registration replay from ${address}: timestamp ${dto.timestamp} <= last ${lastTs}`);
        return { success: false, message: 'Replay detected: timestamp must be strictly increasing' };
      }

      const isRegistered = await this.isAgentRegisteredOnChain(address);
      if (!isRegistered) {
        return { success: false, message: 'Address not registered as agent on-chain' };
      }

      let node = await this.nodeRepo.findOne({ where: { address } });

      const now = String(Math.floor(Date.now() / 1000));

      if (!node) {
        node = this.nodeRepo.create({
          address,
          endpoint: dto.endpoint,
          capabilities: dto.capabilities,
          status: 'active',
          score: 0,
          lastHeartbeat: now,
          lastMetricReport: now,
          registrationSignature: dto.signature,
        });
        this.logger.log(`New node registered: ${address}`);
      } else {
        node.endpoint = dto.endpoint;
        node.capabilities = dto.capabilities;
        node.status = 'active';
        node.lastHeartbeat = now;
        this.logger.log(`Node updated: ${address}`);
      }

      await this.nodeRepo.save(node);

      // Re-audit #4 FIX: Update monotonic timestamp after successful registration
      this.lastRegistrationTimestamp.set(address, dto.timestamp);

      return { success: true, message: 'Node registered successfully' };
    } catch (error) {
      this.logger.error('Failed to register node', error instanceof Error ? error.message : 'Unknown error');
      return { success: false, message: 'Internal server error' };
    }
  }

  async updateNodeHeartbeat(address: string): Promise<void> {
    try {
      const node = await this.nodeRepo.findOne({ where: { address: address.toLowerCase() } });
      if (node) {
        node.lastHeartbeat = String(Math.floor(Date.now() / 1000));
        if (node.status === 'inactive') {
          node.status = 'active';
        }
        await this.nodeRepo.save(node);
      }
    } catch (error) {
      this.logger.error('Failed to update heartbeat', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async updateNodeMetricReport(address: string): Promise<void> {
    try {
      const node = await this.nodeRepo.findOne({ where: { address: address.toLowerCase() } });
      if (node) {
        node.lastMetricReport = String(Math.floor(Date.now() / 1000));
        node.lastHeartbeat = String(Math.floor(Date.now() / 1000));
        if (node.status === 'inactive') {
          node.status = 'active';
        }
        await this.nodeRepo.save(node);
      }
    } catch (error) {
      this.logger.error('Failed to update metric report time', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async updateNodeScore(address: string, score: number): Promise<void> {
    try {
      const node = await this.nodeRepo.findOne({ where: { address: address.toLowerCase() } });
      if (node) {
        node.score = score;
        await this.nodeRepo.save(node);
      }
    } catch (error) {
      this.logger.error('Failed to update node score', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async getActiveNodes(): Promise<AgentNode[]> {
    try {
      const cutoffTime = String(Math.floor((Date.now() - HEARTBEAT_TIMEOUT_MS) / 1000));

      const nodes = await this.nodeRepo.find({
        where: {
          status: 'active',
        },
      });

      return nodes.filter(node => BigInt(node.lastHeartbeat) > BigInt(cutoffTime));
    } catch (error) {
      this.logger.error('Failed to get active nodes', error instanceof Error ? error.message : 'Unknown error');
      return [];
    }
  }

  async getNodeByAddress(address: string): Promise<AgentNode | null> {
    try {
      return await this.nodeRepo.findOne({ where: { address: address.toLowerCase() } });
    } catch (error) {
      this.logger.error('Failed to get node', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  async markInactiveNodes(): Promise<void> {
    try {
      const cutoffTime = String(Math.floor((Date.now() - HEARTBEAT_TIMEOUT_MS) / 1000));

      const result = await this.nodeRepo
        .createQueryBuilder()
        .update(AgentNode)
        .set({ status: 'inactive' })
        .where('status = :status', { status: 'active' })
        .andWhere('lastHeartbeat < :cutoff', { cutoff: cutoffTime })
        .execute();

      if (result.affected && result.affected > 0) {
        this.logger.log(`Marked ${result.affected} nodes as inactive`);
      }
    } catch (error) {
      this.logger.error('Failed to mark inactive nodes', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Auto-register a precompile-verified agent as a node if not already in DB.
   * Called when metrics arrive from an agent verified via agent_isAgentAccount.
   */
  async ensureNodeRegistered(address: string): Promise<void> {
    try {
      const addr = address.toLowerCase();
      const existing = await this.nodeRepo.findOne({ where: { address: addr } });
      if (existing) return;

      const now = String(Math.floor(Date.now() / 1000));
      const node = this.nodeRepo.create({
        address: addr,
        endpoint: '',
        capabilities: ['inference'],
        status: 'active',
        score: 0,
        lastHeartbeat: now,
        lastMetricReport: now,
      });
      await this.nodeRepo.save(node);
      this.logger.log(`Auto-registered precompile agent as node: ${addr}`);
    } catch (error) {
      this.logger.error('Failed to auto-register node', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  validateTokensProcessed(tokens: number): boolean {
    return tokens >= 0 && tokens <= MAX_TOKENS_PER_REPORT;
  }
}
