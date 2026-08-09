import type { CanonicalMarketplaceCode } from './customer';

export const PLATFORM_IDENTIFIER_PROFILES = [
  'DEFAULT',
  'RAKUTEN_JP_ORDER',
  'TIKTOK_JP_HISTORICAL_585_18_DIGIT',
] as const;
export type PlatformIdentifierProfile =
  typeof PLATFORM_IDENTIFIER_PROFILES[number];

export type PlatformIdentifierKind = 'ORDER' | 'PRODUCT';

export interface PlatformIdentifierInput {
  marketplace_code: CanonicalMarketplaceCode;
  kind: PlatformIdentifierKind;
  value: string;
  profile?: PlatformIdentifierProfile;
}

export interface NormalizedPlatformIdentifier {
  marketplace_code: CanonicalMarketplaceCode;
  kind: PlatformIdentifierKind;
  value: string;
  profile: PlatformIdentifierProfile;
}

export const PLATFORM_IDENTIFIER_ERROR_CODES = [
  'PLATFORM_IDENTIFIER_EMPTY',
  'PLATFORM_IDENTIFIER_CONTROL_CHARACTER',
  'PLATFORM_IDENTIFIER_TOO_LONG',
  'PLATFORM_IDENTIFIER_PROFILE_MISMATCH',
  'PLATFORM_IDENTIFIER_PROFILE_UNSUPPORTED',
] as const;
export type PlatformIdentifierErrorCode =
  typeof PLATFORM_IDENTIFIER_ERROR_CODES[number];
