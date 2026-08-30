import type { SellerMemberRole } from '@ygb/contracts';

/**
 * Seller member capabilities are role semantics only. Session validity,
 * membership status, organization scope, and endpoint-specific state checks
 * remain the responsibility of the caller.
 */
export type SellerMemberCapability =
  | 'SELLER_OPERATIONS_WRITE'
  | 'SELLER_STORE_CREATE'
  | 'SELLER_SETTLEMENT_ACCOUNT_WRITE'
  | 'SELLER_MEMBER_MANAGE'
  | 'SELLER_SETTLEMENT_FINANCIAL_READ';

const EMPTY_CAPABILITIES: readonly SellerMemberCapability[] = Object.freeze([]);

const CAPABILITIES_BY_ROLE: Readonly<
  Record<SellerMemberRole, readonly SellerMemberCapability[]>
> = Object.freeze({
  OWNER: capabilityList(
    'SELLER_OPERATIONS_WRITE',
    'SELLER_STORE_CREATE',
    'SELLER_SETTLEMENT_ACCOUNT_WRITE',
    'SELLER_MEMBER_MANAGE',
    'SELLER_SETTLEMENT_FINANCIAL_READ',
  ),
  OPERATIONS: capabilityList(
    'SELLER_OPERATIONS_WRITE',
    'SELLER_STORE_CREATE',
    'SELLER_SETTLEMENT_ACCOUNT_WRITE',
  ),
  FINANCE: capabilityList(
    'SELLER_STORE_CREATE',
    'SELLER_SETTLEMENT_ACCOUNT_WRITE',
    'SELLER_SETTLEMENT_FINANCIAL_READ',
  ),
  VIEWER: capabilityList(
    'SELLER_STORE_CREATE',
  ),
});

function capabilityList(
  ...capabilities: SellerMemberCapability[]
): readonly SellerMemberCapability[] {
  return Object.freeze(capabilities);
}

export function sellerMemberCapabilities(
  role: SellerMemberRole,
): readonly SellerMemberCapability[] {
  return CAPABILITIES_BY_ROLE[role] ?? EMPTY_CAPABILITIES;
}

export function sellerMemberCan(
  role: SellerMemberRole,
  capability: SellerMemberCapability,
): boolean {
  return sellerMemberCapabilities(role).includes(capability);
}

export function canWriteSellerOperations(role: SellerMemberRole): boolean {
  return sellerMemberCan(role, 'SELLER_OPERATIONS_WRITE');
}

export function canCreateSellerStore(role: SellerMemberRole): boolean {
  return sellerMemberCan(role, 'SELLER_STORE_CREATE');
}

export function canWriteSellerSettlementAccount(
  role: SellerMemberRole,
): boolean {
  return sellerMemberCan(role, 'SELLER_SETTLEMENT_ACCOUNT_WRITE');
}

export function canManageSellerMembers(role: SellerMemberRole): boolean {
  return sellerMemberCan(role, 'SELLER_MEMBER_MANAGE');
}

export function canReadSellerSettlementFinancials(
  role: SellerMemberRole,
): boolean {
  return sellerMemberCan(role, 'SELLER_SETTLEMENT_FINANCIAL_READ');
}
