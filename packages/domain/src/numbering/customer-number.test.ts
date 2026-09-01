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

  it('pads the first buyer sequence to 4 digits (T9-DEFECT-001 regression gate)', () => {
    // On a fresh database the first buyer gets sequence=1; without padding
    // the number '20260901B1' is only 10 chars and violates the
    // CHECK(length BETWEEN 13 AND 20) constraint on buyer_customers.
    const first = formatBuyerCustomerNumber({
      businessDate: '2026-09-01',
      channelCode: 'B',
      sequence: 1,
    });
    expect(first).toBe('20260901B0001');
    expect(first.length).toBeGreaterThanOrEqual(13);

    // Sequence 9999 stays at 4 digits; 10000 grows naturally.
    expect(formatBuyerCustomerNumber({
      businessDate: '2026-09-01',
      channelCode: 'B',
      sequence: 9999,
    })).toBe('20260901B9999');
    expect(formatBuyerCustomerNumber({
      businessDate: '2026-09-01',
      channelCode: 'B',
      sequence: 10000,
    })).toBe('20260901B10000');
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
