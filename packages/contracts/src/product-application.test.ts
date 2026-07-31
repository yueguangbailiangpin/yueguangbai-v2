import { describe, expect, it } from 'vitest';
import {
  isProductApplicationReviewDecision,
  PRODUCT_APPLICATION_REVIEW_DECISIONS,
  PRODUCT_APPLICATION_STATUSES,
} from './product-application';

describe('product application contracts', () => {
  it('publishes the frozen application states', () => {
    expect(PRODUCT_APPLICATION_STATUSES).toEqual([
      'SUBMITTED',
      'APPROVED',
      'REJECTED',
      'WITHDRAWN',
    ]);
  });

  it('recognizes only approve and reject review decisions', () => {
    expect(PRODUCT_APPLICATION_REVIEW_DECISIONS).toEqual([
      'APPROVE',
      'REJECT',
    ]);
    expect(isProductApplicationReviewDecision('APPROVE'))
      .toBe(true);
    expect(isProductApplicationReviewDecision('PUBLISH'))
      .toBe(false);
  });
});
