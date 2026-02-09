import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['log', 'error', 'warn', 'debug'],
    });

    logger.log('Plumise Oracle Service Started');
    logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.log(`RPC URL: ${process.env.RPC_URL || 'https://node-1.plumise.com/rpc'}`);

    process.on('SIGTERM', async () => {
      logger.log('SIGTERM signal received: closing application');
      await app.close();
    });

    process.on('SIGINT', async () => {
      logger.log('SIGINT signal received: closing application');
      await app.close();
    });
  } catch (error) {
    logger.error('Failed to start oracle service', error.stack);
    process.exit(1);
  }
}

bootstrap();
