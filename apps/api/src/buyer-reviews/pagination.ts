import {
  BUYER_REVIEW_DEFAULT_PAGE_SIZE,
  BUYER_REVIEW_MAX_PAGE_SIZE,
} from '@ygb/contracts';
import { BuyerReviewPortalError } from './errors';

export interface EligibleReviewOrderCursor {
  confirmedAt: number;
  id: string;
}

export interface BuyerReviewCursor {
  updatedAt: number;
  id: string;
}

export function parseBuyerReviewPageLimit(
  value: string | undefined,
): number {
  if (value === undefined) return BUYER_REVIEW_DEFAULT_PAGE_SIZE;
  if (!/^[1-9][0-9]*$/u.test(value)) return validationError();
  const limit = Number(value);
  if (!Number.isSafeInteger(limit)
    || limit < 1
    || limit > BUYER_REVIEW_MAX_PAGE_SIZE) {
    return validationError();
  }
  return limit;
}

export function encodeEligibleReviewOrderCursor(
  cursor: EligibleReviewOrderCursor,
): string {
  return encodeCursor({
    v: 1,
    kind: 'eligible-order',
    at: cursor.confirmedAt,
    id: cursor.id,
  });
}

export function decodeEligibleReviewOrderCursor(
  value: string | undefined,
): EligibleReviewOrderCursor | null {
  const parsed = decodeCursor(value, 'eligible-order');
  return parsed === null
    ? null
    : { confirmedAt: parsed.at, id: parsed.id };
}

export function encodeBuyerReviewCursor(
  cursor: BuyerReviewCursor,
): string {
  return encodeCursor({
    v: 1,
    kind: 'review',
    at: cursor.updatedAt,
    id: cursor.id,
  });
}

export function decodeBuyerReviewCursor(
  value: string | undefined,
): BuyerReviewCursor | null {
  const parsed = decodeCursor(value, 'review');
  return parsed === null
    ? null
    : { updatedAt: parsed.at, id: parsed.id };
}

function encodeCursor(value: CursorPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeCursor(
  value: string | undefined,
  kind: CursorPayload['kind'],
): CursorPayload | null {
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
    if (!isCursorPayload(parsed) || parsed.kind !== kind) {
      return validationError();
    }
    return parsed;
  } catch {
    return validationError();
  }
}

interface CursorPayload {
  v: 1;
  kind: 'eligible-order' | 'review';
  at: number;
  id: string;
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['v'] === 1
    && (candidate['kind'] === 'eligible-order'
      || candidate['kind'] === 'review')
    && Number.isSafeInteger(candidate['at'])
    && Number(candidate['at']) >= 0
    && typeof candidate['id'] === 'string'
    && candidate['id'].length >= 1
    && candidate['id'].length <= 120
    && !/[\u0000-\u001f\u007f]/u.test(candidate['id']);
}

function validationError(): never {
  throw new BuyerReviewPortalError('VALIDATION_ERROR', 400);
}
