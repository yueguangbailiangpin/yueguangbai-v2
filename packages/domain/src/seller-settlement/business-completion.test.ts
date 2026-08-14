import { describe, expect, it } from 'vitest';
import { sellerBusinessCompletion } from './business-completion';

const complete = {
  reviewStatus: 'APPROVED',
  principalExpectedCnyFen: 1_000n,
  principalStatus: 'PAID',
  serviceFeeExpectedCnyFen: 50n,
  serviceFeeStatus: 'PAID',
};

describe('seller business completion truth', () => {
  it('requires all seller-visible components', () => {
    expect(sellerBusinessCompletion(complete)).toEqual({
      status: 'COMPLETE', review: 'COMPLETE',
      seller_principal: 'COMPLETE', seller_service_fee: 'COMPLETE',
    });
    expect(sellerBusinessCompletion({ ...complete, serviceFeeStatus: 'UNPAID' }))
      .toMatchObject({ status: 'IN_PROGRESS', seller_service_fee: 'PENDING' });
  });

  it('marks zero authoritative amounts not applicable only after prerequisites', () => {
    expect(sellerBusinessCompletion({
      ...complete,
      serviceFeeExpectedCnyFen: 0n,
      serviceFeeStatus: null,
    })).toMatchObject({
      status: 'COMPLETE',
      seller_service_fee: 'NOT_APPLICABLE',
    });
    expect(sellerBusinessCompletion({
      ...complete,
      reviewStatus: null,
      serviceFeeExpectedCnyFen: 0n,
    })).toMatchObject({
      status: 'IN_PROGRESS', review: 'PENDING',
      seller_service_fee: 'PENDING',
    });
  });
});
