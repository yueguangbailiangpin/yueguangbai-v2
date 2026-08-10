import { MarketplaceProviderError } from './error';
import { boundedProviderString } from './validation';

export const TIKTOK_SHOP_OFFICIAL_API_ORIGIN =
  'https://open-api.tiktokglobalshop.com';

export interface TikTokShopRequestSignatureInput {
  appSecret: string;
  path: string;
  query: Readonly<Record<string, string>>;
  bodyText?: string;
}

/** Official TikTok Shop request-signature algorithm; it performs no I/O. */
export async function signTikTokShopRequest(
  input: TikTokShopRequestSignatureInput,
): Promise<string> {
  if (!boundedProviderString(input.appSecret, 4_096)
    || !validApiPath(input.path)) {
    throw new MarketplaceProviderError('CONFIGURATION');
  }
  const entries = Object.entries(input.query)
    .filter(([key]) => key !== 'sign' && key !== 'access_token');
  for (const [key, value] of entries) {
    if (!/^[a-z][a-z0-9_]*$/u.test(key)
      || !boundedProviderString(value, 4_096)) {
      throw new MarketplaceProviderError('CONTRACT');
    }
  }
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const canonicalQuery = entries.map(([key, value]) => `${key}${value}`).join('');
  const canonical = `${input.appSecret}${input.path}${canonicalQuery}${input.bodyText ?? ''}${input.appSecret}`;
  return bytesToHex(await hmacSha256(
    new TextEncoder().encode(input.appSecret),
    new TextEncoder().encode(canonical),
  ));
}

export async function hmacSha256(
  keyBytes: Uint8Array,
  valueBytes: Uint8Array,
): Promise<Uint8Array> {
  try {
    const keyMaterial = new Uint8Array(keyBytes);
    const message = new Uint8Array(valueBytes);
    const key = await crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  } catch {
    throw new MarketplaceProviderError('UNAVAILABLE');
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/u.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function validApiPath(value: string): boolean {
  return value.startsWith('/') && value.length <= 500
    && !value.includes('?') && !value.includes('#')
    && !/\p{Cc}/u.test(value);
}
