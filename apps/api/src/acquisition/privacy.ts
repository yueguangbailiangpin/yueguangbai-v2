import { normalizeWechatId } from '@ygb/domain';
import { AcquisitionError } from './errors';

const encoder = new TextEncoder();

export interface ProtectedWechatIdentity {
  normalized: string;
  hash: string;
  ciphertext: string;
  iv: string;
  masked: string;
}

export async function protectWechatIdentity(
  raw: string,
  secret: string,
): Promise<ProtectedWechatIdentity> {
  const normalized = normalizeWechatId(raw);
  const keyMaterial = requireSecret(secret);
  const hashKey = await crypto.subtle.importKey(
    'raw', keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const hash = hex(await crypto.subtle.sign(
    'HMAC', hashKey, encoder.encode(normalized.normalized),
  ));
  const encryptionKey = await crypto.subtle.importKey(
    'raw', await crypto.subtle.digest('SHA-256', encoder.encode(`acquisition:${secret}`)),
    { name: 'AES-GCM' }, false, ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify({
    display: normalized.display,
    normalized: normalized.normalized,
  }));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, encryptionKey, plaintext,
  );
  return {
    normalized: normalized.normalized,
    hash,
    ciphertext: base64url(new Uint8Array(ciphertext)),
    iv: base64url(iv),
    masked: maskWechat(normalized.display),
  };
}

export async function hashNormalizedWechat(
  normalizedWechat: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', requireSecret(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return hex(await crypto.subtle.sign(
    'HMAC', key, encoder.encode(normalizedWechat),
  ));
}

export function requireAcquisitionSecret(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AcquisitionError('DEPENDENCY_UNAVAILABLE', 503);
  }
  requireSecret(value);
  return value;
}

function requireSecret(value: string): ArrayBuffer {
  const bytes = encoder.encode(value);
  if (bytes.byteLength < 32) {
    throw new AcquisitionError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function maskWechat(value: string): string {
  const characters = [...value];
  if (characters.length <= 3) return `${characters[0]}*${characters.at(-1)}`;
  return `${characters.slice(0, 2).join('')}***${characters.slice(-2).join('')}`;
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
