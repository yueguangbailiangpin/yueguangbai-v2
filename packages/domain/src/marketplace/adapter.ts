import type {
  CanonicalMarketplaceCode,
  MarketplaceAdapterErrorCode,
  PlatformIdentifierErrorCode,
  PlatformIdentifierKind,
  PlatformIdentifierProfile,
} from '@ygb/contracts';
import { normalizeAmazonOrderNumber } from '../identity/amazon-order-number';
import { normalizeAsin } from '../identity/asin';

export class MarketplaceAdapterError extends Error {
  constructor(public readonly code: MarketplaceAdapterErrorCode) {
    super(code);
    this.name = 'MarketplaceAdapterError';
  }
}

export class PlatformIdentifierValidationError extends Error {
  constructor(public readonly code: PlatformIdentifierErrorCode) {
    super(code);
    this.name = 'PlatformIdentifierValidationError';
  }
}

export interface PlatformIdentifiers {
  platform_order_identifier: string;
  platform_product_identifier: string;
}

export function normalizePlatformIdentifier(
  marketplaceCode: CanonicalMarketplaceCode,
  kind: PlatformIdentifierKind,
  raw: string,
  profile: PlatformIdentifierProfile = 'DEFAULT',
): string {
  if (profile !== 'DEFAULT'
    && profile !== 'RAKUTEN_JP_ORDER'
    && profile !== 'TIKTOK_JP_HISTORICAL_585_18_DIGIT') {
    throw new PlatformIdentifierValidationError(
      'PLATFORM_IDENTIFIER_PROFILE_UNSUPPORTED',
    );
  }
  if (marketplaceCode === 'AMAZON_JP' || marketplaceCode === 'AMAZON_US') {
    if (profile !== 'DEFAULT') {
      throw new PlatformIdentifierValidationError(
        'PLATFORM_IDENTIFIER_PROFILE_MISMATCH',
      );
    }
    try {
      return kind === 'ORDER'
        ? normalizeAmazonOrderNumber(raw)
        : normalizeAsin(raw);
    } catch {
      throw new PlatformIdentifierValidationError(
        'PLATFORM_IDENTIFIER_PROFILE_MISMATCH',
      );
    }
  }

  const normalized = normalizeGenericIdentifier(raw);
  if (profile === 'RAKUTEN_JP_ORDER') {
    if (marketplaceCode !== 'RAKUTEN_JP' || kind !== 'ORDER'
      || !/^\d{6}-\d{8}-\d{10}$/u.test(normalized)) {
      throw new PlatformIdentifierValidationError(
        'PLATFORM_IDENTIFIER_PROFILE_MISMATCH',
      );
    }
  }
  if (profile === 'TIKTOK_JP_HISTORICAL_585_18_DIGIT') {
    if (marketplaceCode !== 'TIKTOK_JP' || kind !== 'ORDER'
      || !/^585\d{15}$/u.test(normalized)) {
      throw new PlatformIdentifierValidationError(
        'PLATFORM_IDENTIFIER_PROFILE_MISMATCH',
      );
    }
  }
  return normalized;
}

export function normalizePlatformIdentifiers(
  marketplaceCode: CanonicalMarketplaceCode,
  input: {
    orderIdentifier: string;
    productIdentifier: string;
    orderProfile?: PlatformIdentifierProfile;
    productProfile?: PlatformIdentifierProfile;
  },
): PlatformIdentifiers {
  if (marketplaceCode === 'COUPANG_KR') {
    throw new MarketplaceAdapterError('MARKETPLACE_ADAPTER_UNAVAILABLE');
  }
  try {
    return {
      platform_order_identifier: normalizePlatformIdentifier(
        marketplaceCode,
        'ORDER',
        input.orderIdentifier,
        input.orderProfile
          ?? (marketplaceCode === 'RAKUTEN_JP'
            ? 'RAKUTEN_JP_ORDER'
            : 'DEFAULT'),
      ),
      platform_product_identifier: normalizePlatformIdentifier(
        marketplaceCode,
        'PRODUCT',
        input.productIdentifier,
        input.productProfile ?? 'DEFAULT',
      ),
    };
  } catch {
    throw new MarketplaceAdapterError('PLATFORM_IDENTIFIER_INVALID');
  }
}

function normalizeGenericIdentifier(raw: string): string {
  if (typeof raw !== 'string') {
    throw new PlatformIdentifierValidationError('PLATFORM_IDENTIFIER_EMPTY');
  }
  const nfkc = raw.normalize('NFKC');
  if (/[\u0000-\u001F\u007F]/u.test(nfkc)) {
    throw new PlatformIdentifierValidationError(
      'PLATFORM_IDENTIFIER_CONTROL_CHARACTER',
    );
  }
  const normalized = nfkc.trim();
  if (normalized.length === 0) {
    throw new PlatformIdentifierValidationError('PLATFORM_IDENTIFIER_EMPTY');
  }
  if (normalized.length > 200) {
    throw new PlatformIdentifierValidationError('PLATFORM_IDENTIFIER_TOO_LONG');
  }
  return normalized;
}
