import { Injectable } from '@nestjs/common';
import type { Provider } from '@prisma/client';

import type { AuthContext } from '../auth/auth.types';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import { ConnectionsService, type TwilioCredentials } from './connections.service';
import { IntegrationEventsService } from './integration-events.service';
import { verifyLemonSqueezyStore, type LemonSqueezyCredentials } from './providers/lemonsqueezy.provider';
import { SlackProvider } from './providers/slack.provider';
import { ProviderError, verifyTwilioAccount } from './providers/twilio.provider';

/**
 * "Test connection" (I5.1, I5.5): makes one harmless read call with the stored credentials, records it in
 * the sync history and updates the connection status, so a wrong key shows up before a customer is affected.
 */
@Injectable()
export class IntegrationTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
    private readonly events: IntegrationEventsService,
    private readonly slack: SlackProvider,
  ) {}

  async test(auth: AuthContext, provider: Exclude<Provider, 'WEB_FORM'>) {
    let detail: string;
    try {
      detail = await this.run(auth, provider);
      await this.connections.markHealth(auth.workspaceId, provider, true);
      await this.events.record({ workspaceId: auth.workspaceId, provider, direction: 'OUT', type: 'connection.test', payload: { ok: true, detail } });
      return { ok: true, detail };
    } catch (error) {
      const message = error instanceof ProviderError || error instanceof DomainError ? error.message : `Unexpected error: ${(error as Error).message}`;
      if (!(error instanceof DomainError && (error.code === 'NOT_CONNECTED' || error.code === 'GOOGLE_NOT_CONNECTED'))) {
        await this.connections.markHealth(auth.workspaceId, provider, false, message);
      }
      await this.events.record({ workspaceId: auth.workspaceId, provider, direction: 'OUT', type: 'connection.test', payload: { ok: false, message } });
      return { ok: false, detail: message };
    }
  }

  private async run(auth: AuthContext, provider: Exclude<Provider, 'WEB_FORM'>): Promise<string> {
    switch (provider) {
      case 'TWILIO': {
        const stored = await this.connections.credentials<TwilioCredentials>(auth.workspaceId, 'TWILIO');
        if (!stored) throw new DomainError('NOT_CONNECTED', 'Twilio is not connected yet.', 409);
        const account = await verifyTwilioAccount(stored.credentials.accountSid, stored.credentials.authToken);
        return `Twilio account "${account.friendlyName}" is ${account.status}. Sending from ${stored.credentials.whatsappFrom}.`;
      }
      case 'LEMONSQUEEZY': {
        const stored = await this.connections.credentials<LemonSqueezyCredentials>(auth.workspaceId, 'LEMONSQUEEZY');
        if (!stored) throw new DomainError('NOT_CONNECTED', 'Lemon Squeezy is not connected yet.', 409);
        const store = await verifyLemonSqueezyStore(stored.credentials);
        const configured = String(stored.config.currency ?? 'USD').toUpperCase();
        if (configured !== store.currency.toUpperCase()) {
          throw new DomainError('CURRENCY_MISMATCH', `The store charges in ${store.currency} but the integration is set to ${configured}.`, 422, `Set the currency to ${store.currency}.`);
        }
        return `Store "${store.storeName}" (${store.currency}) is reachable; the product variant exists${store.testMode ? ' in test mode' : ''}.`;
      }
      case 'SLACK': {
        const credentials = await this.connections.slackCredentials(auth.workspaceId);
        if (!credentials) throw new DomainError('NOT_CONNECTED', 'Slack is not connected yet.', 409);
        const { team } = await this.slack.authTest(credentials.botToken);
        return `Connected to the Slack workspace "${team}".`;
      }
      case 'GOOGLE': {
        const [connected, broken] = await Promise.all([
          this.prisma.calendarToken.count({ where: { workspaceId: auth.workspaceId, status: 'CONNECTED' } }),
          this.prisma.calendarToken.count({ where: { workspaceId: auth.workspaceId, status: 'NEEDS_RECONNECT' } }),
        ]);
        if (connected + broken === 0) throw new DomainError('GOOGLE_NOT_CONNECTED', 'No employee has connected a Google Calendar yet.', 409);
        if (broken > 0) throw new DomainError('GOOGLE_NEEDS_RECONNECT', `${broken} employee calendar connection(s) expired and need reconnecting.`, 409);
        return `${connected} employee calendar(s) connected.`;
      }
    }
  }
}
