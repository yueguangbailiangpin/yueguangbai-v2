import {
  BUYER_REVIEW_DEFAULT_PAGE_SIZE,
  BUYER_REVIEW_MAX_PAGE_SIZE,
} from '@ygb/contracts';
import { decodeBase64UrlJson, encodeBase64UrlJson } from '../foundation/cursor-codec';
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
  return encodeBase64UrlJson(value);
}

function decodeCursor(
  value: string | undefined,
  kind: CursorPayload['kind'],
): CursorPayload | null {
  if (value === undefined) return null;
  if (value.length < 1 || value.length > 1000) return validationError();
  try {
    const parsed = decodeBase64UrlJson(value);
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
