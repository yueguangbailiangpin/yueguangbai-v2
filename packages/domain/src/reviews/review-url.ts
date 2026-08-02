import type { PricingReviewType } from '@ygb/contracts';

export class ReviewUrlValidationError extends Error {
  readonly code = 'VALIDATION_ERROR' as const;

  constructor() {
    super('VALIDATION_ERROR');
    this.name = 'ReviewUrlValidationError';
  }
}

/**
 * Canonicalizes the URL that belongs to one immutable review evidence version.
 * Fragments are deliberately discarded; path and query are retained.
 */
export function normalizeReviewUrl(
  reviewType: PricingReviewType,
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) {
    if (reviewType === 'RATING') return null;
    throw new ReviewUrlValidationError();
  }
  if (typeof raw !== 'string') throw new ReviewUrlValidationError();

  const normalized = raw.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 2048
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ReviewUrlValidationError();
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ReviewUrlValidationError();
  }
  if (parsed.protocol !== 'https:'
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.hostname.length < 1) {
    throw new ReviewUrlValidationError();
  }

  parsed.hash = '';
  const serialized = parsed.toString();
  if (serialized.length > 2048
    || !serialized.startsWith('https://')) {
    throw new ReviewUrlValidationError();
  }
  return serialized;
}