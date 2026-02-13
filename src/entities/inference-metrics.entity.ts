import { Entity, Column, PrimaryGeneratedColumn, Index, Unique } from 'typeorm';

@Entity('inference_metrics')
@Unique(['wallet', 'epoch'])
@Index(['epoch'])
@Index(['wallet'])
export class InferenceMetrics {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 42 })
  wallet: string;

  @Column({ type: 'int' })
  epoch: number;

  @Column({ type: 'bigint', default: '0' })
  tokensProcessed: string;

  @Column({ type: 'float', default: 0 })
  avgLatencyMs: number;

  @Column({ type: 'int', default: 0 })
  requestCount: number;

  @Column({ type: 'int', default: 0 })
  uptimeSeconds: number;

  @Column({ type: 'bigint' })
  lastUpdated: string;

  // Re-audit #1 FIX: Store agent's actual last raw cumulative values
  // (distinct from tokensProcessed which is the accumulated delta sum)
  @Column({ type: 'bigint', default: '0' })
  lastRawTokens: string;

  @Column({ type: 'int', default: 0 })
  lastRawRequests: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
