import { canonicalJson } from '../serialization/canonical-json';

const SESSION_VERSION = 'v1';
const MIN_SECRET_BYTES = 32;
const MAX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CustomerSessionPayload {
  account_id: string;
  identity_subject_id: string;
  account_type: 'BUYER' | 'SELLER_MEMBER';
  session_version: number;
  issued_at: number;
  expires_at: number;
  nonce: string;
}

export async function signCustomerSession(
  payload: CustomerSessionPayload,
  secret: string,
): Promise<string> {
  validatePayload(payload);
  const key = await importSecret(secret);
  const payloadPart = encodeBase64Url(
    new TextEncoder().encode(canonicalJson(payload)),
  );
  const signedPart = `${SESSION_VERSION}.${payloadPart}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPart),
  );
  return `${signedPart}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyCustomerSession(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<CustomerSessionPayload | null> {
  if (!Number.isSafeInteger(now) || now < 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== SESSION_VERSION) return null;

  const payloadPart = parts[1];
  const signaturePart = parts[2];
  if (!payloadPart || !signaturePart) return null;

  try {
    const key = await importSecret(secret);
    const signature = decodeBase64Url(signaturePart);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      new TextEncoder().encode(`${SESSION_VERSION}.${payloadPart}`),
    );
    if (!valid) return null;

    const decoded = new TextDecoder().decode(
      decodeBase64Url(payloadPart),
    );
    const payload = JSON.parse(decoded) as CustomerSessionPayload;
    validatePayload(payload);
    if (payload.issued_at > now
      || payload.expires_at <= now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createCustomerSessionPayload(input: {
  accountId: string;
  identitySubjectId: string;
  accountType: 'BUYER' | 'SELLER_MEMBER';
  sessionVersion: number;
  now?: number | undefined;
  ttlMs?: number | undefined;
}): CustomerSessionPayload {
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(ttlMs)
    || ttlMs < 60_000
    || ttlMs > MAX_SESSION_TTL_MS
    || now + ttlMs > Number.MAX_SAFE_INTEGER) {
    throw new Error('invalid_customer_session_time');
  }

  return {
    account_id: input.accountId,
    identity_subject_id: input.identitySubjectId,
    account_type: input.accountType,
    session_version: input.sessionVersion,
    issued_at: now,
    expires_at: now + ttlMs,
    nonce: crypto.randomUUID(),
  };
}

function validatePayload(
  payload: CustomerSessionPayload,
): void {
  if (!safeIdentifier(payload.account_id)
    || !safeIdentifier(payload.identity_subject_id)
    || (payload.account_type !== 'BUYER'
      && payload.account_type !== 'SELLER_MEMBER')
    || !Number.isSafeInteger(payload.session_version)
    || payload.session_version < 1
    || !Number.isSafeInteger(payload.issued_at)
    || payload.issued_at < 0
    || !Number.isSafeInteger(payload.expires_at)
    || payload.expires_at <= payload.issued_at
    || payload.expires_at - payload.issued_at > MAX_SESSION_TTL_MS
    || !safeIdentifier(payload.nonce)) {
    throw new Error('invalid_customer_session_payload');
  }
}

async function importSecret(secret: string): Promise<CryptoKey> {
  const bytes = new TextEncoder().encode(secret);
  if (bytes.byteLength < MIN_SECRET_BYTES) {
    throw new Error('customer_session_secret_too_short');
  }
  return crypto.subtle.importKey(
    'raw',
    bytes,
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign', 'verify'],
  );
}

function safeIdentifier(value: string): boolean {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 200
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('invalid_base64url');
  }
  const padded = value
    .replace(/-/gu, '+')
    .replace(/_/gu, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
