import { describe, expect, it } from 'vitest';
import { marketplaceLabel, paymentChannelLabel, reviewTypeLabel } from './status';

describe('Buyer display labels', () => {
  it('translates returned marketplace, review, and payment-channel values', () => {
    expect(marketplaceLabel('AMAZON_JP')).toBe('日本站');
    expect(marketplaceLabel('AMAZON_US')).toBe('美国站');
    // Retired preparation codes pass through untranslated.
    expect(marketplaceLabel('RAKUTEN_JP')).toBe('RAKUTEN_JP');
    expect(marketplaceLabel('TIKTOK_JP')).toBe('TIKTOK_JP');
    expect(reviewTypeLabel('IMAGE')).toBe('图片评论');
    expect(paymentChannelLabel('WECHAT_PAY')).toBe('微信支付');
  });

  it('does not invent a label for an unknown value', () => {
    expect(marketplaceLabel('UNKNOWN')).toBe('UNKNOWN');
    expect(paymentChannelLabel('UNKNOWN')).toBe('UNKNOWN');
  });
});
