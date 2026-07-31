import { describe, expect, it } from 'vitest';
import {
  normalizeStoreName,
  StoreNameError,
} from './store-name';

describe('seller store name normalization', () => {
  it('uses NFKC, trims, collapses whitespace, and compares case-insensitively', () => {
    expect(normalizeStoreName('  Ｍｏｏｎ   Store  ')).toEqual({
      display: 'Moon Store',
      normalized: 'moon store',
    });
  });

  it('keeps Chinese names and rejects empty/control values', () => {
    expect(normalizeStoreName('月光白旗舰店')).toEqual({
      display: '月光白旗舰店',
      normalized: '月光白旗舰店',
    });
    expect(() => normalizeStoreName('   '))
      .toThrow(StoreNameError);
    expect(() => normalizeStoreName('店铺\n名称'))
      .toThrow(StoreNameError);
  });
});
