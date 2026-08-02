import { describe, expect, it } from 'vitest';
import type {
  BuyerReviewSummaryDto,
  SellerReviewPortalDto,
  SqlDatabase,
} from '@ygb/contracts';
import { attachBuyerReviewUrl } from '../buyer-reviews/review-url-projection';
import { attachSellerReviewUrl } from './review-url-projection';

function database(row: Record<string, unknown>): SqlDatabase {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() { return row; },
          };
        },
      };
    },
  } as unknown as SqlDatabase;
}

function sellerReview(status: SellerReviewPortalDto['status']): SellerReviewPortalDto {
  return {
    review_case_id: 'review-1',
    formal_order_id: 'formal-order-1',
    amazon_order_number: '123-1234567-1234567',
    review_type: 'TEXT',
    status,
    version: 1,
    current_evidence_version_no: 1,
    public_change_reason: null,
    submitted_at: 10,
    updated_at: 10,
    decided_at: status === 'APPROVED' ? 20 : null,
    store: { id: 'store-1', name: 'Store' },
    product: { id: 'product-1', asin: 'B000000001', product_name: 'Product' },
    service_fee_cny_fen: '100',
    files: [],
  };
}

const sellerActor = {
  sellerOrganizationId: 'seller-1',
  sellerMemberId: 'member-1',
  allActiveStores: true,
  storeIds: Object.freeze([]),
};

describe('Wave 11 review URL DTO isolation', () => {
  it.each([
    'PENDING_REVIEW',
    'CHANGES_REQUESTED',
    'REJECTED',
    'WITHDRAWN',
  ] as const)('returns null to Seller while status is %s', async (status) => {
    const result = await attachSellerReviewUrl(
      database({
        review_url: 'https://example.com/current-review',
        submitted_at: 200,
      }),
      sellerActor as never,
      sellerReview(status),
    );
    expect(result.review_url).toBeNull();
    expect(result.submitted_at).toBe(200);
  });

  it('returns the current approved URL to Seller', async () => {
    const result = await attachSellerReviewUrl(
      database({
        review_url: 'https://example.com/approved-review',
        submitted_at: 300,
      }),
      sellerActor as never,
      sellerReview('APPROVED'),
    );
    expect(result.review_url).toBe('https://example.com/approved-review');
    expect(result.submitted_at).toBe(300);
  });

  it('returns only the Buyer current-evidence URL and server timestamp', async () => {
    const review = {
      review_case_id: 'review-1',
      formal_order_id: 'formal-order-1',
      amazon_order_number: '123-1234567-1234567',
      review_type: 'TEXT',
      status: 'CHANGES_REQUESTED',
      version: 2,
      current_evidence_version_no: 2,
      buyer_note: 'new version',
      public_change_reason: 'fix url',
      submitted_at: 100,
      updated_at: 100,
      decided_at: null,
      withdrawn_at: null,
      store: { id: 'store-1', name: 'Store' },
      product: { id: 'product-1', asin: 'B000000001', product_name: 'Product' },
    } satisfies BuyerReviewSummaryDto;
    const result = await attachBuyerReviewUrl(
      database({
        review_case_id: 'review-1',
        review_url: 'https://example.com/current-v2',
        submitted_at: 400,
      }),
      { buyerCustomerId: 'buyer-1' } as never,
      review,
    );
    expect(result.review_url).toBe('https://example.com/current-v2');
    expect(result.current_evidence_version_no).toBe(2);
    expect(result.submitted_at).toBe(400);
  });
});