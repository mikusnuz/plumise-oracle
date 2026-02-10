import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('epochs')
export class Epoch {
  @PrimaryColumn({ type: 'int' })
  number: number;

  @Column({ type: 'varchar', length: 78 })
  reward: string;

  @Column({ type: 'int' })
  agentCount: number;

  @Column({ type: 'boolean', default: false })
  distributed: boolean;

  @CreateDateColumn()
  syncedAt: Date;
}
