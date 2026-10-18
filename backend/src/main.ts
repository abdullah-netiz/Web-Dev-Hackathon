import 'reflect-metadata';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ZodValidationPipe } from './common/zod-validation.pipe';
import { loadEnv } from './common/env';

async function bootstrap() {
  const env = loadEnv();
  // rawBody: Stripe and Twilio signatures are computed over the exact bytes received (AGENTS.md §4.5).
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 1_048_576 }),
    { rawBody: true, bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  await app.register(helmet, { contentSecurityPolicy: false });
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: false });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
