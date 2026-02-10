import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('agents')
export class Agent {
  @PrimaryColumn({ length: 42 })
  wallet: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nodeId: string;

  @Column({ type: 'text', nullable: true })
  metadata: string;

  @Column({ type: 'bigint' })
  registeredAt: string;

  @Column({ type: 'bigint' })
  lastHeartbeat: string;

  @Column({ type: 'int', comment: '0=Inactive, 1=Active, 2=Slashed' })
  status: number;

  @Column({ type: 'varchar', length: 78 })
  stake: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
