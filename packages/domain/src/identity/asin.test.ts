import { describe, expect, it } from 'vitest';
import {
  AsinNormalizationError,
  normalizeAsin,
} from './asin';

describe('ASIN normalization', () => {
  it('normalizes NFKC, whitespace, and casing', () => {
    expect(normalizeAsin('  b0test0001  ')).toBe('B0TEST0001');
    expect(normalizeAsin('Ｂ０ＴＥＳＴ０００１')).toBe('B0TEST0001');
  });

  it('requires exactly ten alphanumeric characters', () => {
    expect(() => normalizeAsin('B0SHORT')).toThrow(
      AsinNormalizationError,
    );
    expect(() => normalizeAsin('B0INVALID!')).toThrow(
      AsinNormalizationError,
    );
  });
});
