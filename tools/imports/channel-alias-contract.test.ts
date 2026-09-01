import { describe, expect, it } from 'vitest';
import { CHANNEL_ALIASES as sellerPartnerAliases, validateMarketplaceIdentifier } from './seller-partner';
import { CHANNEL_ALIASES as currentMappingAliases } from './current-product-seller-mapping';

// Owner ruling 2026-09-01 (incl. the same-day follow-up): yueguangbai
// (月光白) is the same account as ygbceping and folds into it, while
// yueguangbaiai (月光白AI) stays a separate account that no alias may fold
// into; dio/idomango/ygc/ygcceping are confirmed input aliases; the
// yinghua1942 and quesheng merges are confirmed.
describe('channel alias contract (Owner ruling 2026-09-01)', () => {
  it.each([
    ['seller-partner', sellerPartnerAliases],
    ['current-product-seller-mapping', currentMappingAliases],
  ] as const)('%s table folds yueguangbai into ygbceping and keeps yueguangbaiai separate', (_name, aliases) => {
    expect(aliases.yueguangbai).toBe('ygbceping');
    expect(aliases.yueguangbaiai).toBe('yueguangbaiai');
    expect(aliases.yueguangbaiai).not.toBe('ygbceping');
  });

  it.each([
    ['seller-partner', sellerPartnerAliases],
    ['current-product-seller-mapping', currentMappingAliases],
  ] as const)('%s table resolves the confirmed input aliases', (_name, aliases) => {
    expect(aliases.idomango).toBe('ido-mango');
    expect(aliases.dio).toBe('ido-mango');
    expect(aliases.ygc).toBe('ygbceping');
    expect(aliases.ygcceping).toBe('ygbceping');
    expect(aliases.yinghua1942ai).toBe('yinghua1942');
    expect(aliases.quesheng520ai).toBe('queshengai');
  });

  it('maps the yuegungbai typo to the ygbceping principal, not yueguangbaiai', () => {
    expect(currentMappingAliases.yuegungbai).toBe('ygbceping');
  });

  it('keeps yueguangbai out of the canonical target set and yueguangbaiai isolated', () => {
    for (const aliases of [sellerPartnerAliases, currentMappingAliases] as const) {
      const targets = new Set<string>(Object.values(aliases));
      expect(targets.has('yueguangbai')).toBe(false);
      expect(targets.has('yueguangbaiai')).toBe(true);
      for (const [alias, target] of Object.entries(aliases)) {
        if (alias === 'yueguangbaiai') continue;
        expect(target, `alias ${alias}`).not.toBe('yueguangbaiai');
      }
    }
  });
});

describe('marketplace identifier validation (D-059)', () => {
  it('validates Amazon ASINs', () => {
    expect(validateMarketplaceIdentifier('AMAZON_JP', 'B0ABC12345')).toBe('FORMAT_VALID');
    expect(validateMarketplaceIdentifier('AMAZON_JP', 'not-an-asin')).toBe('IDENTIFIER_REVIEW_REQUIRED');
  });
  it('validates Rakuten product numbers against the archive-recognized set', () => {
    expect(validateMarketplaceIdentifier('RAKUTEN_JP', 'R-1')).toBe('FORMAT_VALID');
    expect(validateMarketplaceIdentifier('RAKUTEN_JP', 'S-1')).toBe('FORMAT_VALID');
    expect(validateMarketplaceIdentifier('RAKUTEN_JP', 'DLP5713C')).toBe('IDENTIFIER_REVIEW_REQUIRED');
  });
  it('validates Yahoo 13-digit JAN codes with EAN-13 checksum', () => {
    expect(validateMarketplaceIdentifier('YAHOO_JP', '4571504490230')).toBe('FORMAT_VALID');
    expect(validateMarketplaceIdentifier('YAHOO_JP', '4571504490193')).toBe('FORMAT_VALID');
    expect(validateMarketplaceIdentifier('YAHOO_JP', '4571504490231')).toBe('IDENTIFIER_REVIEW_REQUIRED');
    expect(validateMarketplaceIdentifier('YAHOO_JP', '4571504193')).toBe('IDENTIFIER_REVIEW_REQUIRED');
  });
  it('validates TEMU product IDs', () => {
    expect(validateMarketplaceIdentifier('TEMU_JP', 'FX281259')).toBe('FORMAT_VALID');
    expect(validateMarketplaceIdentifier('TEMU_JP', 'invalid')).toBe('IDENTIFIER_REVIEW_REQUIRED');
  });
  it('keeps TikTok and COUPANG_KR fail-closed', () => {
    expect(validateMarketplaceIdentifier('TIKTOK_JP', 'anything')).toBe('IDENTIFIER_REVIEW_REQUIRED');
    expect(validateMarketplaceIdentifier('COUPANG_KR', 'anything')).toBe('IDENTIFIER_REVIEW_REQUIRED');
  });
});
