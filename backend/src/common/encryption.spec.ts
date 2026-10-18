import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decrypt, decryptJson, encrypt, encryptJson, maskSecret, safeEqual } from './encryption';

// Ported from devB's suite (feat/backend-scaffold) to this branch's function-based API.
const KEY = randomBytes(32).toString('base64');

describe('encryption (I5.3)', () => {
  it('round-trips a secret and a JSON credential blob', () => {
    expect(decrypt(encrypt('sk_test_1234567890', KEY), KEY)).toBe('sk_test_1234567890');
    expect(decryptJson<{ apiKey: string }>(encryptJson({ apiKey: 'k' }, KEY), KEY)).toEqual({ apiKey: 'k' });
  });

  it('uses a fresh IV so the same plaintext never encrypts the same way', () => {
    expect(encrypt('same', KEY)).not.toBe(encrypt('same', KEY));
  });

  it('rejects tampered ciphertext and the wrong key', () => {
    const payload = encrypt('secret', KEY);
    const [iv, tag, data] = payload.split('.');
    const tampered = [iv, tag, Buffer.from('x' + Buffer.from(data, 'base64').toString('utf8')).toString('base64')].join('.');
    expect(() => decrypt(tampered, KEY)).toThrow();
    expect(() => decrypt(payload, randomBytes(32).toString('base64'))).toThrow();
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => encrypt('x', Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('masks secrets so only a recognisable fragment is shown', () => {
    expect(maskSecret('sk_test_1234567890')).toBe('sk_t…7890');
    expect(maskSecret('short')).toBe('••••');
  });

  it('compares in constant time and handles different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
