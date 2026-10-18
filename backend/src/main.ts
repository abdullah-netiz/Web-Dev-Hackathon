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
  // rawBody: Lemon Squeezy and Twilio signatures are computed over the exact bytes received (AGENTS.md §4.5).
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 1_048_576 }),
    { rawBody: true, bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  await app.register(helmet, { contentSecurityPolicy: false });
  // Explicit methods: the Fastify CORS plugin only allows GET, HEAD and POST by default, which breaks edits from the browser
  app.enableCors({ origin: env.CORS_ORIGINS, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'Accept'], credentials: false, maxAge: 600 });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
