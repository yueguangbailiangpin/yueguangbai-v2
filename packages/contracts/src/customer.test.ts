import { describe, expect, it } from 'vitest';
import {
  isMarketplaceCode,
  isSellerMemberRole,
  MARKETPLACE_CODES,
  SELLER_MEMBER_ROLES,
} from './customer';

describe('customer master-data contracts', () => {
  it('publishes JP as the first marketplace', () => {
    expect(MARKETPLACE_CODES).toEqual(['JP']);
    expect(isMarketplaceCode('JP')).toBe(true);
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
