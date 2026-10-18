import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { LemonSqueezyProvider } from './lemonsqueezy.provider';

describe('LemonSqueezyProvider.verifyWebhook (I2.3)', () => {
  const provider = new LemonSqueezyProvider();
  const secret = 'whsec-test-secret';
  const body = JSON.stringify({ meta: { event_name: 'order_created', custom_data: { payment_id: 'p1' } }, data: { type: 'orders', id: '42', attributes: { status: 'paid' } } });
  const signature = createHmac('sha256', secret).update(body).digest('hex');

  it('accepts the exact signed body', () => {
    expect(provider.verifyWebhook(secret, Buffer.from(body), signature)).toBe(true);
  });

  it('rejects an altered body, a wrong secret and a missing header', () => {
    expect(provider.verifyWebhook(secret, Buffer.from(body.replace('paid', 'refunded')), signature)).toBe(false);
    expect(provider.verifyWebhook('other-secret', Buffer.from(body), signature)).toBe(false);
    expect(provider.verifyWebhook(secret, Buffer.from(body), undefined)).toBe(false);
  });
});
