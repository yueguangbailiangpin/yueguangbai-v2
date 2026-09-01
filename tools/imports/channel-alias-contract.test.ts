import { describe, expect, it } from 'vitest';
import { CHANNEL_ALIASES as sellerPartnerAliases } from './seller-partner';
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
