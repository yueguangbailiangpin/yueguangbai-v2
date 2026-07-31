import { describe, expect, it } from 'vitest';
import {
  normalizeWechatId,
  WechatIdError,
} from './wechat-id';

describe('WeChat identity normalization', () => {
  it('uses NFKC, trims edges, and compares case-insensitively', () => {
    expect(normalizeWechatId('  ＹＧＢ_Test-01  ')).toEqual({
      display: 'YGB_Test-01',
      normalized: 'ygb_test-01',
    });
  });

  it('allows Chinese display identifiers but rejects whitespace and controls', () => {
    expect(normalizeWechatId('月光白客服01')).toEqual({
      display: '月光白客服01',
      normalized: '月光白客服01',
    });

    expect(() => normalizeWechatId('ab')).toThrow(WechatIdError);
    expect(() => normalizeWechatId('abc def')).toThrow(WechatIdError);
    expect(() => normalizeWechatId('abc\n123')).toThrow(WechatIdError);
  });
});
