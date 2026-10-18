import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { zodDto } from '../common/zod-validation.pipe';
import { MetricsService } from './metrics.service';

class PrefsDto extends zodDto(z.object({ hiddenWidgets: z.array(z.string().max(60)).max(20) })) {}

@Controller('dashboard')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async dashboard(@CurrentUser() auth: AuthContext) {
    return { data: await this.metrics.dashboard(auth) };
  }

  /** F5.5: show/hide figures, remembered per user. */
  @Put('prefs')
  async prefs(@CurrentUser() auth: AuthContext, @Body() body: PrefsDto) {
    return { data: await this.metrics.setPrefs(auth.userId, body.hiddenWidgets) };
  }
}
