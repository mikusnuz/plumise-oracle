import { Entity, Column, PrimaryColumn, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('agent_nodes')
@Index(['status'])
@Index(['lastHeartbeat'])
export class AgentNode {
  @PrimaryColumn({ type: 'varchar', length: 42 })
  address: string;

  @Column({ type: 'varchar', length: 255 })
  endpoint: string;

  @Column({ type: 'json' })
  capabilities: string[];

  @Column({ type: 'enum', enum: ['active', 'inactive', 'slashed'], default: 'inactive' })
  status: string;

  @Column({ type: 'float', default: 0, comment: 'Computed score based on metrics' })
  score: number;

  @Column({ type: 'bigint', comment: 'Unix timestamp of last heartbeat' })
  lastHeartbeat: string;

  @Column({ type: 'bigint', comment: 'Unix timestamp of last metric report' })
  lastMetricReport: string;

  @Column({ type: 'varchar', length: 132, nullable: true, comment: 'Registration signature' })
  registrationSignature: string;

  @Column({ type: 'float', default: 0, comment: 'Self-reported benchmark tok/s' })
  benchmarkTokPerSec: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
