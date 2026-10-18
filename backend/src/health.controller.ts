import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from './auth/auth.decorators';
import { PrismaService } from './common/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { data: { ok: true, time: new Date().toISOString() } };
  }
}
