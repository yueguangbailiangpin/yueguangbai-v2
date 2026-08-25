import type { CanonicalMarketplaceCode } from './customer';

export interface MarketplaceRuntimeDefinition {
  marketplace_code: CanonicalMarketplaceCode;
  business_timezone: string;
  reporting_timezone: 'Asia/Shanghai';
  currency_code: 'JPY'|'USD'|'KRW';
  currency_exponent: 0|2;
}

export const MARKETPLACE_RUNTIME_DEFINITIONS = Object.freeze({
  AMAZON_JP: Object.freeze({marketplace_code:'AMAZON_JP',business_timezone:'Asia/Tokyo',reporting_timezone:'Asia/Shanghai',currency_code:'JPY',currency_exponent:0}),
  AMAZON_US: Object.freeze({marketplace_code:'AMAZON_US',business_timezone:'America/Los_Angeles',reporting_timezone:'Asia/Shanghai',currency_code:'USD',currency_exponent:2}),
  COUPANG_KR: Object.freeze({marketplace_code:'COUPANG_KR',business_timezone:'Asia/Seoul',reporting_timezone:'Asia/Shanghai',currency_code:'KRW',currency_exponent:0}),
} as const satisfies Record<CanonicalMarketplaceCode,MarketplaceRuntimeDefinition>);
