import {
  MARKETPLACE_RUNTIME_DEFINITIONS,
  type CanonicalMarketplaceCode,
  type MarketplaceCode,
  type MarketplaceRuntimeDefinition,
} from '@ygb/contracts';

export function canonicalMarketplaceCode(value: MarketplaceCode|string): CanonicalMarketplaceCode {
  if (value in MARKETPLACE_RUNTIME_DEFINITIONS) return value as CanonicalMarketplaceCode;
  if (value==='JP') return 'AMAZON_JP';
  if (value==='US') return 'AMAZON_US';
  if (value==='KR') return 'COUPANG_KR';
  throw new Error('unsupported_marketplace_code');
}

export function marketplaceRuntime(value: MarketplaceCode|string): MarketplaceRuntimeDefinition {
  return MARKETPLACE_RUNTIME_DEFINITIONS[canonicalMarketplaceCode(value)];
}

export function legacyOrderMarketplaceCode(value: MarketplaceCode|string): string {
  return marketplaceRuntime(value).legacy_order_code;
}

export function marketplaceBusinessDate(value: MarketplaceCode|string, epochMs:number): string {
  if(!Number.isSafeInteger(epochMs)||epochMs<0)throw new Error('invalid_marketplace_timestamp');
  const zone=marketplaceRuntime(value).business_timezone;
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(new Date(epochMs));
  const read=(type:'year'|'month'|'day')=>parts.find((part)=>part.type===type)?.value;
  const year=read('year'),month=read('month'),day=read('day');
  if(!year||!month||!day)throw new Error('invalid_marketplace_business_date');
  return `${year}-${month}-${day}`;
}
