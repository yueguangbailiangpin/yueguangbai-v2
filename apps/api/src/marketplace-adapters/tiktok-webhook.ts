import { MarketplaceProviderError } from './error';
import { hexToBytes, hmacSha256 } from './tiktok-signature';
import {
  boundedProviderString,
  providerRecord,
} from './validation';

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export interface VerifiedTikTokShopWebhookEnvelope {
  type: number;
  notification_id: string;
  shop_id: string;
  timestamp_unix_seconds: number;
}

interface TimingSafeSubtleCrypto extends SubtleCrypto {
  timingSafeEqual?: (left: BufferSource, right: BufferSource) => boolean;
}

/**
 * Verifies exact raw bytes before parsing. It intentionally applies no
 * invented freshness window: TikTok's public webhook docs do not publish one.
 */
export async function verifyTikTokShopWebhook(
  rawBody: Uint8Array,
  authorization: string,
  appKey: string,
  appSecret: string,
): Promise<VerifiedTikTokShopWebhookEnvelope> {
  if (rawBody.byteLength < 2 || rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES
    || !boundedProviderString(appKey, 256)
    || !boundedProviderString(appSecret, 4_096)) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  const verifiedBody = new Uint8Array(rawBody);
  const received = hexToBytes(authorization);
  if (!received) throw new MarketplaceProviderError('AUTHENTICATION');
  const appKeyBytes = new TextEncoder().encode(appKey);
  const signedBytes = new Uint8Array(
    appKeyBytes.byteLength + verifiedBody.byteLength,
  );
  signedBytes.set(appKeyBytes, 0);
  signedBytes.set(verifiedBody, appKeyBytes.byteLength);
  const expected = await hmacSha256(
    new TextEncoder().encode(appSecret),
    signedBytes,
  );
  if (!constantTimeEqual(expected, received)) {
    throw new MarketplaceProviderError('AUTHENTICATION');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(verifiedBody),
    );
  } catch {
    throw new MarketplaceProviderError('CONTRACT');
  }
  const envelope = providerRecord(parsed);
  const type = envelope?.['type'];
  const notificationId = envelope?.['tts_notification_id'];
  const shopId = envelope?.['shop_id'];
  const timestamp = envelope?.['timestamp'];
  if (!Number.isSafeInteger(type) || Number(type) < 0
    || !boundedProviderString(notificationId, 200)
    || !boundedProviderString(shopId, 200)
    || !Number.isSafeInteger(timestamp) || Number(timestamp) < 1) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  return Object.freeze({
    type: Number(type),
    notification_id: notificationId,
    shop_id: shopId,
    timestamp_unix_seconds: Number(timestamp),
  });
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const subtle = crypto.subtle as TimingSafeSubtleCrypto;
  if (typeof subtle.timingSafeEqual === 'function') {
    return subtle.timingSafeEqual(
      new Uint8Array(left),
      new Uint8Array(right),
    );
  }
  // Node's Web Crypto does not yet expose timingSafeEqual. Length is public
  // and fixed above; this fallback has no data-dependent early return.
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
