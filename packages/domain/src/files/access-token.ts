import { sha256Hex } from '../crypto/sha256';

export function generateOpaqueFileToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function hashOpaqueFileToken(token: string): Promise<string> {
  if (!isOpaqueFileToken(token)) throw new Error('invalid_file_token');
  return sha256Hex(token);
}

export function isOpaqueFileToken(value: string): boolean {
  return typeof value === 'string'
    && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

export function constantTimeHexEqual(
  left: string,
  right: string,
): boolean {
  if (!/^[0-9a-f]+$/u.test(left)
    || !/^[0-9a-f]+$/u.test(right)
    || left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function toBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
