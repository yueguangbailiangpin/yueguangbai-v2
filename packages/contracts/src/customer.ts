export const MARKETPLACE_CODES = [
  'AMAZON_JP',
  'AMAZON_US',
  'COUPANG_KR',
  'RAKUTEN_JP',
  'TIKTOK_JP',
] as const;
export type CanonicalMarketplaceCode = typeof MARKETPLACE_CODES[number];

export const BUYER_SUPPORTED_MARKETPLACE_CODES = [
  'AMAZON_JP',
  'AMAZON_US',
  'COUPANG_KR',
] as const;
export type BuyerSupportedMarketplaceCode =
  typeof BUYER_SUPPORTED_MARKETPLACE_CODES[number];

export const MARKETPLACE_DISPLAY_NAMES_ZH = {
  AMAZON_JP: '亚马逊日本站',
  AMAZON_US: '亚马逊美国站',
  COUPANG_KR: 'Coupang 韩国站（未开通）',
  RAKUTEN_JP: '乐天日本站',
  TIKTOK_JP: 'TikTok 日本站',
} as const satisfies Record<CanonicalMarketplaceCode, string>;

/** Existing JP HTTP payloads remain accepted during the compatibility window. */
export const LEGACY_MARKETPLACE_CODES = ['JP'] as const;
export type LegacyMarketplaceCode = typeof LEGACY_MARKETPLACE_CODES[number];
export type MarketplaceCode =
  | CanonicalMarketplaceCode
  | LegacyMarketplaceCode;

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
    && [
      ...MARKETPLACE_CODES,
      ...LEGACY_MARKETPLACE_CODES,
    ].includes(value as CanonicalMarketplaceCode);
}

export function isCanonicalMarketplaceCode(
  value: unknown,
): value is CanonicalMarketplaceCode {
  return typeof value === 'string'
    && (MARKETPLACE_CODES as readonly string[]).includes(value);
}

export function isBuyerSupportedMarketplaceCode(
  value: unknown,
): value is BuyerSupportedMarketplaceCode {
  return typeof value === 'string'
    && (BUYER_SUPPORTED_MARKETPLACE_CODES as readonly string[]).includes(value);
}

export function isSellerMemberRole(
  value: unknown,
): value is SellerMemberRole {
  return typeof value === 'string'
    && (SELLER_MEMBER_ROLES as readonly string[]).includes(value);
}
