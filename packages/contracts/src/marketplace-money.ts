import type {
  CanonicalMarketplaceCode,
} from './customer';

export const CURRENCY_CODES = ['JPY', 'USD', 'KRW', 'CNY'] as const;
export type CurrencyCode = typeof CURRENCY_CODES[number];

export const CURRENCY_EXPONENTS = {
  JPY: 0,
  USD: 2,
  KRW: 0,
  CNY: 2,
} as const satisfies Record<CurrencyCode, number>;

export type CurrencyExponent = 0 | 2;
export type MoneyRoundingRule = 'HALF_UP';
export type IntegerString = string;

export const MARKETPLACE_PLATFORMS = ['AMAZON', 'COUPANG'] as const;
export type MarketplacePlatform = typeof MARKETPLACE_PLATFORMS[number];
export type MarketplaceStatus = 'ACTIVE' | 'DISABLED';
export type MarketplaceAdapterStatus = 'AVAILABLE' | 'UNAVAILABLE';

export interface MarketplaceRecord {
  code: CanonicalMarketplaceCode;
  platform_code: MarketplacePlatform;
  region_code: 'JP' | 'US' | 'KR';
  transaction_currency_code: CurrencyCode;
  currency_exponent: CurrencyExponent;
  status: MarketplaceStatus;
  adapter_status: MarketplaceAdapterStatus;
  display_name_zh: string;
}

export interface Money {
  amount_minor: IntegerString;
  currency_code: CurrencyCode;
  currency_exponent: CurrencyExponent;
}

export interface CurrencyRateSnapshot {
  rate_version_id: string;
  source_currency_code: CurrencyCode;
  quote_currency_code: CurrencyCode;
  source_currency_exponent: CurrencyExponent;
  quote_currency_exponent: CurrencyExponent;
  rate_value: IntegerString;
  rate_scale: IntegerString;
  rounding_rule: MoneyRoundingRule;
}

export interface MarketplaceFeeSnapshot {
  fee_rule_version_id: string;
  seller_organization_id: string;
  marketplace_code: CanonicalMarketplaceCode;
  review_type: 'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO';
  fee: Money & { currency_code: 'CNY'; currency_exponent: 2 };
}

export interface FormalOrderMarketplaceMoneySnapshot {
  formal_order_id: string;
  buyer_customer_id: string;
  seller_organization_id: string;
  store_id: string;
  marketplace_code: CanonicalMarketplaceCode;
  review_type: 'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO';
  platform_order_identifier: string;
  platform_product_identifier: string;
  platform_order_date: string | null;
  payment: Money;
  buyer_rate: CurrencyRateSnapshot;
  seller_rate: CurrencyRateSnapshot;
  service_fee: MarketplaceFeeSnapshot;
  buyer_expected_principal: Money & {
    currency_code: 'CNY'; currency_exponent: 2;
  };
  seller_expected_principal: Money & {
    currency_code: 'CNY'; currency_exponent: 2;
  };
  created_at: number;
  replayed: boolean;
}

export interface BuyerMarketplaceCorrectionResult {
  buyer_customer_id: string;
  previous_marketplace_code: CanonicalMarketplaceCode;
  marketplace_code: CanonicalMarketplaceCode;
  version: number;
  corrected_at: number;
  replayed: boolean;
}

export const MARKETPLACE_FOUNDATION_HTTP_PATHS = {
  staffCorrectBuyerMarketplace:
    '/api/staff/buyers/:id/marketplace-correction',
} as const;

export const MARKETPLACE_ADAPTER_ERROR_CODES = [
  'MARKETPLACE_NOT_FOUND',
  'MARKETPLACE_DISABLED',
  'MARKETPLACE_ADAPTER_UNAVAILABLE',
  'PLATFORM_IDENTIFIER_INVALID',
  'MARKETPLACE_CURRENCY_MISMATCH',
] as const;
export type MarketplaceAdapterErrorCode =
  typeof MARKETPLACE_ADAPTER_ERROR_CODES[number];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string'
    && (CURRENCY_CODES as readonly string[]).includes(value);
}

export function currencyExponent(code: CurrencyCode): CurrencyExponent {
  return CURRENCY_EXPONENTS[code];
}

export function isIntegerString(value: unknown): value is IntegerString {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value);
}

export function isMoney(value: unknown): value is Money {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Money>;
  return isIntegerString(candidate.amount_minor)
    && isCurrencyCode(candidate.currency_code)
    && candidate.currency_exponent === currencyExponent(candidate.currency_code);
}

export function assertMoney(value: unknown): asserts value is Money {
  if (!isMoney(value)) throw new Error('invalid_money');
}
