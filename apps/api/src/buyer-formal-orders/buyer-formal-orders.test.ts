import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import type { BuyerPortalContext } from '../buyer-portal/buyer-context';
import {
  decodeBuyerFormalOrderCursor,
  parseBuyerFormalOrderPageLimit,
} from './pagination';
import {
  getBuyerFormalOrder,
  listBuyerFormalOrders,
  type BuyerFormalOrderFilters,
} from './read-model';

const BUYER: BuyerPortalContext = {
  buyerCustomerId: 'buyer-1',
  marketplaceCode: 'AMAZON_JP',
  accessStatus: 'ACTIVE',
  identityReviewStatus: 'CLEAR',
  customerNumber: '20260801E1',
  displayName: '买家一',
  refundAccountName: null,
  refundAccountIdentifier: null,
  sessionExpiresAt: 99_999,
};

const NO_FILTERS: BuyerFormalOrderFilters = {
  marketplace: null,
  productName: null,
  reviewType: null,
  confirmedBusinessDate: null,
  formalOrderId: null,
  amazonOrderNumber: null,
};

describe('Phase 4B3 buyer formal order read model', () => {
  it('scopes list queries to the session buyer and uses stable keyset paging', async () => {
    const database = fakeDatabase({
      allPages: [[
        row('formal-3', 3000, 'B0FORM0003'),
        row('formal-2', 2000, 'B0FORM0002'),
        row('formal-1', 1000, 'B0FORM0001'),
      ], [row('formal-1', 1000, 'B0FORM0001')]],
    });

    const page = await listBuyerFormalOrders(database, BUYER, {
      limit: 2,
      cursor: null,
      filters: NO_FILTERS,
    });

    expect(page.items.map((item) => item.formal_order_id))
      .toEqual(['formal-3', 'formal-2']);
    expect(page.next_cursor).toEqual(expect.any(String));
    expect(decodeBuyerFormalOrderCursor(page.next_cursor!)).toEqual({
      confirmedAt: 2000,
      id: 'formal-2',
    });
    const secondPage = await listBuyerFormalOrders(database, BUYER, {
      limit: 2,
      cursor: decodeBuyerFormalOrderCursor(page.next_cursor!),
      filters: NO_FILTERS,
    });
    expect(secondPage.items.map((item) => item.formal_order_id))
      .toEqual(['formal-1']);
    expect(secondPage.next_cursor).toBeNull();
    expect(database.calls[0]?.sql).toContain(
      'formal_order.buyer_customer_id=?',
    );
    expect(database.calls[0]?.sql).toContain(
      'ORDER BY formal_order.confirmed_at DESC, formal_order.id DESC',
    );
    expect(database.calls[0]?.bindings).toEqual(['buyer-1', 3]);

    const serialized = JSON.stringify(page);
    for (const forbidden of [
      'seller_organization_id',
      'seller_rate',
      'seller_expected_principal_cny_fen',
      'service_fee_cny_fen',
      'confirmed_by_staff_id',
      'internal_review_note',
      'idempotency',
      'profit',
      'refund_status',
      'refund_work_item',
      'settlement',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('applies all supported filters and reads buyer money only from snapshots', async () => {
    const database = fakeDatabase({ all: [row('formal-1', 1000)] });
    const filters: BuyerFormalOrderFilters = {
      marketplace: 'AMAZON_JP',
      productName: '产品一',
      reviewType: 'IMAGE',
      confirmedBusinessDate: '2026-08-01',
      formalOrderId: 'formal-1',
      amazonOrderNumber: '123-1234567-1234567',
    };

    const page = await listBuyerFormalOrders(database, BUYER, {
      limit: 20,
      cursor: { confirmedAt: 2000, id: 'formal-2' },
      filters,
    });

    expect(page.items[0]).toMatchObject({
      final_paid_jpy: '8880',
      buyer_expected_principal_cny_fen: '48840',
      buyer_exchange_rate_snapshot: {
        version_no: 1,
        business_date: '2026-08-01',
        confirmed_at: 1500,
        cny_per_jpy_e8: '5500000',
      },
      status: 'CONFIRMED',
    });
    const call = database.calls[0]!;
    expect(call.sql).toContain('formal_order.marketplace_code=?');
    expect(call.sql).toContain('formal_order.product_name_snapshot LIKE ?');
    expect(call.sql).toContain('formal_order.review_type=?');
    expect(call.sql).toContain('formal_order.confirmed_business_date=?');
    expect(call.sql).toContain('formal_order.id=?');
    expect(call.sql).toContain('formal_order.amazon_order_number_normalized=?');
    expect(call.sql).toContain('formal_order_financial_snapshots');
    expect(call.sql).not.toContain('seller_agreement_rate_versions');
    expect(call.sql).not.toContain('seller_service_fee_versions');
    expect(call.sql).not.toContain('buyer_daily_exchange_rates');
    expect(call.bindings).toEqual([
      'buyer-1',
      'AMAZON_JP',
      '%产品一%',
      'IMAGE',
      '2026-08-01',
      'formal-1',
      '123-1234567-1234567',
      2000,
      2000,
      'formal-2',
      21,
    ]);
  });

  it('treats another buyer order exactly as not found', async () => {
    const database = fakeDatabase({ first: null });
    await expect(getBuyerFormalOrder(
      database,
      BUYER,
      'formal-other-buyer',
    )).rejects.toMatchObject({
      code: 'BUYER_FORMAL_ORDER_NOT_FOUND',
      status: 404,
    });
    expect(database.calls[0]?.bindings).toEqual([
      'formal-other-buyer',
      'buyer-1',
    ]);
  });

  it('rejects invalid pagination and business access before querying', async () => {
    expect(parseBuyerFormalOrderPageLimit(undefined)).toBe(20);
    expect(parseBuyerFormalOrderPageLimit('100')).toBe(100);
    expect(() => parseBuyerFormalOrderPageLimit('0')).toThrowError();
    expect(() => parseBuyerFormalOrderPageLimit('101')).toThrowError();
    expect(() => decodeBuyerFormalOrderCursor('***')).toThrowError();

    const disabled = { ...BUYER, accessStatus: 'DISABLED' as const };
    const database = fakeDatabase({ all: [] });
    await expect(listBuyerFormalOrders(database, disabled, {
      limit: 20,
      cursor: null,
      filters: NO_FILTERS,
    })).rejects.toMatchObject({ code: 'CUSTOMER_NOT_ACTIVE' });
    expect(database.calls).toHaveLength(0);
  });

  it('keeps routes read-only and leaves the schema compatible through 0029', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const routeSource = readFileSync(
      path.join(
        root,
        'apps/api/src/buyer-formal-orders/routes.ts',
      ),
      'utf8',
    );
    expect(routeSource).toContain('customerSessionMiddleware()');
    expect(routeSource).toContain('requireBuyerPortalContext(context)');
    expect(routeSource).toContain("'/api/buyer-portal/formal-orders'");
    expect(routeSource).toContain("'/api/buyer-portal/formal-orders/:id'");
    expect(routeSource).not.toMatch(/app\.(post|put|patch|delete)\(/u);

    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(36);
    expect(migrations[0]).toMatch(/^0001_/u);
    expect(migrations.at(-1)).toBe('0036_stage75r5_settlement_cancelled_reason_reserved.sql');
  });
});

function row(
  id: string,
  confirmedAt: number,
  asin = 'B0FORM0001',
) {
  return {
    formal_order_id: id,
    buyer_customer_no: '20260801E1',
    marketplace_code: 'AMAZON_JP' as const,
    amazon_order_number_normalized: '123-1234567-1234567',
    asin_normalized: asin,
    product_name_snapshot: '正式订单产品一',
    review_type: 'IMAGE' as const,
    final_paid_jpy: 8880,
    buyer_self_pay_bps: 1000,
    buyer_self_pay_jpy: 888,
    buyer_refundable_principal_jpy: 7992,
    buyer_expected_principal_cny_fen: 48840,
    buyer_rate_version_no: 1,
    buyer_rate_business_date: '2026-08-01',
    buyer_rate_confirmed_at: 1500,
    buyer_cny_per_jpy_e8: 5_500_000,
    confirmed_at: confirmedAt,
    confirmed_business_date: '2026-08-01',
    status: 'CONFIRMED' as const,
    evidence_version_no: 1,
    evidence_submitted_at: 7000,
    evidence_verified_at: 8000,
    evidence_file_count: 2,
  };
}

function fakeDatabase(result: {
  all?: unknown[];
  allPages?: unknown[][];
  first?: unknown | null;
}): SqlDatabase & {
  calls: Array<{ sql: string; bindings: unknown[] }>;
} {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  const allPages = [...(result.allPages ?? [])];
  return {
    calls,
    prepare(sql: string): SqlStatement {
      const call = { sql, bindings: [] as unknown[] };
      calls.push(call);
      const statement: SqlStatement = {
        bind(...bindings: unknown[]) {
          call.bindings = bindings;
          return statement;
        },
        async all<T>() {
          return {
            results: (allPages.length > 0
              ? allPages.shift()
              : result.all ?? []) as T[],
          };
        },
        async first<T>() {
          return (result.first ?? null) as T | null;
        },
        async run() {
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
    async batch(statements: readonly SqlStatement[]) {
      return statements.map(() => ({ meta: { changes: 0 } }));
    },
  };
}
