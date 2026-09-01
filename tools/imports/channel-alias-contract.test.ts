import { describe, expect, it } from 'vitest';
import { CHANNEL_ALIASES as sellerPartnerAliases } from './seller-partner';
import { CHANNEL_ALIASES as currentMappingAliases } from './current-product-seller-mapping';

// Owner ruling 2026-09-01: the only channel aliases the business confirms.
// yueguangbai and yueguangbaiai are two distinct accounts and must never fold
// into one canonical value; dio/idomango/ygc/ygcceping are confirmed input
// aliases; the yinghua1942 and quesheng merges are confirmed.
describe('channel alias contract (Owner ruling 2026-09-01)', () => {
  it.each([
    ['seller-partner', sellerPartnerAliases],
    ['current-product-seller-mapping', currentMappingAliases],
  ] as const)('%s table keeps the two moonwhite accounts distinct', (_name, aliases) => {
    expect(aliases.yueguangbai).toBe('yueguangbai');
    expect(aliases.yueguangbaiai).toBe('yueguangbaiai');
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

  it('maps the yuegungbai typo to the yueguangbai principal, not yueguangbaiai', () => {
    expect(currentMappingAliases.yuegungbai).toBe('yueguangbai');
  });

  it('exposes no canonical value that folds one moonwhite account into the other', () => {
    for (const aliases of [sellerPartnerAliases, currentMappingAliases] as const) {
      const targets = new Set(Object.values(aliases));
      expect(targets.has('yueguangbai')).toBe(true);
      expect(targets.has('yueguangbaiai')).toBe(true);
      for (const [alias, target] of Object.entries(aliases)) {
        if (alias === 'yueguangbaiai') continue;
        expect(target, `alias ${alias}`).not.toBe('yueguangbaiai');
      }
    }
  });
});
