export const MARKETPLACE_CODES = [
  'AMAZON_JP',
  'AMAZON_US',
  'COUPANG_KR',
  'RAKUTEN_JP',
  'YAHOO_JP',
  'TEMU_JP',
  'TIKTOK_JP',
] as const;
export type CanonicalMarketplaceCode = typeof MARKETPLACE_CODES[number];

export const BUYER_SUPPORTED_MARKETPLACE_CODES = [
  'AMAZON_JP',
  'AMAZON_US',
  'COUPANG_KR',
  'RAKUTEN_JP',
  'YAHOO_JP',
  'TEMU_JP',
  'TIKTOK_JP',
] as const;
export type BuyerSupportedMarketplaceCode =
  typeof BUYER_SUPPORTED_MARKETPLACE_CODES[number];

export const MARKETPLACE_DISPLAY_NAMES_ZH = {
  AMAZON_JP: '亚马逊日本站',
  AMAZON_US: '亚马逊美国站',
  COUPANG_KR: 'Coupang 韩国站（未开通）',
  RAKUTEN_JP: '乐天日本站',
  YAHOO_JP: '雅虎日本站',
  TEMU_JP: 'TEMU 日本站',
  TIKTOK_JP: 'TikTok 日本站',
} as const satisfies Record<CanonicalMarketplaceCode, string>;

/**
 * Stage 4 canonical contract: runtime API payloads accept exactly the three
 * registry codes. Historical 'AMAZON_JP' short codes exist only in the stage-6
 * historical import mapping layer.
 */
export type MarketplaceCode = CanonicalMarketplaceCode;

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
