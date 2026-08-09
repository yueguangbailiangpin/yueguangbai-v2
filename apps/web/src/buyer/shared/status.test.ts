import { describe, expect, it } from 'vitest';
import { marketplaceLabel, paymentChannelLabel, reviewTypeLabel } from './status';

describe('Buyer display labels', () => {
  it('translates returned marketplace, review, and payment-channel values', () => {
    expect(marketplaceLabel('JP')).toBe('日本站');
    expect(marketplaceLabel('RAKUTEN_JP')).toBe('乐天日本站（未接入）');
    expect(marketplaceLabel('TIKTOK_JP')).toBe('TikTok 日本站（未接入）');
    expect(reviewTypeLabel('IMAGE')).toBe('图片评论');
    expect(paymentChannelLabel('WECHAT_PAY')).toBe('微信支付');
  });

  it('does not invent a label for an unknown value', () => {
    expect(marketplaceLabel('UNKNOWN')).toBe('UNKNOWN');
    expect(paymentChannelLabel('UNKNOWN')).toBe('UNKNOWN');
  });
});
