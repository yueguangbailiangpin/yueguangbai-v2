import { describe, expect, it } from 'vitest';
import {
  isMarketplaceCode,
  isCanonicalMarketplaceCode,
  LEGACY_MARKETPLACE_CODES,
  isSellerMemberRole,
  MARKETPLACE_CODES,
  SELLER_MEMBER_ROLES,
} from './customer';

describe('customer master-data contracts', () => {
  it('publishes stable marketplace codes while accepting the JP alias', () => {
    expect(MARKETPLACE_CODES).toEqual([
      'AMAZON_JP', 'AMAZON_US', 'COUPANG_KR',
    ]);
    expect(LEGACY_MARKETPLACE_CODES).toEqual(['JP']);
    expect(isMarketplaceCode('JP')).toBe(true);
    expect(isMarketplaceCode('AMAZON_US')).toBe(true);
    expect(isCanonicalMarketplaceCode('AMAZON_US')).toBe(true);
    expect(isCanonicalMarketplaceCode('JP')).toBe(false);
    expect(isMarketplaceCode('US')).toBe(false);
  });

  it('publishes the four frozen seller-member roles', () => {
    expect(SELLER_MEMBER_ROLES).toEqual([
      'OWNER',
      'OPERATIONS',
      'FINANCE',
      'VIEWER',
    ]);
    expect(isSellerMemberRole('FINANCE')).toBe(true);
    expect(isSellerMemberRole('ADMIN')).toBe(false);
  });
});
