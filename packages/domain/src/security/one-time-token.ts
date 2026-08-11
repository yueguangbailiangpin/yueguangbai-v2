import { sha256Hex } from '../crypto/sha256';

const MIN_SECRET_BYTES = 32;
const TOKEN_BYTES = 32;

export async function deriveOneTimeToken(
  secret: string,
  purpose: 'BUYER_INVITATION' | 'SELLER_INVITATION' | 'PASSWORD_RESET',
  issuerId: string,
  idempotencyKey: string,
  requestHash: string,
): Promise<string> {
  const secretBytes = new TextEncoder().encode(secret);
  if (secretBytes.byteLength < MIN_SECRET_BYTES) {
    throw new Error('customer_security_token_secret_too_short');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const material = `${purpose}\n${issuerId}\n${idempotencyKey}\n${requestHash}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(material),
  );
  const bytes = new Uint8Array(signature).slice(0, TOKEN_BYTES);
  return encodeBase64Url(bytes);
}

export function isOneTimeToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length === 43
    && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

export async function hashOneTimeToken(token: string): Promise<string> {
  if (!isOneTimeToken(token)) throw new Error('invalid_one_time_token');
  return sha256Hex(token);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}
