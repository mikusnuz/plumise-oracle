import { Logger as NestLogger } from '@nestjs/common';

export class Logger {
  private logger: NestLogger;

  constructor(context: string) {
    this.logger = new NestLogger(context);
  }

  log(message: string, data?: any) {
    if (data) {
      this.logger.log(`${message} ${JSON.stringify(data)}`);
    } else {
      this.logger.log(message);
    }
  }

  error(message: string, trace?: string, data?: any) {
    if (data) {
      this.logger.error(`${message} ${JSON.stringify(data)}`, trace);
    } else {
      this.logger.error(message, trace);
    }
  }

  warn(message: string, data?: any) {
    if (data) {
      this.logger.warn(`${message} ${JSON.stringify(data)}`);
    } else {
      this.logger.warn(message);
    }
  }

  debug(message: string, data?: any) {
    if (process.env.LOG_LEVEL === 'debug') {
      if (data) {
        this.logger.debug(`${message} ${JSON.stringify(data)}`);
      } else {
        this.logger.debug(message);
      }
    }
  }
}
