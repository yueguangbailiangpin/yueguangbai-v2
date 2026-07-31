import {
  SELLER_PORTAL_DEFAULT_PAGE_SIZE,
  SELLER_PORTAL_MAX_PAGE_SIZE,
} from '@ygb/contracts';
import { SellerPortalError } from './errors';

export interface SellerPortalPagination {
  limit: number;
  cursor: string | null;
}

export function parseSellerPortalPagination(
  url: URL,
): SellerPortalPagination {
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null
    ? SELLER_PORTAL_DEFAULT_PAGE_SIZE
    : Number(rawLimit);
  if (!Number.isSafeInteger(limit)
    || limit < 1
    || limit > SELLER_PORTAL_MAX_PAGE_SIZE) {
    throw new SellerPortalError('VALIDATION_ERROR', 400);
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null
    && (cursor.length < 1 || cursor.length > 1000)) {
    throw new SellerPortalError('VALIDATION_ERROR', 400);
  }
  return { limit, cursor };
}

export function encodeSellerPortalCursor(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decodeSellerPortalCursor<T>(
  value: string | null,
  guard: (candidate: unknown) => candidate is T,
): T | null {
  if (value === null) return null;
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
    if (!guard(parsed)) throw new Error('invalid_cursor');
    return parsed;
  } catch {
    throw new SellerPortalError('VALIDATION_ERROR', 400);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value);
}
