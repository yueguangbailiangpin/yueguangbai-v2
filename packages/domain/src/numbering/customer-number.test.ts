import { describe, expect, it } from 'vitest';
import {
  CustomerNumberError,
  formatBuyerCustomerNumber,
  formatSellerCustomerCode,
} from './customer-number';

describe('customer numbering', () => {
  it('formats buyer numbers from business date, channel, and sequence', () => {
    expect(formatBuyerCustomerNumber({
      businessDate: '2026-08-01',
      channelCode: 'b',
      sequence: 3209,
    })).toBe('20260801B3209');
  });

  it('formats seller codes from independent channel prefixes', () => {
    expect(formatSellerCustomerCode({
      prefix: 'IDO-MANGO',
      sequence: 15,
    })).toBe('ido-mango-15');
  });

  it('rejects invalid dates, channels, prefixes, and sequences', () => {
    expect(() => formatBuyerCustomerNumber({
      businessDate: '2026-02-30',
      channelCode: 'B',
      sequence: 1,
    })).toThrow(CustomerNumberError);

    expect(() => formatBuyerCustomerNumber({
      businessDate: '2026-08-01',
      channelCode: 'B-1',
      sequence: 1,
    })).toThrow('invalid_channel_code');

    expect(() => formatSellerCustomerCode({
      prefix: 'invalid prefix',
      sequence: 1,
    })).toThrow('invalid_seller_prefix');

    expect(() => formatSellerCustomerCode({
      prefix: 'ido',
      sequence: 0,
    })).toThrow('invalid_sequence');
  });
});
