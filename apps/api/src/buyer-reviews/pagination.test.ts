import { describe, expect, it } from 'vitest';
import {
  decodeBuyerReviewCursor,
  decodeEligibleReviewOrderCursor,
  encodeBuyerReviewCursor,
  encodeEligibleReviewOrderCursor,
  parseBuyerReviewPageLimit,
} from './pagination';

describe('buyer review pagination', () => {
  it('uses bounded defaults and rejects invalid limits', () => {
    expect(parseBuyerReviewPageLimit(undefined)).toBe(20);
    expect(parseBuyerReviewPageLimit('1')).toBe(1);
    expect(parseBuyerReviewPageLimit('100')).toBe(100);
    for (const value of ['0', '01', '101', '-1', 'x']) {
      expect(() => parseBuyerReviewPageLimit(value)).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
    }
  });

  it('round-trips typed stable cursors and rejects cursor substitution', () => {
    const eligible = encodeEligibleReviewOrderCursor({
      confirmedAt: 123,
      id: 'formal-order-1',
    });
    expect(decodeEligibleReviewOrderCursor(eligible)).toEqual({
      confirmedAt: 123,
      id: 'formal-order-1',
    });
    expect(() => decodeBuyerReviewCursor(eligible)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );

    const review = encodeBuyerReviewCursor({
      updatedAt: 456,
      id: 'review-case-1',
    });
    expect(decodeBuyerReviewCursor(review)).toEqual({
      updatedAt: 456,
      id: 'review-case-1',
    });
    expect(() => decodeEligibleReviewOrderCursor(review)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});
