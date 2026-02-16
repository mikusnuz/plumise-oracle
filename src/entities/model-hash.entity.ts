import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ModelRegistry } from './model-registry.entity';

@Entity('model_hashes')
export class ModelHash {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 128 })
  modelId: string;

  @Column({ length: 128 })
  ggufHash: string;

  @Column({ length: 32, nullable: true })
  quantType: string;

  @Column({ nullable: true })
  fileSizeMb: number;

  @ManyToOne(() => ModelRegistry)
  @JoinColumn({ name: 'modelId' })
  model: ModelRegistry;
}
