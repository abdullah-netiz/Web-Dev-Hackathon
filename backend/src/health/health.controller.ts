import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

/** Liveness/readiness for Railway health checks and `pnpm dev` smoke tests. */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  live(): { data: { status: string } } {
    return { data: { status: 'ok' } };
  }

  @Get('ready')
  async ready(): Promise<{ data: { status: string; database: string } }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { data: { status: 'ok', database: 'up' } };
  }
}
