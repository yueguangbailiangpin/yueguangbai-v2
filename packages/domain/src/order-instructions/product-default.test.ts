import { describe, expect, it } from 'vitest';
import { normalizeProductVersionFields } from '../catalog/product-version';

const base = {
  productName: '产品',
  searchKeywords: ['关键词一'],
  orderingGuideExpectedAmountJpy: 10_000,
  colorSpecMode: 'MAIN_IMAGE_VARIANT' as const,
  productUrl: null,
  buyerVisibleNotes: null,
  internalNotes: null,
};

describe('product version buyer self-pay default', () => {
  it('keeps omission compatible so the service can inherit the previous default', () => {
    expect(normalizeProductVersionFields(base).defaultBuyerSelfPayBps)
      .toBeUndefined();
  });

  it('accepts a 10 percent integer-bps default', () => {
    expect(normalizeProductVersionFields({
      ...base,
      defaultBuyerSelfPayBps: 1000,
    }).defaultBuyerSelfPayBps).toBe(1000);
  });

  it.each([-1, 10_001, 1.5, Number.NaN])(
    'rejects invalid default bps %p',
    (defaultBuyerSelfPayBps) => {
      expect(() => normalizeProductVersionFields({
        ...base,
        defaultBuyerSelfPayBps,
      })).toThrow('invalid_default_buyer_self_pay_bps');
    },
  );
});
