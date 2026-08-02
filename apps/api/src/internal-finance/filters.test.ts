import { describe, expect, it } from 'vitest';
import {
  assertExactQueryParameters,
  normalizeFinanceFilters,
  normalizeFinanceQuery,
} from './filters';

const NOW = Date.UTC(2026, 7, 2, 4, 0, 0);

describe('Wave 12 financial filter normalization', () => {
  it('requires an explicit date basis while defaulting only the date range', () => {
    expect(() => normalizeFinanceQuery(
      new URL('https://example.test/api/staff/finance/summary'),
      NOW,
    )).toThrow('VALIDATION_ERROR');

    const result = normalizeFinanceQuery(new URL(
      'https://example.test/api/staff/finance/summary?date_basis=CONFIRMED',
    ), NOW);
    expect(result).toMatchObject({
      from_date: '2026-07-04',
      to_date: '2026-08-02',
      date_basis: 'CONFIRMED',
    });
  });

  it('rejects duplicate and unknown query parameters', () => {
    expect(() => assertExactQueryParameters(new URL(
      'https://example.test/path?date_basis=CASH&date_basis=CASH',
    ), ['date_basis'])).toThrow('VALIDATION_ERROR');
    expect(() => assertExactQueryParameters(new URL(
      'https://example.test/path?date_basis=CASH&scope=GLOBAL',
    ), ['date_basis'])).toThrow('VALIDATION_ERROR');
  });

  it('rejects reversed or overlong date ranges', () => {
    expect(() => normalizeFinanceFilters({
      date_basis: 'APPROVED',
      from_date: '2026-08-02',
      to_date: '2026-08-01',
    }, NOW)).toThrow('VALIDATION_ERROR');
    expect(() => normalizeFinanceFilters({
      date_basis: 'APPROVED',
      from_date: '2010-01-01',
      to_date: '2026-08-01',
    }, NOW)).toThrow('VALIDATION_ERROR');
  });

  it('normalizes ASIN and Amazon order number with repository rules', () => {
    const result = normalizeFinanceFilters({
      date_basis: 'CONFIRMED',
      asin: ' b000000001 ',
      amazon_order_number: '123-1234567-1234567',
    }, NOW);
    expect(result.asin).toBe('B000000001');
    expect(result.amazon_order_number).toBe('123-1234567-1234567');
  });

  it('rejects a second date basis inside export filters', () => {
    expect(() => normalizeFinanceFilters({
      date_basis: 'APPROVED',
    }, NOW, 'CASH')).toThrow('VALIDATION_ERROR');

    expect(normalizeFinanceFilters({
      seller_organization_id: 'seller-1',
    }, NOW, 'CASH')).toMatchObject({
      date_basis: 'CASH',
      seller_organization_id: 'seller-1',
    });
  });
});
