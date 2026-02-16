import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('model_registry')
export class ModelRegistry {
  @PrimaryColumn({ length: 128 })
  modelId: string;

  @Column({ length: 256 })
  displayName: string;

  @Column({ type: 'bigint' })
  activeParams: string;

  @Column({ type: 'bigint' })
  totalParams: string;

  @Column({ type: 'enum', enum: ['dense', 'moe'], default: 'dense' })
  arch: 'dense' | 'moe';

  @Column()
  minMemoryMb: number;

  @Column()
  totalLayers: number;

  @Column()
  multiplier: number;

  @Column({ type: 'enum', enum: ['active', 'deprecated', 'disabled'], default: 'active' })
  status: 'active' | 'deprecated' | 'disabled';

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  deprecatedAt: Date;
}
