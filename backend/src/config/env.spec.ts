import { describe, expect, it } from 'vitest';
import { validateEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://ubmp:ubmp@localhost:5433/ubmp?schema=public',
  REDIS_URL: 'redis://localhost:6380',
  APP_ENCRYPTION_KEY: '0'.repeat(64),
};

describe('environment schema (Q13)', () => {
  it('accepts a minimal environment and applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.WEB_URL).toBe('http://localhost:3000');
  });

  it('rejects a missing required secret', () => {
    const { APP_ENCRYPTION_KEY: _omitted, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrowError(/APP_ENCRYPTION_KEY/);
  });

  it('rejects a malformed encryption key', () => {
    expect(() => validateEnv({ ...valid, APP_ENCRYPTION_KEY: 'short' })).toThrowError(
      /APP_ENCRYPTION_KEY/,
    );
  });

  it('treats empty provider credentials as absent', () => {
    const env = validateEnv({ ...valid, TWILIO_AUTH_TOKEN: '' });
    expect(env.TWILIO_AUTH_TOKEN).toBeUndefined();
  });
});
