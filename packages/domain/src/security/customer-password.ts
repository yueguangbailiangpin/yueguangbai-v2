// Workerd (Cloudflare Workers runtime) hard-caps PBKDF2 iterations at 100,000
// (crypto-impl-pbkdf2.c++: "PBKDF2 iteration counts above 100000 are not
// supported"); values above the cap throw DOMNotSupportedError on Workers.
// 100,000 is the platform maximum; OWASP 2023 recommends 600k for
// PBKDF2-SHA-256, which Workers cannot execute — 100k is the accepted
// platform-bound tradeoff.
export const CUSTOMER_PASSWORD_DEFAULT_ITERATIONS = 100_000;
const MIN_ITERATIONS = 10_000;
const MAX_ITERATIONS = 1_000_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const TEMPORARY_PASSWORD_LENGTH = 20;
const TEMPORARY_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';

export interface PasswordCredential {
  algorithm: 'PBKDF2_SHA256';
  iterations: number;
  saltBase64Url: string;
  hashBase64Url: string;
}

export interface HashPasswordOptions {
  iterations?: number;
  salt?: Uint8Array<ArrayBuffer>;
}

export function validateCustomerPassword(password: string): void {
  if (typeof password !== 'string'
    || password.length < 10
    || password.length > 128
    || /[\u0000-\u001f\u007f]/u.test(password)) {
    throw new Error('invalid_customer_password');
  }
}

export function generateTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(
    new Uint8Array(TEMPORARY_PASSWORD_LENGTH),
  );
  let value = '';
  for (const byte of bytes) {
    value += TEMPORARY_ALPHABET.charAt(
      byte % TEMPORARY_ALPHABET.length,
    );
  }
  return value;
}

export async function hashCustomerPassword(
  password: string,
  options: HashPasswordOptions = {},
): Promise<PasswordCredential> {
  validateCustomerPassword(password);
  const iterations = options.iterations ?? CUSTOMER_PASSWORD_DEFAULT_ITERATIONS;
  assertIterations(iterations);

  const salt = options.salt ?? crypto.getRandomValues(
    new Uint8Array(SALT_BYTES),
  );
  if (salt.byteLength !== SALT_BYTES) {
    throw new Error('invalid_password_salt');
  }

  const derived = await derive(
    password,
    salt,
    iterations,
  );

  return {
    algorithm: 'PBKDF2_SHA256',
    iterations,
    saltBase64Url: encodeBase64Url(salt),
    hashBase64Url: encodeBase64Url(derived),
  };
}

export async function verifyCustomerPassword(
  password: string,
  credential: PasswordCredential,
): Promise<boolean> {
  if (credential.algorithm !== 'PBKDF2_SHA256') return false;
  if (typeof password !== 'string'
    || password.length > 128
    || /[\u0000-\u001f\u007f]/u.test(password)) {
    return false;
  }

  try {
    assertIterations(credential.iterations);
    const salt = decodeBase64Url(credential.saltBase64Url);
    const expected = decodeBase64Url(credential.hashBase64Url);
    if (salt.byteLength !== SALT_BYTES
      || expected.byteLength !== HASH_BYTES) {
      return false;
    }

    const actual = await derive(
      password,
      salt,
      credential.iterations,
    );
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function assertIterations(iterations: number): void {
  if (!Number.isSafeInteger(iterations)
    || iterations < MIN_ITERATIONS
    || iterations > MAX_ITERATIONS) {
    throw new Error('invalid_password_iterations');
  }
}

function constantTimeEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
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
