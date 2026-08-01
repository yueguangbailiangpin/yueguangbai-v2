import {
  BUYER_FORMAL_ORDER_DEFAULT_PAGE_SIZE,
  BUYER_FORMAL_ORDER_MAX_PAGE_SIZE,
} from '@ygb/contracts';
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
  const payload = JSON.stringify({
    v: 1,
    confirmed_at: cursor.confirmedAt,
    id: cursor.id,
  });
  const bytes = new TextEncoder().encode(payload);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decodeBuyerFormalOrderCursor(
  value: string | undefined,
): BuyerFormalOrderCursor | null {
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
    const parsed = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as unknown;
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
