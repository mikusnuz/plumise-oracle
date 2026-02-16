import { DataSource } from 'typeorm';
import { ModelRegistry } from '../src/entities';

const dataSource = new DataSource({
  type: 'mysql',
  host: 'localhost',
  port: 15411,
  username: 'root',
  password: 'plumbug!db!1q2w3e4r',
  database: 'plumise_dashboard',
  entities: [ModelRegistry],
});

async function verify() {
  await dataSource.initialize();
  const repo = dataSource.getRepository(ModelRegistry);
  const models = await repo.find();

  console.log('\n=== Model Registry ===');
  models.forEach(m => {
    console.log(
      `${m.modelId.padEnd(20)} | mult=${String(m.multiplier).padStart(4)} | ${m.status.padEnd(10)} | ${m.displayName}`,
    );
  });

  await dataSource.destroy();
}

verify();
