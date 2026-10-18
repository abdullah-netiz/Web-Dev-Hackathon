import { Module } from '@nestjs/common';

import { AlertsController } from '../alerts/alerts.controller';
import { AlertsService } from '../alerts/alerts.service';
import { AuditModule } from '../audit/audit.module';
import { CalendarController } from '../calendar/calendar.controller';
import { CalendarService } from '../calendar/calendar.service';
import { CrmModule } from '../crm/crm.module';
import { LeadsModule } from '../leads/leads.module';
import { MessagingController } from '../messaging/messaging.controller';
import { MessagingService } from '../messaging/messaging.service';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
import { ConnectionsService } from './connections.service';
import { InboundProcessor } from './inbound.processor';
import { IntegrationEventsService } from './integration-events.service';
import { IntegrationsController } from './integrations.controller';
import { AlertsProcessor, OutboundProcessor, PaymentsProcessor } from './outbound.processors';
import { GoogleCalendarProvider } from './providers/google-calendar.provider';
import { LemonSqueezyProvider } from './providers/lemonsqueezy.provider';
import { SlackProvider } from './providers/slack.provider';
import { TwilioProvider } from './providers/twilio.provider';
import { WebhooksController } from './webhooks.controller';

/**
 * Everything that talks to an external service (I1–I5). Provider SDKs live only under ./providers;
 * the messaging, payments, calendar and alerts services own the business rules (Q14).
 */
@Module({
  imports: [AuditModule, CrmModule, LeadsModule],
  controllers: [IntegrationsController, WebhooksController, MessagingController, PaymentsController, CalendarController, AlertsController],
  providers: [
    ConnectionsService,
    IntegrationEventsService,
    TwilioProvider,
    LemonSqueezyProvider,
    SlackProvider,
    GoogleCalendarProvider,
    MessagingService,
    PaymentsService,
    CalendarService,
    AlertsService,
    InboundProcessor,
    OutboundProcessor,
    AlertsProcessor,
    PaymentsProcessor,
  ],
  exports: [ConnectionsService, IntegrationEventsService],
})
export class IntegrationsModule {}
