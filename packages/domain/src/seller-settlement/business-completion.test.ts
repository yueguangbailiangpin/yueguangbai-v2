import { describe, expect, it } from 'vitest';
import { sellerBusinessCompletion } from './business-completion';

const complete = {
  reviewStatus: 'APPROVED',
  buyerRefundExpectedCnyFen: 100n,
  buyerRefundStatus: 'PAID',
  principalExpectedCnyFen: 1_000n,
  principalStatus: 'PAID',
  serviceFeeExpectedCnyFen: 50n,
  serviceFeeStatus: 'PAID',
};

describe('seller business completion truth', () => {
  it('requires all four independent components', () => {
    expect(sellerBusinessCompletion(complete)).toEqual({
      status: 'COMPLETE', review: 'COMPLETE', buyer_refund: 'COMPLETE',
      seller_principal: 'COMPLETE', seller_service_fee: 'COMPLETE',
    });
    expect(sellerBusinessCompletion({ ...complete, serviceFeeStatus: 'UNPAID' }))
      .toMatchObject({ status: 'IN_PROGRESS', seller_service_fee: 'PENDING' });
  });

  it('marks zero authoritative amounts not applicable only after prerequisites', () => {
    expect(sellerBusinessCompletion({
      ...complete,
      buyerRefundExpectedCnyFen: 0n,
      serviceFeeExpectedCnyFen: 0n,
      buyerRefundStatus: null,
      serviceFeeStatus: null,
    })).toMatchObject({
      status: 'COMPLETE',
      buyer_refund: 'NOT_APPLICABLE',
      seller_service_fee: 'NOT_APPLICABLE',
    });
    expect(sellerBusinessCompletion({
      ...complete,
      reviewStatus: null,
      buyerRefundExpectedCnyFen: 0n,
      serviceFeeExpectedCnyFen: 0n,
    })).toMatchObject({
      status: 'IN_PROGRESS', review: 'PENDING', buyer_refund: 'PENDING',
      seller_service_fee: 'PENDING',
    });
  });
});
