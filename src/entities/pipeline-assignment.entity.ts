import { Entity, Column, PrimaryGeneratedColumn, Index, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

@Entity('pipeline_assignments')
@Index(['nodeAddress'])
@Index(['modelName'])
@Index(['ready'])
@Unique(['nodeAddress', 'modelName']) // OR-06 FIX: Prevent duplicate assignments
export class PipelineAssignment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 42 })
  nodeAddress: string;

  @Column({ type: 'varchar', length: 255 })
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

  @Column({ type: 'float', default: 0 })
  benchmarkTokPerSec: number;

  @Column({ type: 'boolean', default: false })
  ready: boolean;

  @Column({ type: 'int', default: 0 })
  pipelineOrder: number;

  @Column({ type: 'varchar', length: 50, default: 'standalone' })
  nodeMode: string; // 'standalone' | 'rpc-server' | 'coordinator'

  @Column({ type: 'varchar', length: 64, nullable: true })
  clusterId: string | null;

  @Column({ type: 'int', default: 50052 })
  rpcPort: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lanIp: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
