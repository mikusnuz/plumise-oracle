import { Entity, Column, PrimaryGeneratedColumn, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('pipeline_assignments')
@Index(['nodeAddress'])
@Index(['modelName'])
@Index(['ready'])
export class PipelineAssignment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 42 })
  @Index()
  nodeAddress: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  modelName: string;

  @Column({ type: 'int' })
  layerStart: number;

  @Column({ type: 'int' })
  layerEnd: number;

  @Column({ type: 'int' })
  totalLayers: number;

  @Column({ type: 'varchar', length: 255 })
  grpcEndpoint: string;

  @Column({ type: 'varchar', length: 255 })
  httpEndpoint: string;

  @Column({ type: 'bigint', default: 0 })
  ramMb: number;

  @Column({ type: 'varchar', length: 50, default: 'cpu' })
  device: string;

  @Column({ type: 'bigint', default: 0 })
  vramMb: number;

  @Column({ type: 'boolean', default: false })
  ready: boolean;

  @Column({ type: 'int', default: 0 })
  pipelineOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
