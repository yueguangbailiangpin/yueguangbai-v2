import { describe, expect, it } from 'vitest';
import type { InternalFinanceFilters, SqlDatabase } from '@ygb/contracts';
import { buildFinancialExportRows } from './exports';

describe('Wave 12 export output-row limits', () => {
  it('allows 60000 source orders when seller summary has few output groups', async () => {
    const database = generatedDatabase({
      positionCount: 60_000,
      sellerGroupCount: 3,
    });
    const result = await buildFinancialExportRows(
      database,
      'SELLER_SUMMARY',
      orderFilters(),
      1,
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row['order_count']))
      .toEqual([20_000, 20_000, 20_000]);
  });

  it('rejects 50001 order-detail output rows', async () => {
    await expect(buildFinancialExportRows(
      generatedDatabase({ positionCount: 50_001 }),
      'ORDER_DETAIL',
      orderFilters(),
      1,
    )).rejects.toThrow('EXPORT_TOO_LARGE');
  });

  it('allows exception export when source orders exceed 50000 but exceptions do not', async () => {
    const result = await buildFinancialExportRows(
      generatedDatabase({
        positionCount: 60_000,
        exceptionCount: 17,
      }),
      'FINANCIAL_EXCEPTIONS',
      orderFilters(),
      1,
    );
    expect(result.rows).toHaveLength(17);
    expect(result.rows.every((row) => row['finance_status'] === 'AMOUNT_MISMATCH'))
      .toBe(true);
  });

  it('rejects group output only when the final group count exceeds 50000', async () => {
    await expect(buildFinancialExportRows(
      generatedDatabase({
        positionCount: 50_001,
        sellerGroupCount: 50_001,
      }),
      'SELLER_SUMMARY',
      orderFilters(),
      1,
    )).rejects.toThrow('EXPORT_TOO_LARGE');
  });

  it('allows more than 50000 cash source movements because output is one row', async () => {
    const result = await buildFinancialExportRows(
      generatedDatabase({ cashMovementCount: 50_001 }),
      'CASH_FLOW',
      cashFilters(),
      1,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.['seller_cash_inflow_cny_fen']).toBe('50001');
    expect(result.rows[0]?.['buyer_advance_outflow_cny_fen']).toBe('0');
    expect(result.rows[0]?.['buyer_advance_reversal_cny_fen']).toBe('0');
    expect(result.rows[0]?.['net_cash_flow_cny_fen']).toBe('50001');
  });
});

function generatedDatabase(input: {
  positionCount?: number;
  exceptionCount?: number;
  sellerGroupCount?: number;
  cashMovementCount?: number;
}): SqlDatabase {
  const positionCount = input.positionCount ?? 0;
  const exceptionCount = input.exceptionCount ?? 0;
  const sellerGroupCount = input.sellerGroupCount ?? 1;
  const cashMovementCount = input.cashMovementCount ?? 0;
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async all<T>() {
          if (sql.includes('internal_order_finance_positions')) {
            const exceptionOnly = sql.includes(
              "NOT IN ('PROJECTED_ONLY','COMPLETED')",
            );
            const total = exceptionOnly ? exceptionCount : positionCount;
            const hasCursor = sql.includes('position.confirmed_at>?');
            const start = hasCursor ? Number(bindings.at(-4)) : 0;
            const limit = Number(bindings.at(-1));
            const end = Math.min(total, start + limit);
            const rows = Array.from(
              { length: Math.max(0, end - start) },
              (_, offset) => rawPosition(
                start + offset,
                sellerGroupCount,
                exceptionOnly ? 'AMOUNT_MISMATCH' : 'COMPLETED',
              ),
            );
            return { results: rows as unknown as T[] };
          }
          if (sql.includes('internal_finance_cash_movements')) {
            const hasCursor = sql.includes('movement.occurred_at>?');
            const start = hasCursor ? Number(bindings.at(-4)) : 0;
            const limit = Number(bindings.at(-1));
            const end = Math.min(cashMovementCount, start + limit);
            const rows = Array.from(
              { length: Math.max(0, end - start) },
              (_, offset) => {
                const index = start + offset;
                return {
                  occurred_at: index + 1,
                  movement_id: `movement-${String(index).padStart(8, '0')}`,
                  movement_type: 'SELLER_PAYMENT',
                  amount_cny_fen: '1',
                };
              },
            );
            return { results: rows as unknown as T[] };
          }
          if (sql.includes('seller_organization_settlement_balances')) {
            return { results: [] as T[] };
          }
          throw new Error(`unexpected_all:${sql}`);
        },
        async first<T>() {
          if (sql.includes('seller_organization_settlement_balances')) {
            return { value: '0' } as T;
          }
          throw new Error(`unexpected_first:${sql}`);
        },
        async run() {
          throw new Error('unexpected_run');
        },
      };
      return statement;
    },
    async batch() {
      throw new Error('unexpected_batch');
    },
  } as unknown as SqlDatabase;
}

function rawPosition(
  index: number,
  sellerGroupCount: number,
  financeStatus: 'COMPLETED' | 'AMOUNT_MISMATCH',
) {
  const id = String(index).padStart(8, '0');
  const seller = String(index % sellerGroupCount).padStart(8, '0');
  return {
    formal_order_id: `order-${id}`,
    amazon_order_number: '123-1234567-1234567',
    seller_organization_id: `seller-${seller}`,
    store_id: 'store-0',
    product_id: 'product-0',
    asin: 'B000000001',
    product_name: 'Product',
    review_type: 'TEXT',
    confirmed_at: index + 1,
    confirmed_business_date: '2026-08-01',
    review_approved_at: index + 2,
    review_approved_business_date: '2026-08-01',
    last_cash_business_date: '2026-08-05',
    final_paid_jpy: '1',
    financial_snapshot_id: `snapshot-${id}`,
    buyer_self_pay_bps: 0,
    buyer_self_pay_jpy: '0',
    buyer_expected_principal_cny_fen: '0',
    seller_expected_principal_cny_fen: '1',
    service_fee_snapshot_cny_fen: '0',
    projected_gross_profit_cny_fen: '1',
    completed_gross_profit_cny_fen: '1',
    seller_principal_due_cny_fen: '1',
    seller_principal_collected_cny_fen: '1',
    seller_principal_outstanding_cny_fen: '0',
    seller_service_fee_due_cny_fen: '0',
    seller_service_fee_collected_cny_fen: '0',
    seller_service_fee_outstanding_cny_fen: '0',
    buyer_refund_due_cny_fen: '0',
    buyer_refund_net_paid_cny_fen: '0',
    buyer_refund_outstanding_cny_fen: '0',
    buyer_refund_overpaid_cny_fen: '0',
    attributed_cash_net_cny_fen: '1',
    finance_status: financeStatus,
  };
}

function orderFilters(): InternalFinanceFilters {
  return {
    from_date: '2026-01-01',
    to_date: '2026-12-31',
    date_basis: 'CONFIRMED',
    seller_organization_id: null,
    store_id: null,
    product_id: null,
    asin: null,
    formal_order_id: null,
    amazon_order_number: null,
    review_type: null,
    finance_status: null,
  };
}

function cashFilters(): InternalFinanceFilters {
  return {
    ...orderFilters(),
    date_basis: 'CASH',
  };
}
