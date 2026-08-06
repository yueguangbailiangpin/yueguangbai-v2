import type {
  CanonicalMarketplaceCode,
  MarketplaceAdapterErrorCode,
} from '@ygb/contracts';
import { normalizeAmazonOrderNumber } from '../identity/amazon-order-number';
import { normalizeAsin } from '../identity/asin';

export class MarketplaceAdapterError extends Error {
  constructor(public readonly code: MarketplaceAdapterErrorCode) {
    super(code);
    this.name = 'MarketplaceAdapterError';
  }
}

export interface PlatformIdentifiers {
  platform_order_identifier: string;
  platform_product_identifier: string;
}

export function normalizePlatformIdentifiers(
  marketplaceCode: CanonicalMarketplaceCode,
  input: { orderIdentifier: string; productIdentifier: string },
): PlatformIdentifiers {
  if (marketplaceCode === 'COUPANG_KR') {
    throw new MarketplaceAdapterError('MARKETPLACE_ADAPTER_UNAVAILABLE');
  }
  try {
    return {
      platform_order_identifier: normalizeAmazonOrderNumber(
        input.orderIdentifier,
      ),
      platform_product_identifier: normalizeAsin(input.productIdentifier),
    };
  } catch {
    throw new MarketplaceAdapterError('PLATFORM_IDENTIFIER_INVALID');
  }
}
