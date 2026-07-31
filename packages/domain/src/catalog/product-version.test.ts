import { describe, expect, it } from 'vitest';
import {
  normalizeProductVersionFields,
  ProductVersionFieldsError,
} from './product-version';

describe('product version fields', () => {
  it('normalizes names, deduplicates keywords, and strips URL fragments', () => {
    expect(normalizeProductVersionFields({
      productName: '  月光   台灯 ',
      searchKeywords: [' 台灯 ', '台灯', '阅读灯'],
      productUrl: 'https://www.amazon.co.jp/example#reviews',
      buyerVisibleNotes: '  买家可见说明  ',
      internalNotes: '  内部说明  ',
    })).toEqual({
      productName: '月光 台灯',
      searchKeywords: ['台灯', '阅读灯'],
      productUrl: 'https://www.amazon.co.jp/example',
      buyerVisibleNotes: '买家可见说明',
      internalNotes: '内部说明',
    });
  });

  it('rejects unsafe or excessive values', () => {
    expect(() => normalizeProductVersionFields({
      productName: '',
      searchKeywords: [],
      productUrl: null,
      buyerVisibleNotes: null,
      internalNotes: null,
    })).toThrow(ProductVersionFieldsError);

    expect(() => normalizeProductVersionFields({
      productName: '产品',
      searchKeywords: Array.from(
        { length: 21 },
        (_, index) => `关键词${index}`,
      ),
      productUrl: null,
      buyerVisibleNotes: null,
      internalNotes: null,
    })).toThrow('too_many_search_keywords');

    expect(() => normalizeProductVersionFields({
      productName: '产品',
      searchKeywords: [],
      productUrl: 'http://example.com/product',
      buyerVisibleNotes: null,
      internalNotes: null,
    })).toThrow('invalid_product_url');
  });
});
