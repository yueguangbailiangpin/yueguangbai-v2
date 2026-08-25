import { describe, expect, it } from 'vitest';
import {
  BUYER_SUPPORTED_MARKETPLACE_CODES,
  isBuyerSupportedMarketplaceCode,
  isMarketplaceCode,
  isCanonicalMarketplaceCode,
  isSellerMemberRole,
  MARKETPLACE_CODES,
  SELLER_MEMBER_ROLES,
} from './customer';

describe('customer master-data contracts', () => {
  it('publishes exactly the three canonical marketplace codes and rejects the retired JP alias', () => {
    expect(MARKETPLACE_CODES).toEqual([
      'AMAZON_JP', 'AMAZON_US', 'COUPANG_KR',
    ]);
    expect(isMarketplaceCode('AMAZON_JP')).toBe(true);
    expect(isMarketplaceCode('AMAZON_US')).toBe(true);
    expect(isCanonicalMarketplaceCode('AMAZON_US')).toBe(true);
    expect(isCanonicalMarketplaceCode('JP')).toBe(false);
    expect(isCanonicalMarketplaceCode('RAKUTEN_JP')).toBe(false);
    expect(isCanonicalMarketplaceCode('TIKTOK_JP')).toBe(false);
    expect(isMarketplaceCode('JP')).toBe(false);
    expect(isMarketplaceCode('US')).toBe(false);
    expect(BUYER_SUPPORTED_MARKETPLACE_CODES).toEqual([
      'AMAZON_JP', 'AMAZON_US', 'COUPANG_KR',
    ]);
    expect(isBuyerSupportedMarketplaceCode('AMAZON_JP')).toBe(true);
    expect(isBuyerSupportedMarketplaceCode('RAKUTEN_JP')).toBe(false);
    expect(isBuyerSupportedMarketplaceCode('TIKTOK_JP')).toBe(false);
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
