import {
  BUYER_REFUND_PORTAL_DEFAULT_PAGE_SIZE,
  BUYER_REFUND_PORTAL_MAX_PAGE_SIZE,
} from '@ygb/contracts';
import { BuyerRefundPortalError } from './errors';

export interface BuyerRefundPortalCursor {
  updatedAt: number;
  id: string;
}

export function parseBuyerRefundPortalPageLimit(
  value: string | undefined,
): number {
  if (value === undefined) return BUYER_REFUND_PORTAL_DEFAULT_PAGE_SIZE;
  if (!/^[1-9][0-9]*$/u.test(value)) return validationError();
  const limit = Number(value);
  if (!Number.isSafeInteger(limit)
    || limit < 1
    || limit > BUYER_REFUND_PORTAL_MAX_PAGE_SIZE) {
    return validationError();
  }
  return limit;
}

export function encodeBuyerRefundPortalCursor(
  cursor: BuyerRefundPortalCursor,
): string {
  const bytes = new TextEncoder().encode(JSON.stringify({
    v: 1,
    kind: 'buyer-refund',
    at: cursor.updatedAt,
    id: cursor.id,
  }));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decodeBuyerRefundPortalCursor(
  value: string | undefined,
): BuyerRefundPortalCursor | null {
  if (value === undefined) return null;
  if (value.length < 1 || value.length > 1000) return validationError();
  try {
    const base64 = value
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!isCursorPayload(parsed)) return validationError();
    return { updatedAt: parsed.at, id: parsed.id };
  } catch {
    return validationError();
  }
}

interface CursorPayload {
  v: 1;
  kind: 'buyer-refund';
  at: number;
  id: string;
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['v'] === 1
    && candidate['kind'] === 'buyer-refund'
    && Number.isSafeInteger(candidate['at'])
    && Number(candidate['at']) >= 0
    && typeof candidate['id'] === 'string'
    && candidate['id'].length >= 1
    && candidate['id'].length <= 120
    && !/[\u0000-\u001f\u007f]/u.test(candidate['id']);
}

function validationError(): never {
  throw new BuyerRefundPortalError('VALIDATION_ERROR', 400);
}
