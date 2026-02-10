import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('network_stats')
export class NetworkStats {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  @Column({ type: 'bigint' })
  blockNumber: string;

  @Column({ type: 'int' })
  activeAgents: number;

  @Column({ type: 'int' })
  totalAgents: number;

  @Column({ type: 'int' })
  currentEpoch: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
