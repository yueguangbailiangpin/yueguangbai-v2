import { describe, expect, it } from 'vitest';
import {
  MarketplaceAdapterError,
  normalizePlatformIdentifiers,
} from './adapter';

describe('marketplace adapters', () => {
  it.each(['AMAZON_JP', 'AMAZON_US'] as const)(
    'normalizes Amazon identifiers for %s',
    (marketplace) => {
      expect(normalizePlatformIdentifiers(marketplace, {
        orderIdentifier: ' 123 - 4567890 - 1234567 ',
        productIdentifier: ' b012345678 ',
      })).toEqual({
        platform_order_identifier: '123-4567890-1234567',
        platform_product_identifier: 'B012345678',
      });
    },
  );

  it('fails closed for reserved Coupang rules', () => {
    expect(() => normalizePlatformIdentifiers('COUPANG_KR', {
      orderIdentifier: 'invented', productIdentifier: 'invented',
    })).toThrow(MarketplaceAdapterError);
    try {
      normalizePlatformIdentifiers('COUPANG_KR', {
        orderIdentifier: 'invented', productIdentifier: 'invented',
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'MARKETPLACE_ADAPTER_UNAVAILABLE',
      });
    }
  });
});
