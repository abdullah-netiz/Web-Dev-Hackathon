import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { loadEnv } from './common/env';
import { CrmModule } from './crm/crm.module';
import { HealthController } from './health.controller';
import { IntegrationsModule } from './integrations/integrations.module';
import { JobsModule } from './jobs/jobs.module';
import { LeadsModule } from './leads/leads.module';
import { MetricsModule } from './metrics/metrics.module';
import { RealtimeModule } from './realtime/realtime.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

const env = loadEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        // Secrets never reach the logs (Q13)
        redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.currentPassword', 'req.body.newPassword', 'req.body.credentials', '*.token', '*.secret'], censor: '[redacted]' },
        transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        autoLogging: { ignore: (req) => req.url === '/health' },
      },
    }),
    // Default limit for every route; login/signup override with stricter limits; webhooks skip (Q1)
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }] }),
    CommonModule,
    JobsModule,
    RealtimeModule,
    AuditModule,
    AuthModule,
    WorkspacesModule,
    CrmModule,
    LeadsModule,
    MetricsModule,
    IntegrationsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
