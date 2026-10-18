import { describe, expect, it } from 'vitest';
import { EncryptionService, maskSecret } from './encryption';

const KEY = 'a'.repeat(64);

describe('EncryptionService', () => {
  it('round-trips a secret', () => {
    const service = new EncryptionService(KEY);
    const plaintext = 'sk_test_1234567890';
    expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
  });

  it('produces a different ciphertext each time', () => {
    const service = new EncryptionService(KEY);
    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('fails to decrypt with a different key', () => {
    const payload = new EncryptionService(KEY).encrypt('secret');
    expect(() => new EncryptionService('b'.repeat(64)).decrypt(payload)).toThrow();
  });

  it('rejects a malformed key', () => {
    expect(() => new EncryptionService('nope')).toThrow(/64 hex/);
  });
});

describe('maskSecret', () => {
  it('reveals only the last four characters', () => {
    expect(maskSecret('sk_test_1234567890')).toBe('••••7890');
  });
});
