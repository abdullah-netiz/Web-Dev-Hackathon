import { Injectable } from '@nestjs/common';
import twilio from 'twilio';

import { DomainError } from '../../common/http-exception.filter';
import type { TwilioCredentials } from '../connections.service';

export type OutboundMessageResult = { sid: string; status: string };

/** Interface every messaging provider implements (Q14): swapping Twilio never touches the domain. */
export interface MessagingProvider {
  send(credentials: TwilioCredentials, input: { to: string; body: string; statusCallbackUrl: string }): Promise<OutboundMessageResult>;
  verifySignature(authToken: string, signature: string | undefined, url: string, params: Record<string, string>): boolean;
}

@Injectable()
export class TwilioProvider implements MessagingProvider {
  async send(credentials: TwilioCredentials, input: { to: string; body: string; statusCallbackUrl: string }): Promise<OutboundMessageResult> {
    const client = twilio(credentials.accountSid, credentials.authToken);
    try {
      const message = await client.messages.create({ from: credentials.whatsappFrom, to: input.to, body: input.body, statusCallback: input.statusCallbackUrl });
      return { sid: message.sid, status: message.status };
    } catch (error) {
      const twilioError = error as { code?: number; message?: string; status?: number };
      throw new ProviderError('TWILIO', twilioError.code ? String(twilioError.code) : 'UNKNOWN', explainTwilio(twilioError.code, twilioError.message), isRetryable(twilioError.status));
    }
  }

  /** X-Twilio-Signature is HMAC-SHA1 over the exact public URL plus sorted form params (twilio.com/docs/usage/webhooks/webhooks-security). */
  verifySignature(authToken: string, signature: string | undefined, url: string, params: Record<string, string>): boolean {
    if (!signature) return false;
    return twilio.validateRequest(authToken, signature, url, params);
  }
}

/** Provider failure with a stable code, a plain-language message and a retry hint (I5.5, Q10). */
export class ProviderError extends DomainError {
  constructor(
    readonly provider: string,
    readonly providerCode: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(`${provider}_ERROR`, message, 502, retryable ? 'The system will retry automatically.' : 'Fix the cause, then retry manually.');
  }
}

function isRetryable(status?: number): boolean {
  return status === undefined || status === 429 || status >= 500;
}

/** Plain-language explanations for the Twilio errors a demo is likely to hit (I1.7, Q10). */
function explainTwilio(code: number | undefined, fallback?: string): string {
  switch (code) {
    case 63016:
      return "WhatsApp only allows free-form messages within 24 hours of the customer's last message. Wait for the customer to write again or use an approved template.";
    case 63015:
      return 'This phone has not joined the Twilio sandbox (or the join expired). Ask the customer to send the join phrase to the sandbox number.';
    case 63007:
      return 'The WhatsApp sender number is not configured correctly. Check the "from" number on the integration.';
    case 21211:
      return 'The destination phone number is invalid. Use international format, e.g. +14155551234.';
    case 20003:
      return 'Twilio rejected the account credentials. Check the Account SID and Auth Token.';
    case 20429:
      return 'Twilio rate limit reached. The message will be retried.';
    default:
      return fallback ? `Twilio: ${fallback}` : 'Twilio could not send the message.';
  }
}

/** Confirms the Account SID and Auth Token work (GET /Accounts/{sid}); used by "Test connection" (I5.1). */
export async function verifyTwilioAccount(accountSid: string, authToken: string): Promise<{ friendlyName: string; status: string }> {
  let response: Response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
    });
  } catch (error) {
    throw new ProviderError('TWILIO', 'NETWORK', `Twilio could not be reached: ${(error as Error).message}`, true);
  }
  const body = (await response.json().catch(() => ({}))) as { friendly_name?: string; status?: string; message?: string; code?: number };
  if (!response.ok) throw new ProviderError('TWILIO', String(body.code ?? response.status), response.status === 401 ? 'Twilio rejected the Account SID or Auth Token.' : `Twilio: ${body.message ?? response.statusText}`, response.status >= 500);
  return { friendlyName: body.friendly_name ?? accountSid, status: body.status ?? 'unknown' };
}
