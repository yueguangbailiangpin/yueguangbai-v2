import { describe, expect, it } from 'vitest';
import {
  normalizeProductVersionFields,
  ProductVersionFieldsError,
} from './product-version';

function valid(overrides: Record<string, unknown> = {}) {
  return {
    productName: '产品',
    searchKeywords: ['关键词一'],
    orderingGuideExpectedAmountJpy: 1980,
    colorSpecMode: 'MAIN_IMAGE_VARIANT' as const,
    productUrl: null,
    buyerVisibleNotes: null,
    internalNotes: null,
    ...overrides,
  };
}

describe('product version fields', () => {
  it('preserves keyword order and duplicates while normalizing text', () => {
    expect(normalizeProductVersionFields(valid({
      productName: '  月光   台灯 ',
      searchKeywords: [' 台灯 ', '台灯', '阅读灯'],
      productUrl: 'https://www.amazon.co.jp/example#reviews',
      buyerVisibleNotes: '  买家可见说明  ',
      internalNotes: '  内部说明  ',
    }))).toEqual({
      productName: '月光 台灯',
      searchKeywords: ['台灯', '台灯', '阅读灯'],
      orderingGuideExpectedAmountJpy: 1980,
      colorSpecMode: 'MAIN_IMAGE_VARIANT',
      productUrl: 'https://www.amazon.co.jp/example',
      buyerVisibleNotes: '买家可见说明',
      internalNotes: '内部说明',
    });
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '1980',
  ])('rejects invalid expected JPY amount %p', (amount) => {
    expect(() => normalizeProductVersionFields(valid({
      orderingGuideExpectedAmountJpy: amount,
    }) as never)).toThrow(
      'invalid_ordering_guide_expected_amount_jpy',
    );
  });

  it.each([
    'MAIN_IMAGE_VARIANT',
    'ANY_VARIANT',
  ])('accepts color mode %s', (mode) => {
    expect(normalizeProductVersionFields(valid({
      colorSpecMode: mode,
    }) as never).colorSpecMode).toBe(mode);
  });

  it.each([
    '',
    'SPECIFIC_VARIANT',
    'FREE_TEXT',
    null,
  ])('rejects color mode %p', (mode) => {
    expect(() => normalizeProductVersionFields(valid({
      colorSpecMode: mode,
    }) as never)).toThrow('invalid_color_spec_mode');
  });

  it('rejects unsafe or excessive values', () => {
    expect(() => normalizeProductVersionFields(valid({
      productName: '',
    }) as never)).toThrow(ProductVersionFieldsError);

    expect(() => normalizeProductVersionFields(valid({
      searchKeywords: Array.from(
        { length: 21 },
        (_, index) => `关键词${index}`,
      ),
    }) as never)).toThrow('too_many_search_keywords');

    expect(() => normalizeProductVersionFields(valid({
      searchKeywords: ['合法', ''],
    }) as never)).toThrow('invalid_search_keyword');

    expect(() => normalizeProductVersionFields(valid({
      searchKeywords: ['合法', '控制\u0001字符'],
    }) as never)).toThrow('invalid_search_keyword');
  });
});
