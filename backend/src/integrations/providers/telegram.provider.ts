import { Injectable } from '@nestjs/common';

import { ProviderError } from './twilio.provider';

export interface AlertProvider {
  send(botToken: string, chatId: string, text: string): Promise<{ messageId: string }>;
}

/** Telegram Bot API sendMessage (core.telegram.org/bots/api#sendmessage). HTML parse mode; text ≤ 4096 chars. */
@Injectable()
export class TelegramProvider implements AlertProvider {
  async send(botToken: string, chatId: string, text: string): Promise<{ messageId: string }> {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id: number }; description?: string; error_code?: number };
    if (!response.ok || !body.ok) {
      const code = body.error_code ?? response.status;
      const retryable = code === 429 || code >= 500;
      throw new ProviderError('TELEGRAM', String(code), explainTelegram(code, body.description), retryable);
    }
    return { messageId: String(body.result?.message_id ?? '') };
  }

  /** Registers the webhook with a secret token Telegram echoes in X-Telegram-Bot-Api-Secret-Token. */
  async setWebhook(botToken: string, url: string, secretToken: string): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ['message'] }),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!body.ok) throw new ProviderError('TELEGRAM', String(response.status), `Telegram refused the webhook: ${body.description ?? 'unknown error'}`, false);
  }

  async botInfo(botToken: string): Promise<{ username: string }> {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: { username?: string }; description?: string };
    if (!body.ok || !body.result?.username) throw new ProviderError('TELEGRAM', String(response.status), `Telegram rejected the bot token: ${body.description ?? ''}`, false);
    return { username: body.result.username };
  }
}

function explainTelegram(code: number, description?: string): string {
  switch (code) {
    case 403:
      return 'The employee blocked the bot or never started a chat with it. Ask them to open the bot and send their link code again.';
    case 400:
      return description?.includes('chat not found') ? 'Telegram chat not found. Ask the employee to re-link their Telegram.' : `Telegram rejected the message: ${description ?? ''}`;
    case 401:
      return 'Telegram rejected the bot token. Check the token on the integration.';
    case 429:
      return 'Telegram rate limit reached; the alert will be retried.';
    default:
      return `Telegram error ${code}: ${description ?? ''}`;
  }
}
