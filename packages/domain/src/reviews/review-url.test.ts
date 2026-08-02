import { describe, expect, it } from 'vitest';
import {
  normalizeReviewUrl,
  ReviewUrlValidationError,
} from './review-url';

describe('Wave 11 review URL normalization', () => {
  it('allows a null URL only for RATING', () => {
    expect(normalizeReviewUrl('RATING', null)).toBeNull();
    for (const type of ['TEXT', 'IMAGE', 'VIDEO'] as const) {
      expect(() => normalizeReviewUrl(type, null))
        .toThrow(ReviewUrlValidationError);
    }
  });

  it('normalizes NFKC, host casing and removes fragments', () => {
    expect(normalizeReviewUrl(
      'IMAGE',
      '  https://EXAMPLE.com/review?id=１２３#private  ',
    )).toBe('https://example.com/review?id=123');
  });

  it('retains path and query', () => {
    expect(normalizeReviewUrl(
      'TEXT',
      'https://example.com/a/b?x=1&y=2',
    )).toBe('https://example.com/a/b?x=1&y=2');
  });

  it('rejects HTTP, credentials and invalid URLs', () => {
    for (const value of [
      'http://example.com/review',
      'https://user:password@example.com/review',
      'not a url',
      'https://',
    ]) {
      expect(() => normalizeReviewUrl('VIDEO', value))
        .toThrow(ReviewUrlValidationError);
    }
  });

  it('rejects values longer than 2048 characters', () => {
    expect(() => normalizeReviewUrl(
      'TEXT',
      `https://example.com/${'a'.repeat(2049)}`,
    )).toThrow(ReviewUrlValidationError);
  });
});