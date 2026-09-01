import {
  BUYER_FORMAL_ORDER_DEFAULT_PAGE_SIZE,
  BUYER_FORMAL_ORDER_MAX_PAGE_SIZE,
} from '@ygb/contracts';
import { decodeBase64UrlJson, encodeBase64UrlJson } from '../foundation/cursor-codec';
import { BuyerFormalOrderPortalError } from './errors';

export interface BuyerFormalOrderCursor {
  confirmedAt: number;
  id: string;
}

export function parseBuyerFormalOrderPageLimit(
  value: string | undefined,
): number {
  if (value === undefined) return BUYER_FORMAL_ORDER_DEFAULT_PAGE_SIZE;
  if (!/^[1-9][0-9]*$/u.test(value)) return validationError();
  const limit = Number(value);
  if (!Number.isSafeInteger(limit)
    || limit < 1
    || limit > BUYER_FORMAL_ORDER_MAX_PAGE_SIZE) {
    return validationError();
  }
  return limit;
}

export function encodeBuyerFormalOrderCursor(
  cursor: BuyerFormalOrderCursor,
): string {
  return encodeBase64UrlJson({
    v: 1,
    confirmed_at: cursor.confirmedAt,
    id: cursor.id,
  });
}

export function decodeBuyerFormalOrderCursor(
  value: string | undefined,
): BuyerFormalOrderCursor | null {
  if (value === undefined) return null;
  if (value.length < 1 || value.length > 1000) return validationError();
  try {
    const parsed = decodeBase64UrlJson(value);
    if (!isCursorPayload(parsed)) return validationError();
    return {
      confirmedAt: parsed.confirmed_at,
      id: parsed.id,
    };
  } catch {
    return validationError();
  }
}

function isCursorPayload(value: unknown): value is {
  v: 1;
  confirmed_at: number;
  id: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['v'] === 1
    && Number.isSafeInteger(candidate['confirmed_at'])
    && Number(candidate['confirmed_at']) >= 0
    && typeof candidate['id'] === 'string'
    && candidate['id'].length >= 1
    && candidate['id'].length <= 120
    && !/[\u0000-\u001f\u007f]/u.test(candidate['id']);
}

function validationError(): never {
  throw new BuyerFormalOrderPortalError('VALIDATION_ERROR', 400);
}
