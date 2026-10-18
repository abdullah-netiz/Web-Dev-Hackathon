import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { PrismaModule } from './common/prisma.module';
import { JobsModule } from './jobs/jobs.module';
import { HealthController } from './health/health.controller';
import { MetaController } from './meta/meta.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.token',
            'req.headers["x-twilio-signature"]',
            'req.headers["stripe-signature"]',
            'req.headers["x-telegram-bot-api-secret-token"]',
          ],
          censor: '[redacted]',
        },
      },
    }),
    PrismaModule,
    JobsModule,
  ],
  controllers: [HealthController, MetaController],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
