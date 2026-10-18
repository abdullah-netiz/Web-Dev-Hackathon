import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

import type { StripeCredentials } from '../connections.service';
import { ProviderError } from './twilio.provider';

export type CheckoutInput = {
  paymentId: string; // our Payment id: idempotency key and client_reference_id
  amount: number; // major units, e.g. 120.50
  currency: string;
  description: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  expiresInMinutes?: number;
};

export interface PaymentProvider {
  createCheckout(credentials: StripeCredentials, input: CheckoutInput): Promise<{ sessionId: string; url: string; expiresAt: Date; paymentIntentId: string | null }>;
  parseEvent(credentials: StripeCredentials, rawBody: Buffer | string, signature: string | undefined): Stripe.Event;
}

/** Hosted Checkout: card data never touches this platform (I2.8). docs.stripe.com/api/checkout/sessions/create */
@Injectable()
export class StripeProvider implements PaymentProvider {
  private client(secretKey: string) {
    return new Stripe(secretKey, { typescript: true, maxNetworkRetries: 2 });
  }

  async createCheckout(credentials: StripeCredentials, input: CheckoutInput) {
    const stripe = this.client(credentials.secretKey);
    const expiresInMinutes = Math.min(Math.max(input.expiresInMinutes ?? 60, 30), 24 * 60); // Stripe allows 30 min – 24 h
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          client_reference_id: input.paymentId,
          customer_email: input.customerEmail,
          line_items: [{ quantity: 1, price_data: { currency: input.currency.toLowerCase(), unit_amount: Math.round(input.amount * 100), product_data: { name: input.description } } }],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          expires_at: Math.floor(Date.now() / 1000) + expiresInMinutes * 60,
          metadata: input.metadata,
          payment_intent_data: { metadata: input.metadata },
        },
        // Idempotency key: a retried request creates one session, not two (docs.stripe.com/api/idempotent_requests)
        { idempotencyKey: `checkout-${input.paymentId}` },
      );
      if (!session.url) throw new ProviderError('STRIPE', 'NO_URL', 'Stripe did not return a checkout URL.', false);
      const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
      return { sessionId: session.id, url: session.url, expiresAt: new Date((session.expires_at ?? 0) * 1000), paymentIntentId };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const stripeError = error as Stripe.errors.StripeError;
      const retryable = stripeError.type === 'StripeConnectionError' || stripeError.type === 'StripeAPIError' || stripeError.type === 'StripeRateLimitError';
      throw new ProviderError('STRIPE', stripeError.code ?? stripeError.type ?? 'UNKNOWN', explainStripe(stripeError), retryable);
    }
  }

  /** Signature verification needs the exact raw body (docs.stripe.com/webhooks); tolerance defaults to 5 minutes. */
  parseEvent(credentials: StripeCredentials, rawBody: Buffer | string, signature: string | undefined): Stripe.Event {
    if (!signature) throw new ProviderError('STRIPE', 'NO_SIGNATURE', 'Missing Stripe-Signature header.', false);
    return this.client(credentials.secretKey).webhooks.constructEvent(rawBody, signature, credentials.webhookSecret);
  }
}

function explainStripe(error: Stripe.errors.StripeError): string {
  switch (error.type) {
    case 'StripeAuthenticationError':
      return 'Stripe rejected the secret key. Check the key on the integration (it should start with sk_test_).';
    case 'StripeInvalidRequestError':
      return `Stripe rejected the request: ${error.message}`;
    case 'StripeRateLimitError':
      return 'Stripe rate limit reached; the request will be retried.';
    case 'StripeConnectionError':
      return 'Stripe could not be reached; the request will be retried.';
    default:
      return `Stripe error: ${error.message}`;
  }
}
