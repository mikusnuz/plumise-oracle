import { Entity, Column, PrimaryGeneratedColumn, Index, Unique } from 'typeorm';

@Entity('contributions')
@Unique(['wallet', 'epoch'])
@Index(['epoch'])
export class Contribution {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 42 })
  wallet: string;

  @Column({ type: 'int' })
  epoch: number;

  @Column({ type: 'int', default: 0 })
  taskCount: number;

  @Column({ type: 'int', default: 0 })
  uptimeSeconds: number;

  @Column({ type: 'int', default: 0 })
  responseScore: number;

  @Column({ type: 'bigint' })
  lastUpdated: string;
}
