import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

// AES-256-GCM for provider credentials and API keys at rest (I5.3, Q13).
// Format: base64(iv).base64(tag).base64(ciphertext)

const ALGORITHM = 'aes-256-gcm';

function keyFromBase64(key: string): Buffer {
  const buffer = Buffer.from(key, 'base64');
  if (buffer.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY must be base64 of exactly 32 bytes');
  }
  return buffer;
}

export function encrypt(plaintext: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyFromBase64(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64')).join('.');
}

export function decrypt(payload: string, key: string): string {
  const [iv, tag, ciphertext] = payload.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv(ALGORITHM, keyFromBase64(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function encryptJson(value: unknown, key: string): string {
  return encrypt(JSON.stringify(value), key);
}

export function decryptJson<T>(payload: string, key: string): T {
  return JSON.parse(decrypt(payload, key)) as T;
}

/** Show only the last 4 characters so the UI can confirm which key is configured (I5.3). */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function hmacSha256Hex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}
