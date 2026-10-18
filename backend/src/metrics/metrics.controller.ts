import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { SessionUser } from '../auth/types/session-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  dashboardQuerySchema,
  saveDashboardPrefsSchema,
  type SaveDashboardPrefsInput,
} from './dto/metrics.dto';
import { MetricsService } from './metrics.service';

@Controller('dashboard')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @RequirePermission('dashboard.view')
  async get(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: { widgets?: string },
  ) {
    const selected = query.widgets
      ? query.widgets
          .split(',')
          .map((key) => key.trim())
          .filter(Boolean)
      : undefined;
    return { data: await this.metrics.dashboard(user, selected) };
  }

  @Get('widgets')
  @RequirePermission('dashboard.view')
  widgets() {
    return { data: this.metrics.catalogue() };
  }

  @Get('prefs')
  @RequirePermission('dashboard.view')
  async prefs(@CurrentUser() user: SessionUser) {
    return { data: await this.metrics.getPrefs(user) };
  }

  @Patch('prefs')
  @RequirePermission('dashboard.view')
  async savePrefs(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(saveDashboardPrefsSchema)) body: SaveDashboardPrefsInput,
  ) {
    return { data: await this.metrics.savePrefs(user, body.widgets) };
  }
}
