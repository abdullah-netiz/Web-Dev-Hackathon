import { Injectable } from '@nestjs/common';

import { hmacSha256Hex, safeEqual } from '../../common/encryption';
import { ProviderError } from './twilio.provider';

export type LemonSqueezyCredentials = { apiKey: string; storeId: string; variantId: string; webhookSecret: string };

export type CheckoutInput = {
  paymentId: string;
  workspaceId: string;
  amount: number; // major units in the store currency, e.g. 120.50
  name: string;
  description?: string;
  customerEmail?: string;
  customerName?: string;
  redirectUrl: string;
  expiresAt: Date;
};

export type LemonSqueezyWebhook = {
  meta: { event_name: string; test_mode?: boolean; custom_data?: Record<string, string> };
  data: { type: string; id: string; attributes: Record<string, unknown> };
};

export interface PaymentProvider {
  createCheckout(credentials: LemonSqueezyCredentials, input: CheckoutInput): Promise<{ checkoutId: string; url: string; expiresAt: Date | null }>;
  verifyWebhook(secret: string, rawBody: Buffer | string, signature: string | undefined): boolean;
}

/**
 * Lemon Squeezy hosted checkout (docs.lemonsqueezy.com/api/checkouts/create-checkout). Card details are
 * entered only on Lemon Squeezy's page (I2.8). Test mode needs no business verification and accepts the
 * card 4242 4242 4242 4242. The store must have one product variant; `custom_price` sets the amount.
 */
@Injectable()
export class LemonSqueezyProvider implements PaymentProvider {
  async createCheckout(credentials: LemonSqueezyCredentials, input: CheckoutInput) {
    const body = {
      data: {
        type: 'checkouts',
        attributes: {
          custom_price: Math.round(input.amount * 100), // cents in the store currency
          product_options: { name: input.name, description: input.description ?? '', redirect_url: input.redirectUrl, enabled_variants: [Number(credentials.variantId)] },
          checkout_data: { email: input.customerEmail, name: input.customerName, custom: { payment_id: input.paymentId, workspace_id: input.workspaceId } },
          expires_at: input.expiresAt.toISOString(),
          test_mode: true,
        },
        relationships: {
          store: { data: { type: 'stores', id: String(credentials.storeId) } },
          variant: { data: { type: 'variants', id: String(credentials.variantId) } },
        },
      },
    };
    let response: Response;
    try {
      response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
        method: 'POST',
        headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', Authorization: `Bearer ${credentials.apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new ProviderError('LEMONSQUEEZY', 'NETWORK', `Lemon Squeezy could not be reached: ${(error as Error).message}`, true);
    }
    const json = (await response.json().catch(() => ({}))) as { data?: { id: string; attributes: { url: string; expires_at: string | null } }; errors?: { detail?: string; title?: string }[] };
    if (!response.ok || !json.data) {
      const detail = json.errors?.map((e) => e.detail ?? e.title).join('; ') ?? `HTTP ${response.status}`;
      throw new ProviderError('LEMONSQUEEZY', String(response.status), explain(response.status, detail), response.status === 429 || response.status >= 500);
    }
    return { checkoutId: json.data.id, url: json.data.attributes.url, expiresAt: json.data.attributes.expires_at ? new Date(json.data.attributes.expires_at) : null };
  }

  /** X-Signature is the hex HMAC-SHA256 of the raw body with the webhook signing secret (docs.lemonsqueezy.com/help/webhooks/signing-requests). */
  verifyWebhook(secret: string, rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = hmacSha256Hex(secret, typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
    return safeEqual(expected, signature);
  }
}

function explain(status: number, detail: string): string {
  switch (status) {
    case 401:
      return 'Lemon Squeezy rejected the API key. Create a new key under Settings → API and update the integration.';
    case 404:
      return 'Lemon Squeezy could not find the store or product variant. Check the Store ID and Variant ID on the integration.';
    case 422:
      return `Lemon Squeezy rejected the checkout: ${detail}`;
    case 429:
      return 'Lemon Squeezy rate limit reached; try again in a minute.';
    default:
      return `Lemon Squeezy error (${status}): ${detail}`;
  }
}
