import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('inference_proofs')
@Index(['agentAddress', 'epoch'])
@Index(['agentAddress', 'verified'])
@Index(['modelHash'])
@Index(['createdAt'])
export class InferenceProof {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 42 })
  agentAddress: string;

  @Column({ type: 'int' })
  epoch: number;

  @Column({ type: 'varchar', length: 66 })
  modelHash: string;

  @Column({ type: 'varchar', length: 66 })
  inputHash: string;

  @Column({ type: 'varchar', length: 66 })
  outputHash: string;

  @Column({ type: 'bigint' })
  tokenCount: string;

  @Column({ type: 'boolean', default: false })
  verified: boolean;

  @Column({ type: 'varchar', length: 66, nullable: true })
  verificationTxHash: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  verifiedAt: Date;
}
