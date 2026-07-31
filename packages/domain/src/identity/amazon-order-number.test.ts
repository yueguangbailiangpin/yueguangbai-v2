import { describe, expect, it } from 'vitest';
import {
  AmazonOrderNumberError,
  normalizeAmazonOrderNumber,
} from './amazon-order-number';

describe('Amazon order number normalization', () => {
  it('normalizes full-width characters, spaces, and casing', () => {
    expect(normalizeAmazonOrderNumber(' 123 - 4567890 - 1234567 '))
      .toBe('123-4567890-1234567');
    expect(normalizeAmazonOrderNumber('ａｂｃ－１２３'))
      .toBe('ABC-123');
  });

  it('rejects unsupported characters', () => {
    expect(() => normalizeAmazonOrderNumber('123/456'))
      .toThrow(AmazonOrderNumberError);
  });
});
