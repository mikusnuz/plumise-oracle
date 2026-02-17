import { DataSource } from 'typeorm';
import { ModelRegistry } from '../src/entities';

const dataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '15411'),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || 'plumbug!db!1q2w3e4r',
  database: process.env.DB_DATABASE || 'plumise_dashboard',
  entities: [ModelRegistry],
  synchronize: false,
});

function calculateMultiplier(activeParams: number, totalParams: number): number {
  const LAMBDA = 0.04;
  const ALPHA = 0.9;

  const activeB = activeParams / 1e9;
  const totalB = totalParams / 1e9;
  const effectiveB = activeB + LAMBDA * (totalB - activeB);

  return Math.floor(Math.pow(effectiveB, ALPHA) * 100);
}

async function seed() {
  await dataSource.initialize();
  console.log('Database connected');

  const repo = dataSource.getRepository(ModelRegistry);

  const models = [
    {
      modelId: 'qwen3-8b',
      displayName: 'Qwen3-8B',
      activeParams: 8000000000,
      totalParams: 8000000000,
      arch: 'dense' as const,
      minMemoryMb: 4500,
      totalLayers: 32,
      status: 'active' as const,
    },
    {
      modelId: 'qwen3-32b',
      displayName: 'Qwen3-32B',
      activeParams: 32000000000,
      totalParams: 32000000000,
      arch: 'dense' as const,
      minMemoryMb: 18000,
      totalLayers: 64,
      status: 'active' as const,
    },
    {
      modelId: 'qwen3.5-397b-a17b',
      displayName: 'Qwen3.5-397B-A17B',
      activeParams: 17000000000,
      totalParams: 397000000000,
      arch: 'moe' as const,
      minMemoryMb: 220000,
      totalLayers: 128,
      status: 'active' as const,
    },
  ];

  for (const modelData of models) {
    const existing = await repo.findOne({ where: { modelId: modelData.modelId } });
    if (existing) {
      console.log(`Model ${modelData.modelId} already exists, skipping`);
      continue;
    }

    const multiplier = calculateMultiplier(modelData.activeParams, modelData.totalParams);

    const model = repo.create({
      ...modelData,
      activeParams: modelData.activeParams.toString(),
      totalParams: modelData.totalParams.toString(),
      multiplier,
      deprecatedAt: modelData.status === 'deprecated' ? new Date() : undefined,
    });

    await repo.save(model);
    console.log(
      `Seeded: ${modelData.modelId} (multiplier=${multiplier}, status=${modelData.status})`,
    );
  }

  console.log('Model seeding completed');
  await dataSource.destroy();
}

seed().catch(error => {
  console.error('Seed failed:', error);
  process.exit(1);
});
