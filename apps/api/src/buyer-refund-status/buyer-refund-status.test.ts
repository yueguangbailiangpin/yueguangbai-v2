import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import type { BuyerPortalContext } from '../buyer-portal/buyer-context';
import { normalizeBuyerRefundPortalError } from './errors';
import { decodeBuyerRefundPortalCursor } from './pagination';
import {
  getBuyerRefund,
  listBuyerRefunds,
} from './read-model';

const BUYER: BuyerPortalContext = {
  buyerCustomerId: 'buyer-1',
  marketplaceCode: 'AMAZON_JP',
  accessStatus: 'ACTIVE',
  identityReviewStatus: 'CLEAR',
  customerNumber: 'B000001',
  displayName: '测试买家',
  refundAccountName: null,
  refundAccountIdentifier: null,
  sessionExpiresAt: 999_999,
};

describe('Phase 4B5 buyer refund status read model', () => {
  it('scopes list queries to the session buyer and uses stable keyset paging', async () => {
    const database = fakeDatabase({
      all: [[
        refundRow('refund-3', 3000, 48_840, 48_841, 'OVERPAID'),
        refundRow('refund-2', 2000, 48_840, 48_840, 'PAID'),
        refundRow('refund-1', 1000, 48_840, 10_000, 'PARTIALLY_PAID'),
      ], [refundRow('refund-1', 1000, 48_840, 10_000, 'PARTIALLY_PAID')]],
    });
    const page = await listBuyerRefunds(database, BUYER, {
      limit: 2,
      cursor: null,
    });
    expect(page.items.map((item) => item.refund_obligation_id))
      .toEqual(['refund-3', 'refund-2']);
    expect(decodeBuyerRefundPortalCursor(page.next_cursor!)).toEqual({
      updatedAt: 2000,
      id: 'refund-2',
    });
    const secondPage = await listBuyerRefunds(database, BUYER, {
      limit: 2,
      cursor: decodeBuyerRefundPortalCursor(page.next_cursor!),
    });
    expect(secondPage.items.map((item) => item.refund_obligation_id))
      .toEqual(['refund-1']);
    expect(secondPage.next_cursor).toBeNull();
    expect(database.calls[0]?.sql).toContain(
      'ledger.buyer_customer_id=?',
    );
    expect(database.calls[0]?.sql).toContain(
      'ORDER BY ledger.updated_at DESC, ledger.obligation_id DESC',
    );
    expect(database.calls[0]?.bindings).toEqual(['buyer-1', 3]);
  });

  it('filters to outstanding obligations exactly like DUE + PARTIALLY_PAID', async () => {
    const database = fakeDatabase({
      all: [[
        refundRow('due', 4000, 48_840, 0, 'DUE'),
        refundRow('partial', 3000, 48_840, 10_000, 'PARTIALLY_PAID'),
      ]],
    });
    const page = await listBuyerRefunds(database, BUYER, {
      limit: 2,
      cursor: null,
      outstandingOnly: true,
    });
    expect(page.items.map((item) => item.refund_obligation_id))
      .toEqual(['due', 'partial']);
    expect(database.calls[0]?.sql).toContain(
      'ledger.status IN (?,?)',
    );
    expect(database.calls[0]?.bindings).toEqual([
      'buyer-1',
      'DUE',
      'PARTIALLY_PAID',
      3,
    ]);

    const unfiltered = fakeDatabase({ all: [[refundRow('paid', 2000, 48_840, 48_840, 'PAID')]] });
    const unfilteredPage = await listBuyerRefunds(unfiltered, BUYER, {
      limit: 2,
      cursor: null,
    });
    expect(unfilteredPage.items.map((item) => item.refund_obligation_id))
      .toEqual(['paid']);
    expect(unfiltered.calls[0]?.sql).not.toContain('status IN');
    expect(unfiltered.calls[0]?.bindings).toEqual(['buyer-1', 3]);

    // cursor + outstanding_only 组合：绑定顺序与 SQL 一致
    const paged = fakeDatabase({ all: [[refundRow('partial2', 2500, 48_840, 10_000, 'PARTIALLY_PAID')]] });
    const pagedResult = await listBuyerRefunds(paged, BUYER, {
      limit: 1,
      cursor: { updatedAt: 3000, id: 'partial' },
      outstandingOnly: true,
    });
    expect(pagedResult.items.map((item) => item.refund_obligation_id))
      .toEqual(['partial2']);
    expect(paged.calls[0]?.bindings).toEqual([
      'buyer-1',
      'DUE',
      'PARTIALLY_PAID',
      3000,
      3000,
      'partial',
      2,
    ]);
  });

  it('projects due, partial, paid, and overpaid balances truthfully', async () => {
    const database = fakeDatabase({
      all: [[
        refundRow('due', 4000, 48_840, 0, 'DUE'),
        refundRow('partial', 3000, 48_840, 10_000, 'PARTIALLY_PAID'),
        refundRow('paid', 2000, 48_840, 48_840, 'PAID'),
        refundRow('overpaid', 1000, 48_840, 48_841, 'OVERPAID'),
      ]],
    });
    const page = await listBuyerRefunds(database, BUYER, {
      limit: 20,
      cursor: null,
    });
    expect(page.items.map((item) => ({
      id: item.refund_obligation_id,
      status: item.status,
      remaining: item.remaining_amount_cny_fen,
      overpaid: item.overpaid_amount_cny_fen,
    }))).toEqual([
      { id: 'due', status: 'DUE', remaining: '48840', overpaid: '0' },
      { id: 'partial', status: 'PARTIALLY_PAID', remaining: '38840', overpaid: '0' },
      { id: 'paid', status: 'PAID', remaining: '0', overpaid: '0' },
      { id: 'overpaid', status: 'OVERPAID', remaining: '0', overpaid: '1' },
    ]);
  });

  it('shows append-only payment and reversal activities without private fields', async () => {
    const database = fakeDatabase({
      first: [refundRow(
        'refund-1',
        4000,
        48_840,
        38_840,
        'PARTIALLY_PAID',
      )],
      all: [[
        activityRow(
          'activity-payment',
          'BUYER_REFUND_PAYMENT_RECORDED',
          'PAYMENT',
          48_840,
          2000,
          48_840,
        ),
        activityRow(
          'activity-reversal',
          'BUYER_REFUND_PAYMENT_REVERSED',
          'REVERSAL',
          10_000,
          3000,
          38_840,
        ),
      ]],
    });
    const result = await getBuyerRefund(database, BUYER, 'refund-1');
    expect(result.status).toBe('PARTIALLY_PAID');
    expect(result.net_paid_cny_fen).toBe('38840');
    expect(result.activities).toEqual([
      {
        activity_id: 'activity-payment',
        activity_type: 'PAYMENT_RECORDED',
        amount_cny_fen: '48840',
        occurred_at: 2000,
        payment_channel: 'WECHAT',
        balance_after: {
          due_amount_cny_fen: '48840',
          net_paid_cny_fen: '48840',
          remaining_amount_cny_fen: '0',
          overpaid_amount_cny_fen: '0',
          status: 'PAID',
        },
      },
      {
        activity_id: 'activity-reversal',
        activity_type: 'PAYMENT_REVERSED',
        amount_cny_fen: '10000',
        occurred_at: 3000,
        payment_channel: 'WECHAT',
        balance_after: {
          due_amount_cny_fen: '48840',
          net_paid_cny_fen: '38840',
          remaining_amount_cny_fen: '10000',
          overpaid_amount_cny_fen: '0',
          status: 'PARTIALLY_PAID',
        },
      },
    ]);
    expect(database.calls[1]?.sql).toContain(
      'ORDER BY event.created_at ASC, event.id ASC',
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /internal_note|recorded_by_staff|actor_id|metadata_json|idempotency|request_hash|object_key|permanent_url|proof_file/iu,
    );
  });

  it('treats another buyer refund exactly as not found', async () => {
    const database = fakeDatabase({ first: [null] });
    await expect(getBuyerRefund(
      database,
      BUYER,
      'foreign-refund',
    )).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(database.calls[0]?.bindings).toEqual([
      'foreign-refund',
      'buyer-1',
    ]);
  });

  it('rejects inactive and identity-review buyers before querying', async () => {
    for (const buyer of [
      { ...BUYER, accessStatus: 'DISABLED' as const },
      { ...BUYER, identityReviewStatus: 'REVIEW_REQUIRED' as const },
    ]) {
      const database = fakeDatabase({ all: [[]] });
      await expect(listBuyerRefunds(database, buyer, {
        limit: 20,
        cursor: null,
      })).rejects.toMatchObject({ status: 409 });
      expect(database.calls).toHaveLength(0);
    }
  });

  it('normalizes concealment and foundation idempotency conflicts without losing 409 semantics', () => {
    expect(normalizeBuyerRefundPortalError({
      code: 'BUYER_REFUND_NOT_FOUND',
    })).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(normalizeBuyerRefundPortalError({
      code: 'FORBIDDEN',
    })).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(normalizeBuyerRefundPortalError({
      code: 'REQUEST_IN_PROGRESS',
    })).toMatchObject({ code: 'REQUEST_IN_PROGRESS', status: 409 });
    expect(normalizeBuyerRefundPortalError({
      code: 'IDEMPOTENCY_CONFLICT',
    })).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  });

  it('keeps read endpoints file-blind and registers only the scoped reminder command', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const routeSource = readFileSync(
      path.join(root, 'apps/api/src/buyer-refund-status/routes.ts'),
      'utf8',
    );
    const readModelSource = readFileSync(
      path.join(root, 'apps/api/src/buyer-refund-status/read-model.ts'),
      'utf8',
    );
    expect(routeSource).toContain("'/api/buyer-portal/refunds'");
    expect(routeSource).toContain("'/api/buyer-portal/refunds/:id'");
    expect(routeSource).toContain("'/api/buyer-portal/refunds/:id/remind'");
    expect(routeSource).toContain('customerSessionMiddleware()');
    expect(routeSource).toContain('requireBuyerPortalContext(context)');
    expect(routeSource).toContain('remindBuyerRefund');
    expect(routeSource).not.toMatch(/app\.(put|patch|delete)\(/u);
    expect(routeSource).not.toContain('createFileReadIntent');
    expect(readModelSource).toContain('buyer_refund_ledger_balances');
    expect(readModelSource).toContain('buyerRefundStatusFromAmounts');
    expect(readModelSource).not.toMatch(
      /internal_note|recorded_by_staff_id|metadata_json|idempotency_key|request_hash|file_entity|file_object|object_key|permanent_url/iu,
    );

    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(39);
    expect(migrations.at(-1)).toBe('0039_owner_cleanup_bd_zero_consumer_objects.sql');
  });
});

function refundRow(
  id: string,
  updatedAt: number,
  dueAmount: number,
  netPaid: number,
  status: 'DUE' | 'PARTIALLY_PAID' | 'PAID' | 'OVERPAID',
) {
  return {
    refund_obligation_id: id,
    buyer_customer_id: 'buyer-1',
    formal_order_id: `formal-${id}`,
    marketplace_code: 'AMAZON_JP' as const,
    amazon_order_number_normalized: '123-1234567-1234567',
    asin_normalized: 'B0REFUND01',
    product_name_snapshot: '返款测试产品',
    review_type: 'IMAGE' as const,
    due_amount_cny_fen: dueAmount,
    net_paid_cny_fen: netPaid,
    ledger_status: status,
    became_due_at: 1000,
    first_paid_at: netPaid === 0 ? null : 2000,
    last_paid_at: netPaid === 0 ? null : 2000,
    updated_at: updatedAt,
  };
}

function activityRow(
  id: string,
  eventType:
    | 'BUYER_REFUND_PAYMENT_RECORDED'
    | 'BUYER_REFUND_PAYMENT_REVERSED',
  entryType: 'PAYMENT' | 'REVERSAL',
  amount: number,
  occurredAt: number,
  netPaidAfter: number,
) {
  return {
    activity_id: id,
    event_type: eventType,
    entry_type: entryType,
    amount_cny_fen: amount,
    occurred_at: occurredAt,
    payment_channel: 'WECHAT' as const,
    net_paid_after_cny_fen: netPaidAfter,
    event_created_at: occurredAt,
  };
}

interface FakeOptions {
  all?: readonly (readonly Record<string, unknown>[])[];
  first?: readonly (Record<string, unknown> | null)[];
}

function fakeDatabase(options: FakeOptions): SqlDatabase & {
  calls: Array<{ sql: string; bindings: unknown[] }>;
} {
  const allQueue = [...(options.all ?? [])];
  const firstQueue = [...(options.first ?? [])];
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
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
            results: (allQueue.shift() ?? []) as T[],
          };
        },
        async first<T>() {
          return (firstQueue.shift() ?? null) as T | null;
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
