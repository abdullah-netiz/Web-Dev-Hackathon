import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../common/prisma.service';

/** Liveness/readiness for Railway health checks and `pnpm dev` smoke tests. */
@Public()
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
