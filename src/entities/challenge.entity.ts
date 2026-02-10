import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('challenges')
export class Challenge {
  @PrimaryColumn({ type: 'int' })
  id: number;

  @Column({ type: 'int' })
  difficulty: number;

  @Column({ type: 'varchar', length: 66 })
  seed: string;

  @Column({ type: 'bigint' })
  createdAt: string;

  @Column({ type: 'bigint' })
  expiresAt: string;

  @Column({ type: 'boolean', default: false })
  solved: boolean;

  @Column({ type: 'varchar', length: 42, nullable: true })
  solver: string;

  @Column({ type: 'varchar', length: 78 })
  rewardBonus: string;

  @CreateDateColumn()
  syncedAt: Date;
}
