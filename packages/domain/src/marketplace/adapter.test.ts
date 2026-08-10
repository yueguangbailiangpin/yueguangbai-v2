import { describe, expect, it } from 'vitest';
import {
  MarketplaceAdapterError,
  normalizePlatformIdentifier,
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

  it.each([
    'RAKUTEN_JP_ORDER',
    'TIKTOK_JP_HISTORICAL_585_18_DIGIT',
  ] as const)('rejects non-Amazon profile %s for Amazon', (profile) => {
    expect(() => normalizePlatformIdentifier(
      'AMAZON_JP', 'ORDER', '123-4567890-1234567', profile,
    )).toThrow('PLATFORM_IDENTIFIER_PROFILE_MISMATCH');
  });

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

  it('validates the known Rakuten order shape without using Amazon rules', () => {
    expect(normalizePlatformIdentifier(
      'RAKUTEN_JP', 'ORDER', ' 123456-20260810-0000000001 ',
      'RAKUTEN_JP_ORDER',
    )).toBe('123456-20260810-0000000001');
    expect(() => normalizePlatformIdentifier(
      'RAKUTEN_JP', 'ORDER', '123-4567890-1234567',
      'RAKUTEN_JP_ORDER',
    )).toThrow('PLATFORM_IDENTIFIER_PROFILE_MISMATCH');
  });

  it('preserves Rakuten R-1/S-1 product identifiers without ASIN rules', () => {
    for (const identifier of ['R-1', 'S-1']) {
      expect(normalizePlatformIdentifier(
        'RAKUTEN_JP', 'PRODUCT', identifier,
      )).toBe(identifier);
      expect(() => normalizePlatformIdentifier(
        'AMAZON_JP', 'PRODUCT', identifier,
      )).toThrow('PLATFORM_IDENTIFIER_PROFILE_MISMATCH');
    }
  });

  it('keeps the TikTok historical profile opt-in', () => {
    expect(normalizePlatformIdentifier(
      'TIKTOK_JP', 'ORDER', '585123456789012345',
    )).toBe('585123456789012345');
    expect(normalizePlatformIdentifier(
      'TIKTOK_JP', 'PRODUCT', 'tiktokDLP2555Q',
    )).toBe('tiktokDLP2555Q');
    expect(() => normalizePlatformIdentifier(
      'TIKTOK_JP', 'ORDER', '712345678901234567',
      'TIKTOK_JP_HISTORICAL_585_18_DIGIT',
    )).toThrow('PLATFORM_IDENTIFIER_PROFILE_MISMATCH');
  });

  it('rejects generic control characters locally', () => {
    for (const value of [
      'order\u0001id', '\torder-id', 'order-id\n',
      'order\u0085id', 'order\u009fid',
    ]) {
      expect(() => normalizePlatformIdentifier(
        'TIKTOK_JP', 'ORDER', value,
      )).toThrow('PLATFORM_IDENTIFIER_CONTROL_CHARACTER');
    }
  });
});
