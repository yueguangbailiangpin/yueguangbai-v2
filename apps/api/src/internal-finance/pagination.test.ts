import { describe, expect, it } from 'vitest';
import type {
  FinanceStatus,
  InternalFinanceFilters,
  SqlDatabase,
} from '@ygb/contracts';
import {
  readFinanceCashFlow,
  readFinanceExceptionPage,
  readFinanceGroups,
  readFinanceSummary,
} from './read-model';

interface RawPosition {
  formal_order_id: string;
  amazon_order_number: string;
  seller_organization_id: string;
  store_id: string;
  product_id: string;
  asin: string;
  product_name: string;
  review_type: string;
  confirmed_at: number;
  confirmed_business_date: string;
  review_approved_at: number | null;
  review_approved_business_date: string | null;
  last_cash_business_date: string | null;
  final_paid_jpy: string;
  financial_snapshot_id: string | null;
  buyer_self_pay_bps: number | null;
  buyer_self_pay_jpy: string | null;
  buyer_expected_principal_cny_fen: string | null;
  seller_expected_principal_cny_fen: string | null;
  service_fee_snapshot_cny_fen: string | null;
  projected_gross_profit_cny_fen: string | null;
  completed_gross_profit_cny_fen: string | null;
  seller_principal_due_cny_fen: string;
  seller_principal_collected_cny_fen: string;
  seller_principal_outstanding_cny_fen: string;
  seller_service_fee_due_cny_fen: string;
  seller_service_fee_collected_cny_fen: string;
  seller_service_fee_outstanding_cny_fen: string;
  buyer_refund_due_cny_fen: string;
  buyer_refund_net_paid_cny_fen: string;
  buyer_refund_outstanding_cny_fen: string;
  buyer_refund_overpaid_cny_fen: string;
  attributed_cash_net_cny_fen: string;
  finance_status: FinanceStatus;
}

interface RawCashMovement {
  occurred_at: number;
  movement_id: string;
  movement_type: string;
  amount_cny_fen: string;
  cash_business_date: string;
  seller_organization_id: string;
}

describe('Wave 12 bounded financial reads', () => {
  it('aggregates summary across keyset pages with exact BigInt totals', async () => {
    const huge = '9007199254740993';
    const positions = Array.from({ length: 1_501 }, (_, index) => rawPosition(
      index,
      {
        projected_gross_profit_cny_fen: huge,
        completed_gross_profit_cny_fen: huge,
        attributed_cash_net_cny_fen: huge,
      },
    ));
    const fake = financeDatabase({ positions });
    const summary = await readFinanceSummary(
      fake.database,
      orderFilters('CONFIRMED'),
      123,
    );
    const expected = (BigInt(huge) * 1_501n).toString(10);
    expect(summary.order_count).toBe(1_501);
    expect(summary.projected_gross_profit_cny_fen).toBe(expected);
    expect(summary.completed_gross_profit_cny_fen).toBe(expected);
    expect(summary.attributed_cash_net_cny_fen).toBe(expected);
    expect(fake.positionPageReads).toBe(3);
    expect(fake.sql.some((sql) => /\bOFFSET\b/iu.test(sql))).toBe(false);
  });

  it('keeps only per-group accumulators and sorts every group type', async () => {
    const positions = [
      rawPosition(2, {
        seller_organization_id: 'seller-b',
        store_id: 'store-b',
        product_id: 'product-b',
        asin: 'B000000002',
        product_name: 'Product B',
        confirmed_business_date: '2026-02-03',
        review_approved_business_date: '2026-03-04',
      }),
      rawPosition(0, {
        seller_organization_id: 'seller-a',
        store_id: 'store-a',
        product_id: 'product-a',
        asin: 'B000000001',
        product_name: 'Product A',
        confirmed_business_date: '2026-01-02',
        review_approved_business_date: '2026-02-03',
      }),
      ...Array.from({ length: 1_501 }, (_, index) => rawPosition(index + 10, {
        store_id: `store-${index % 3}`,
      })),
    ];
    const fake = financeDatabase({ positions });
    const confirmed = orderFilters('CONFIRMED');
    const approved = orderFilters('APPROVED');

    const expectations = [
      ['SELLER_ORGANIZATION', confirmed, ['seller-a', 'seller-b', 'seller-0']],
      ['STORE', confirmed, ['store-0', 'store-1', 'store-2', 'store-a', 'store-b']],
      ['PRODUCT', confirmed, ['product-0', 'product-a', 'product-b']],
      ['ASIN', confirmed, ['B000000001', 'B000000002']],
      ['DAY', confirmed, ['2026-01-02', '2026-02-03', '2026-08-01']],
      ['MONTH', approved, ['2026-02', '2026-03', '2026-08']],
    ] as const;

    for (const [groupBy, filters, expectedPrefix] of expectations) {
      const groups = await readFinanceGroups(fake.database, filters, groupBy);
      const keys = groups.map((group) => group.group_key);
      expect(keys).toEqual([...keys].sort());
      for (const key of expectedPrefix) expect(keys).toContain(key);
    }
    const stores = await readFinanceGroups(fake.database, confirmed, 'STORE');
    expect(stores.reduce((total, group) => total + group.order_count, 0))
      .toBe(positions.length);
    expect(fake.positionPageReads).toBeGreaterThan(2);
  });

  it('paginates exceptions without duplicates or omissions', async () => {
    const positions = Array.from({ length: 1_050 }, (_, index) => rawPosition(
      index,
      {
        finance_status: index % 2 === 0 ? 'AMOUNT_MISMATCH' : 'COMPLETED',
      },
    ));
    const fake = financeDatabase({ positions });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await readFinanceExceptionPage(
        fake.database,
        orderFilters('CONFIRMED'),
        { limit: 200, cursor },
        456,
      );
      seen.push(...page.items.map((item) => item.formal_order_id));
      cursor = page.page.next_cursor;
    } while (cursor !== null);

    const expected = positions
      .filter((row) => row.finance_status === 'AMOUNT_MISMATCH')
      .sort(comparePositionDesc)
      .map((row) => row.formal_order_id);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(525);
  });

  it('aggregates cash movements across pages by actual movement date', async () => {
    const huge = '9007199254740993';
    const movements = Array.from({ length: 1_501 }, (_, index) => ({
      occurred_at: index + 1,
      movement_id: `movement-${String(index).padStart(6, '0')}`,
      movement_type: index % 4 === 0
        ? 'SELLER_PAYMENT'
        : index % 4 === 1
          ? 'SELLER_PAYMENT_REVERSAL'
          : index % 4 === 2
            ? 'BUYER_REFUND_PAYMENT'
            : 'BUYER_REFUND_REVERSAL',
      amount_cny_fen: huge,
      cash_business_date: index < 1_000 ? '2026-07-01' : '2026-07-05',
      seller_organization_id: 'seller-0',
    }));
    const fake = financeDatabase({ cashMovements: movements });
    const firstWindow = await readFinanceCashFlow(
      fake.database,
      cashFilters('2026-07-01', '2026-07-01'),
      789,
    );
    const expectedFirst = cashExpectation(movements.slice(0, 1_000));
    expect(firstWindow).toMatchObject(expectedFirst);

    const refundWindow = await readFinanceCashFlow(
      fake.database,
      cashFilters('2026-07-05', '2026-07-05'),
      790,
    );
    const expectedSecond = cashExpectation(movements.slice(1_000));
    expect(refundWindow).toMatchObject(expectedSecond);
    expect(fake.cashPageReads).toBeGreaterThan(2);
    expect(fake.sql.some((sql) => /\bOFFSET\b/iu.test(sql))).toBe(false);
  });
});

function financeDatabase(input: {
  positions?: readonly RawPosition[];
  cashMovements?: readonly RawCashMovement[];
}) {
  const positions = [...(input.positions ?? [])];
  const cashMovements = [...(input.cashMovements ?? [])];
  const state = {
    sql: [] as string[],
    positionPageReads: 0,
    cashPageReads: 0,
  };
  const database = {
    prepare(sql: string) {
      state.sql.push(sql);
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async all<T>() {
          if (sql.includes('internal_order_finance_positions')) {
            state.positionPageReads += 1;
            const ascending = sql.includes('confirmed_at ASC');
            const exceptionOnly = sql.includes("NOT IN ('PROJECTED_ONLY','COMPLETED')");
            const fromDate = String(bindings[0]);
            const toDate = String(bindings[1]);
            const usesApproved = sql.includes('review_approved_business_date BETWEEN');
            const hasCursor = sql.includes('position.confirmed_at>?')
              || sql.includes('position.confirmed_at<?');
            const limit = Number(bindings.at(-1));
            let rows = positions.filter((row) => {
              const date = usesApproved
                ? row.review_approved_business_date
                : row.confirmed_business_date;
              return date !== null && date >= fromDate && date <= toDate;
            });
            if (exceptionOnly) {
              rows = rows.filter((row) => row.finance_status !== 'PROJECTED_ONLY'
                && row.finance_status !== 'COMPLETED');
            }
            rows.sort(ascending ? comparePositionAsc : comparePositionDesc);
            if (hasCursor) {
              const cursorAt = Number(bindings.at(-4));
              const cursorId = String(bindings.at(-2));
              rows = rows.filter((row) => ascending
                ? row.confirmed_at > cursorAt
                  || (row.confirmed_at === cursorAt
                    && row.formal_order_id > cursorId)
                : row.confirmed_at < cursorAt
                  || (row.confirmed_at === cursorAt
                    && row.formal_order_id < cursorId));
            }
            return { results: rows.slice(0, limit) as T[] };
          }
          if (sql.includes('internal_finance_cash_movements')) {
            state.cashPageReads += 1;
            const fromDate = String(bindings[0]);
            const toDate = String(bindings[1]);
            const hasOrganization = sql.includes('seller_organization_id=?');
            const organization = hasOrganization ? String(bindings[2]) : null;
            const hasCursor = sql.includes('movement.occurred_at>?');
            const limit = Number(bindings.at(-1));
            let rows = cashMovements.filter((row) => (
              row.cash_business_date >= fromDate
              && row.cash_business_date <= toDate
              && (organization === null
                || row.seller_organization_id === organization)
            ));
            rows.sort(compareCashAsc);
            if (hasCursor) {
              const cursorAt = Number(bindings.at(-4));
              const cursorId = String(bindings.at(-2));
              rows = rows.filter((row) => row.occurred_at > cursorAt
                || (row.occurred_at === cursorAt
                  && row.movement_id > cursorId));
            }
            return { results: rows.slice(0, limit) as T[] };
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
  return {
    database,
    get sql() { return state.sql; },
    get positionPageReads() { return state.positionPageReads; },
    get cashPageReads() { return state.cashPageReads; },
  };
}

function rawPosition(
  index: number,
  overrides: Partial<RawPosition> = {},
): RawPosition {
  const id = String(index).padStart(6, '0');
  return {
    formal_order_id: `order-${id}`,
    amazon_order_number: `123-1234567-${id.padStart(7, '0')}`,
    seller_organization_id: 'seller-0',
    store_id: 'store-0',
    product_id: 'product-0',
    asin: 'B000000001',
    product_name: 'Product 0',
    review_type: 'TEXT',
    confirmed_at: index + 1,
    confirmed_business_date: '2026-08-01',
    review_approved_at: index + 2,
    review_approved_business_date: '2026-08-01',
    last_cash_business_date: '2026-08-05',
    final_paid_jpy: '1000',
    financial_snapshot_id: `snapshot-${id}`,
    buyer_self_pay_bps: 0,
    buyer_self_pay_jpy: '0',
    buyer_expected_principal_cny_fen: '100',
    seller_expected_principal_cny_fen: '110',
    service_fee_snapshot_cny_fen: '10',
    projected_gross_profit_cny_fen: '20',
    completed_gross_profit_cny_fen: '20',
    seller_principal_due_cny_fen: '110',
    seller_principal_collected_cny_fen: '110',
    seller_principal_outstanding_cny_fen: '0',
    seller_service_fee_due_cny_fen: '10',
    seller_service_fee_collected_cny_fen: '10',
    seller_service_fee_outstanding_cny_fen: '0',
    buyer_refund_due_cny_fen: '100',
    buyer_refund_net_paid_cny_fen: '100',
    buyer_refund_outstanding_cny_fen: '0',
    buyer_refund_overpaid_cny_fen: '0',
    attributed_cash_net_cny_fen: '20',
    finance_status: 'COMPLETED',
    ...overrides,
  };
}

function orderFilters(
  dateBasis: 'CONFIRMED' | 'APPROVED',
): InternalFinanceFilters {
  return {
    from_date: '2026-01-01',
    to_date: '2026-12-31',
    date_basis: dateBasis,
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

function cashFilters(fromDate: string, toDate: string): InternalFinanceFilters {
  return {
    ...orderFilters('CONFIRMED'),
    from_date: fromDate,
    to_date: toDate,
    date_basis: 'CASH',
  };
}

function comparePositionAsc(left: RawPosition, right: RawPosition): number {
  return left.confirmed_at - right.confirmed_at
    || left.formal_order_id.localeCompare(right.formal_order_id);
}

function comparePositionDesc(left: RawPosition, right: RawPosition): number {
  return right.confirmed_at - left.confirmed_at
    || right.formal_order_id.localeCompare(left.formal_order_id);
}

function compareCashAsc(left: RawCashMovement, right: RawCashMovement): number {
  return left.occurred_at - right.occurred_at
    || left.movement_id.localeCompare(right.movement_id);
}

function cashExpectation(rows: readonly RawCashMovement[]) {
  let sellerIn = 0n;
  let sellerReversal = 0n;
  let buyerOut = 0n;
  let buyerReversal = 0n;
  for (const row of rows) {
    const amount = BigInt(row.amount_cny_fen);
    if (row.movement_type === 'SELLER_PAYMENT') sellerIn += amount;
    else if (row.movement_type === 'SELLER_PAYMENT_REVERSAL') {
      sellerReversal += amount;
    } else if (row.movement_type === 'BUYER_REFUND_PAYMENT') {
      buyerOut += amount;
    } else if (row.movement_type === 'BUYER_REFUND_REVERSAL') {
      buyerReversal += amount;
    }
  }
  return {
    seller_cash_inflow_cny_fen: sellerIn.toString(10),
    seller_payment_reversal_cny_fen: sellerReversal.toString(10),
    buyer_refund_outflow_cny_fen: buyerOut.toString(10),
    buyer_refund_reversal_cny_fen: buyerReversal.toString(10),
    net_cash_flow_cny_fen: (
      sellerIn - sellerReversal - buyerOut + buyerReversal
    ).toString(10),
  };
}
