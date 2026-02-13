import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InferenceProof } from '../../entities/inference-proof.entity';
import { Logger } from '../../utils/logger';
import { InferenceProofDto } from './dto/inference-proof.dto';

@Injectable()
export class ProofService {
  private logger = new Logger('ProofService');

  constructor(
    @InjectRepository(InferenceProof)
    private proofRepo: Repository<InferenceProof>,
  ) {}

  async saveProof(
    agentAddress: string,
    epoch: number,
    proofDto: InferenceProofDto,
  ): Promise<InferenceProof> {
    try {
      // OR-05: TODO - Implement cryptographic proof verification
      // Currently proofs are accepted without verification (verified=false by default)
      // Future implementation should:
      // 1. Verify modelHash matches expected model binary hash
      // 2. Verify outputHash = hash(model(inputHash))
      // 3. Consider sampling strategy (verify random subset to reduce cost)
      // 4. Integrate with on-chain verifyInference precompile (0x20)

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

      return saved;
    } catch (error) {
      this.logger.error(
        `Failed to save proof for ${agentAddress}`,
        error instanceof Error ? error.message : 'Unknown error',
      );
      throw error;
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
