const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

export function generateStaffOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export async function hashStaffOpaqueToken(
  token: string,
): Promise<string> {
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error('invalid_staff_opaque_token');
  }
  return sha256Hex(new TextEncoder().encode(token));
}

export async function hashStaffSecurityScope(
  secret: string,
  namespace: string,
  value: string,
): Promise<string> {
  if (secret.length < 32 || secret.length > 4096) {
    throw new Error('invalid_staff_auth_hash_secret');
  }
  return sha256Hex(new TextEncoder().encode(
    `${namespace}\u0000${secret}\u0000${value}`,
  ));
}

export function isStaffOpaqueToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function isStaffTokenHash(value: string): boolean {
  return HASH_PATTERN.test(value);
}

export function constantTimeTextEqual(
  left: string,
  right: string,
): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const size = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < size; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
