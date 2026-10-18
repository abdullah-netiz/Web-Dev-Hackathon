import { Injectable } from '@nestjs/common';

import { ProviderError } from './twilio.provider';

export interface AlertProvider {
  send(botToken: string, channel: string, text: string, blocks?: unknown[]): Promise<{ messageId: string }>;
}

type SlackResponse = { ok: boolean; error?: string; ts?: string; user?: { id: string }; team?: string; bot_id?: string };

/**
 * Slack Web API (docs.slack.dev/reference/methods/chat.postMessage). A bot token (xoxb-…) with the
 * scopes chat:write, users:read and users:read.email posts a direct message when `channel` is a user ID.
 */
@Injectable()
export class SlackProvider implements AlertProvider {
  async send(botToken: string, channel: string, text: string, blocks?: unknown[]): Promise<{ messageId: string }> {
    const body = await this.call(botToken, 'chat.postMessage', { method: 'POST', json: { channel, text, blocks, unfurl_links: false } });
    return { messageId: body.ts ?? '' };
  }

  /** Finds the Slack member with the same email as the employee (docs.slack.dev/reference/methods/users.lookupByEmail). */
  async lookupUserByEmail(botToken: string, email: string): Promise<string | null> {
    try {
      const body = await this.call(botToken, `users.lookupByEmail?email=${encodeURIComponent(email)}`, { method: 'GET' });
      return body.user?.id ?? null;
    } catch (error) {
      if (error instanceof ProviderError && error.providerCode === 'users_not_found') return null;
      throw error;
    }
  }

  /** Validates a token when an Admin connects Slack (docs.slack.dev/reference/methods/auth.test). */
  async authTest(botToken: string): Promise<{ team: string }> {
    const body = await this.call(botToken, 'auth.test', { method: 'POST', json: {} });
    return { team: body.team ?? 'Slack workspace' };
  }

  private async call(botToken: string, path: string, options: { method: 'GET' | 'POST'; json?: unknown }): Promise<SlackResponse> {
    const response = await fetch(`https://slack.com/api/${path}`, {
      method: options.method,
      headers: { Authorization: `Bearer ${botToken}`, ...(options.json ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
      body: options.json ? JSON.stringify(options.json) : undefined,
    });
    if (response.status === 429) {
      throw new ProviderError('SLACK', 'ratelimited', `Slack rate limit reached; retrying after ${response.headers.get('retry-after') ?? 'a few'} seconds.`, true);
    }
    if (response.status >= 500) throw new ProviderError('SLACK', String(response.status), 'Slack is temporarily unavailable; the alert will be retried.', true);
    const body = (await response.json().catch(() => ({ ok: false, error: 'invalid_response' }))) as SlackResponse;
    if (!body.ok) throw new ProviderError('SLACK', body.error ?? 'unknown_error', explainSlack(body.error), body.error === 'ratelimited' || body.error === 'internal_error' || body.error === 'service_unavailable');
    return body;
  }
}

function explainSlack(error?: string): string {
  switch (error) {
    case 'invalid_auth':
    case 'not_authed':
    case 'token_revoked':
    case 'account_inactive':
      return 'Slack rejected the bot token. Reinstall the Slack app and paste the new xoxb- token on the integration.';
    case 'missing_scope':
      return 'The Slack app is missing a permission. Add the scopes chat:write, users:read and users:read.email, then reinstall the app.';
    case 'channel_not_found':
    case 'user_not_found':
      return 'The employee\'s Slack user was not found. Check their Slack member ID in Settings → Notifications.';
    case 'users_not_found':
      return 'No Slack member uses this employee\'s email address.';
    case 'not_in_channel':
      return 'The bot is not in that channel. Invite the bot or use the employee\'s member ID for a direct message.';
    default:
      return `Slack error: ${error ?? 'unknown'}`;
  }
}
