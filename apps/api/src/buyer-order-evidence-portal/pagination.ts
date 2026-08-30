import { BuyerOrderEvidencePortalError } from './errors';
import {
  decodeBase64UrlBinary,
  encodeBase64UrlBinary,
} from '../foundation/cursor-codec';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 1024;

export interface EligibleReservationCursor {
  orderDeadline: number;
  submittedAt: number;
  id: string;
}

export interface OrderEvidenceCursor {
  updatedAt: number;
  id: string;
}

export function parseBuyerOrderEvidencePageLimit(
  value: string | undefined,
): number {
  if (value === undefined || value === '') return DEFAULT_LIMIT;
  if (!/^\d{1,3}$/u.test(value)) {
    throw new BuyerOrderEvidencePortalError(
      'VALIDATION_ERROR',
      400,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)
    || parsed < 1
    || parsed > MAX_LIMIT) {
    throw new BuyerOrderEvidencePortalError(
      'VALIDATION_ERROR',
      400,
    );
  }
  return parsed;
}

export function encodeEligibleReservationCursor(
  cursor: EligibleReservationCursor,
): string {
  return encodeCursor({
    k: 'buyer-order-evidence-eligible',
    order_deadline: cursor.orderDeadline,
    submitted_at: cursor.submittedAt,
    id: cursor.id,
  });
}

export function decodeEligibleReservationCursor(
  value: string | undefined,
): EligibleReservationCursor | null {
  if (!value) return null;
  const decoded = decodeCursor(value);
  if (decoded['k'] !== 'buyer-order-evidence-eligible') {
    return invalidCursor();
  }
  return {
    orderDeadline: integerField(decoded, 'order_deadline'),
    submittedAt: integerField(decoded, 'submitted_at'),
    id: identifierField(decoded, 'id'),
  };
}

export function encodeOrderEvidenceCursor(
  cursor: OrderEvidenceCursor,
): string {
  return encodeCursor({
    k: 'buyer-order-evidence',
    updated_at: cursor.updatedAt,
    id: cursor.id,
  });
}

export function decodeOrderEvidenceCursor(
  value: string | undefined,
): OrderEvidenceCursor | null {
  if (!value) return null;
  const decoded = decodeCursor(value);
  if (decoded['k'] !== 'buyer-order-evidence') {
    return invalidCursor();
  }
  return {
    updatedAt: integerField(decoded, 'updated_at'),
    id: identifierField(decoded, 'id'),
  };
}

function encodeCursor(
  value: Record<string, string | number>,
): string {
  return encodeBase64UrlBinary(JSON.stringify(value));
}

function decodeCursor(
  value: string,
): Record<string, unknown> {
  if (value.length < 1
    || value.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return invalidCursor();
  }

  try {
    const parsed: unknown = JSON.parse(decodeBase64UrlBinary(value));
    if (!parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)) {
      return invalidCursor();
    }
    return parsed as Record<string, unknown>;
  } catch {
    return invalidCursor();
  }
}

function integerField(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return invalidCursor();
  }
  return Number(value);
}

function identifierField(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 120
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    return invalidCursor();
  }
  return value;
}

function invalidCursor(): never {
  throw new BuyerOrderEvidencePortalError(
    'VALIDATION_ERROR',
    400,
  );
}
