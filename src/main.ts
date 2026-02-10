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
    const isDev = process.env.NODE_ENV !== 'production';
    logger.error(
      'Failed to start oracle service',
      isDev && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error'
    );
    process.exit(1);
  }
}

bootstrap();
