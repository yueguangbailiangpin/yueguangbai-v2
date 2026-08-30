import { describe, expect, it } from 'vitest';
import {
  canCreateSellerStore,
  canManageSellerMembers,
  canReadSellerSettlementFinancials,
  canWriteSellerOperations,
  canWriteSellerSettlementAccount,
  sellerMemberCapabilities,
  type SellerMemberCapability,
} from './seller-authorization';

const ROLES = ['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER'] as const;

describe('seller member authorization policy', () => {
  it('publishes the exact four-role capability matrix', () => {
    const expected: Record<
      typeof ROLES[number],
      readonly SellerMemberCapability[]
    > = {
      OWNER: [
        'SELLER_OPERATIONS_WRITE',
        'SELLER_STORE_CREATE',
        'SELLER_SETTLEMENT_ACCOUNT_WRITE',
        'SELLER_MEMBER_MANAGE',
        'SELLER_SETTLEMENT_FINANCIAL_READ',
      ],
      OPERATIONS: [
        'SELLER_OPERATIONS_WRITE',
        'SELLER_STORE_CREATE',
        'SELLER_SETTLEMENT_ACCOUNT_WRITE',
      ],
      FINANCE: [
        'SELLER_STORE_CREATE',
        'SELLER_SETTLEMENT_ACCOUNT_WRITE',
        'SELLER_SETTLEMENT_FINANCIAL_READ',
      ],
      VIEWER: ['SELLER_STORE_CREATE'],
    };

    for (const role of ROLES) {
      expect(sellerMemberCapabilities(role)).toEqual(expected[role]);
      expect(canWriteSellerOperations(role)).toBe(
        expected[role].includes('SELLER_OPERATIONS_WRITE'),
      );
      expect(canCreateSellerStore(role)).toBe(
        expected[role].includes('SELLER_STORE_CREATE'),
      );
      expect(canWriteSellerSettlementAccount(role)).toBe(
        expected[role].includes('SELLER_SETTLEMENT_ACCOUNT_WRITE'),
      );
      expect(canManageSellerMembers(role)).toBe(
        expected[role].includes('SELLER_MEMBER_MANAGE'),
      );
      expect(canReadSellerSettlementFinancials(role)).toBe(
        expected[role].includes('SELLER_SETTLEMENT_FINANCIAL_READ'),
      );
    }
  });

  it('fails closed for an unknown runtime role', () => {
    const unknown = 'ADMIN' as never;
    expect(sellerMemberCapabilities(unknown)).toEqual([]);
    expect(canWriteSellerOperations(unknown)).toBe(false);
    expect(canCreateSellerStore(unknown)).toBe(false);
    expect(canWriteSellerSettlementAccount(unknown)).toBe(false);
    expect(canManageSellerMembers(unknown)).toBe(false);
    expect(canReadSellerSettlementFinancials(unknown)).toBe(false);
  });
});
