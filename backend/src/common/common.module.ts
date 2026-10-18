import { Global, Module } from '@nestjs/common';

import { DomainEvents } from './domain-events';
import { ENV, loadEnv } from './env';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }, PrismaService, DomainEvents],
  exports: [ENV, PrismaService, DomainEvents],
})
export class CommonModule {}
