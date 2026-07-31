export const MARKETPLACE_CODES = ['JP'] as const;
export type MarketplaceCode = typeof MARKETPLACE_CODES[number];

export const CUSTOMER_IDENTITY_SUBJECT_TYPES = [
  'BUYER_CUSTOMER',
  'SELLER_ORG_MEMBER',
] as const;
export type CustomerIdentitySubjectType =
  typeof CUSTOMER_IDENTITY_SUBJECT_TYPES[number];

export const WECHAT_CLAIM_STATUSES = [
  'ACTIVE',
  'RESERVED',
  'RELEASED',
] as const;
export type WechatClaimStatus = typeof WECHAT_CLAIM_STATUSES[number];

export const CUSTOMER_ACCESS_STATUSES = [
  'DISABLED',
  'ACTIVE',
] as const;
export type CustomerAccessStatus =
  typeof CUSTOMER_ACCESS_STATUSES[number];

export const CUSTOMER_IDENTITY_REVIEW_STATUSES = [
  'CLEAR',
  'REVIEW_REQUIRED',
] as const;
export type CustomerIdentityReviewStatus =
  typeof CUSTOMER_IDENTITY_REVIEW_STATUSES[number];

export const SELLER_MEMBER_ROLES = [
  'OWNER',
  'OPERATIONS',
  'FINANCE',
  'VIEWER',
] as const;
export type SellerMemberRole = typeof SELLER_MEMBER_ROLES[number];

export function isMarketplaceCode(
  value: unknown,
): value is MarketplaceCode {
  return typeof value === 'string'
    && (MARKETPLACE_CODES as readonly string[]).includes(value);
}

export function isSellerMemberRole(
  value: unknown,
): value is SellerMemberRole {
  return typeof value === 'string'
    && (SELLER_MEMBER_ROLES as readonly string[]).includes(value);
}
