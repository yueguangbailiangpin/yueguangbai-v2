import { describe, expect, it } from 'vitest';
import {
  assertCashFinanceDateBasis,
  assertExactQueryParameters,
  assertFinancialExportDateBasis,
  assertOrderFinanceDateBasis,
  normalizeFinanceFilters,
  normalizeFinanceQuery,
} from './filters';

const NOW = Date.UTC(2026, 7, 2, 4, 0, 0);
const ORDER_ENDPOINTS = [
  '/api/staff/finance/summary',
  '/api/staff/finance/orders',
  '/api/staff/finance/groups',
  '/api/staff/finance/exceptions',
] as const;

describe('Wave 12 financial filter normalization', () => {
  it.each(ORDER_ENDPOINTS)('requires date_basis for %s', (path) => {
    expect(() => normalizeFinanceQuery(
      new URL(`https://example.test${path}`),
      NOW,
    )).toThrow('VALIDATION_ERROR');
  });

  it('defaults only the inclusive recent-30-day date range', () => {
    const result = normalizeFinanceQuery(new URL(
      'https://example.test/api/staff/finance/summary?date_basis=CONFIRMED',
    ), NOW);
    expect(result).toMatchObject({
      from_date: '2026-07-04',
      to_date: '2026-08-02',
      date_basis: 'CONFIRMED',
    });
  });

  it.each(['CONFIRMED', 'APPROVED'] as const)(
    'accepts %s for order financial reports',
    (dateBasis) => {
      const filters = normalizeFinanceFilters({ date_basis: dateBasis }, NOW);
      expect(() => assertOrderFinanceDateBasis(filters)).not.toThrow();
    },
  );

  it('rejects CASH for every order financial report basis gate', () => {
    const filters = normalizeFinanceFilters({ date_basis: 'CASH' }, NOW);
    expect(() => assertOrderFinanceDateBasis(filters))
      .toThrow('VALIDATION_ERROR');
  });

  it('requires CASH for cash flow and rejects missing/order bases', () => {
    expect(() => normalizeFinanceQuery(new URL(
      'https://example.test/api/staff/finance/cash-flow',
    ), NOW)).toThrow('VALIDATION_ERROR');

    const cash = normalizeFinanceFilters({ date_basis: 'CASH' }, NOW);
    expect(() => assertCashFinanceDateBasis(cash)).not.toThrow();
    for (const dateBasis of ['CONFIRMED', 'APPROVED'] as const) {
      const filters = normalizeFinanceFilters({ date_basis: dateBasis }, NOW);
      expect(() => assertCashFinanceDateBasis(filters))
        .toThrow('VALIDATION_ERROR');
    }
  });

  it('freezes export date bases by export type', () => {
    for (const exportType of [
      'ORDER_DETAIL',
      'SELLER_SUMMARY',
      'STORE_SUMMARY',
      'PRODUCT_SUMMARY',
      'ASIN_SUMMARY',
      'MONTHLY_SUMMARY',
      'FINANCIAL_EXCEPTIONS',
    ] as const) {
      expect(() => assertFinancialExportDateBasis(exportType, 'CONFIRMED'))
        .not.toThrow();
      expect(() => assertFinancialExportDateBasis(exportType, 'APPROVED'))
        .not.toThrow();
      expect(() => assertFinancialExportDateBasis(exportType, 'CASH'))
        .toThrow('VALIDATION_ERROR');
    }
    expect(() => assertFinancialExportDateBasis('CASH_FLOW', 'CASH'))
      .not.toThrow();
    expect(() => assertFinancialExportDateBasis('CASH_FLOW', 'CONFIRMED'))
      .toThrow('VALIDATION_ERROR');
    expect(() => assertFinancialExportDateBasis('CASH_FLOW', 'APPROVED'))
      .toThrow('VALIDATION_ERROR');
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

  it('accepts the outer export basis and rejects a second filters basis', () => {
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
