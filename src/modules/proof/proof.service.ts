import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InferenceProof } from '../../entities/inference-proof.entity';
import { InferenceMetrics } from '../../entities/inference-metrics.entity';
import { Logger } from '../../utils/logger';
import { InferenceProofDto } from './dto/inference-proof.dto';
import { createHash } from 'crypto';

@Injectable()
export class ProofService {
  private logger = new Logger('ProofService');

  constructor(
    @InjectRepository(InferenceProof)
    private proofRepo: Repository<InferenceProof>,
    @InjectRepository(InferenceMetrics)
    private metricsRepo: Repository<InferenceMetrics>,
  ) {}

  async saveProof(
    agentAddress: string,
    epoch: number,
    proofDto: InferenceProofDto,
  ): Promise<InferenceProof> {
    try {
      const proof = this.proofRepo.create({
        agentAddress: agentAddress.toLowerCase(),
        epoch,
        modelHash: proofDto.modelHash.toLowerCase(),
        inputHash: proofDto.inputHash.toLowerCase(),
        outputHash: proofDto.outputHash.toLowerCase(),
        tokenCount: proofDto.tokenCount.toString(),
        verified: false,
      });

      const saved = await this.proofRepo.save(proof);
      this.logger.debug(`Proof saved for agent ${agentAddress}`, {
        id: saved.id,
        modelHash: saved.modelHash.substring(0, 10),
        tokenCount: saved.tokenCount,
      });

      // OR-03 FIX: Verify proof against agent metrics
      const verificationResult = await this.verifyProofAgainstMetrics(saved);
      if (verificationResult.verified) {
        await this.markVerified(saved.id, verificationResult.txHash || '0x0');
        this.logger.log(`Proof ${saved.id} verified successfully for ${agentAddress}`);
      } else {
        this.logger.warn(`Proof ${saved.id} verification failed for ${agentAddress}: ${verificationResult.reason}`);
      }

      return saved;
    } catch (error) {
      this.logger.error(
        `Failed to save proof for ${agentAddress}`,
        error instanceof Error ? error.message : 'Unknown error',
      );
      throw error;
    }
  }

  private async verifyProofAgainstMetrics(
    proof: InferenceProof,
  ): Promise<{ verified: boolean; reason?: string; txHash?: string }> {
    try {
      // OR-03 FIX: Basic sanity checks against agent metrics
      // Full cryptographic verification (outputHash = hash(model(inputHash)))
      // would require model execution and is deferred to OR-05/precompile 0x20

      // 1. Check if agent has metrics for this epoch
      const metrics = await this.metricsRepo.findOne({
        where: {
          wallet: proof.agentAddress.toLowerCase(),
          epoch: proof.epoch,
        },
      });

      if (!metrics) {
        return { verified: false, reason: 'No metrics found for agent in this epoch' };
      }

      // 2. Verify proof token count is reasonable compared to agent total
      const proofTokens = BigInt(proof.tokenCount);
      const agentTokens = BigInt(metrics.tokensProcessed);

      if (proofTokens > agentTokens) {
        return { verified: false, reason: `Proof tokens (${proofTokens}) exceed agent total (${agentTokens})` };
      }

      // 3. Basic hash format validation (0x + 64 hex chars)
      const hashPattern = /^0x[0-9a-f]{64}$/i;
      if (!hashPattern.test(proof.modelHash) ||
          !hashPattern.test(proof.inputHash) ||
          !hashPattern.test(proof.outputHash)) {
        return { verified: false, reason: 'Invalid hash format' };
      }

      // 4. Verify hashes are unique (not all same dummy values)
      if (proof.inputHash === proof.outputHash || proof.modelHash === proof.inputHash) {
        return { verified: false, reason: 'Duplicate hash values detected' };
      }

      // Basic verification passed - mark as verified with local hash as txHash
      // (actual on-chain verification via precompile 0x20 is future work per OR-05)
      const localTxHash = createHash('sha256')
        .update(`${proof.agentAddress}:${proof.epoch}:${proof.modelHash}:${proof.inputHash}:${proof.outputHash}`)
        .digest('hex');

      return {
        verified: true,
        txHash: `0x${localTxHash}`,
      };
    } catch (error) {
      this.logger.error(
        'Proof verification error',
        error instanceof Error ? error.message : 'Unknown error',
      );
      return { verified: false, reason: 'Verification error' };
    }
  }

  async markVerified(
    proofId: number,
    txHash: string,
  ): Promise<void> {
    try {
      await this.proofRepo.update(proofId, {
        verified: true,
        verificationTxHash: txHash.toLowerCase(),
        verifiedAt: new Date(),
      });

      this.logger.log(`Proof ${proofId} marked as verified`, { txHash });
    } catch (error) {
      this.logger.error(
        `Failed to mark proof ${proofId} as verified`,
        error instanceof Error ? error.message : 'Unknown error',
      );
      throw error;
    }
  }

  async getProofsByAgent(
    agentAddress: string,
    limit: number = 100,
    onlyVerified: boolean = false,
  ): Promise<InferenceProof[]> {
    const query = this.proofRepo
      .createQueryBuilder('proof')
      .where('proof.agentAddress = :address', { address: agentAddress.toLowerCase() })
      .orderBy('proof.createdAt', 'DESC')
      .limit(limit);

    if (onlyVerified) {
      query.andWhere('proof.verified = :verified', { verified: true });
    }

    return await query.getMany();
  }

  async getProofsByEpoch(
    agentAddress: string,
    epoch: number,
  ): Promise<InferenceProof[]> {
    return await this.proofRepo.find({
      where: {
        agentAddress: agentAddress.toLowerCase(),
        epoch,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async getVerifiedTokenCount(
    agentAddress: string,
    epoch: number,
  ): Promise<bigint> {
    const result = await this.proofRepo
      .createQueryBuilder('proof')
      .select('SUM(CAST(proof.tokenCount AS UNSIGNED))', 'total')
      .where('proof.agentAddress = :address', { address: agentAddress.toLowerCase() })
      .andWhere('proof.epoch = :epoch', { epoch })
      .andWhere('proof.verified = :verified', { verified: true })
      .getRawOne();

    return BigInt(result?.total || 0);
  }

  async getProofStats(agentAddress: string, epoch?: number) {
    const query = this.proofRepo
      .createQueryBuilder('proof')
      .where('proof.agentAddress = :address', { address: agentAddress.toLowerCase() });

    if (epoch !== undefined) {
      query.andWhere('proof.epoch = :epoch', { epoch });
    }

    const [total, verified] = await Promise.all([
      query.getCount(),
      query.clone().andWhere('proof.verified = :verified', { verified: true }).getCount(),
    ]);

    const tokenResult = await query
      .clone()
      .andWhere('proof.verified = :verified', { verified: true })
      .select('SUM(CAST(proof.tokenCount AS UNSIGNED))', 'total')
      .getRawOne();

    return {
      totalProofs: total,
      verifiedProofs: verified,
      pendingProofs: total - verified,
      verifiedTokens: tokenResult?.total || '0',
      verificationRate: total > 0 ? (verified / total) * 100 : 0,
    };
  }
}
