import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STAFF_BUYER_REFUND_PATHS,
  type StaffBuyerRefundDetailDto,
  type StaffBuyerRefundListItemDto,
} from '@ygb/contracts';
import { addChinaBusinessDays } from '@ygb/domain';
import { createMigratedTestDatabase } from '@ygb/testkit';
import {
  loginThroughDefaultApp,
  seedWave13RuntimeAuthority,
  Wave13RuntimeDatabase,
} from '../../test-support/wave13-runtime';
import { MockObjectStorage } from '../files/mock-object-storage';
import app from '../index';

const root = path.resolve(process.cwd());
const source = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

describe('Wave 13 Staff Buyer Refund API', () => {
  it('registers canonical Staff routes and dedicated permissions', () => {
    for (const route of Object.values(STAFF_BUYER_REFUND_PATHS)) {
      expect(route).toMatch(/^\/api\/staff\/buyer-refunds/u);
      expect(route).not.toContain('/api/v2/');
    }
    const implementation = [
      source('apps/api/src/buyer-refunds/staff-routes.ts'),
      source('apps/api/src/buyer-refunds/buyer-refund-shared.ts'),
    ].join('\n');
    expect(implementation).toContain('BUYER_REFUND_VIEW');
    expect(implementation).toContain('BUYER_REFUND_RECORD');
    expect(implementation).not.toContain('SELLER_SETTLEMENT_VIEW');
    expect(implementation).not.toContain('SELLER_SETTLEMENT_RECORD');
    expect(implementation).not.toContain('FINANCIAL_VIEW');
  });

  it('reuses append-only Payment and Reversal services', () => {
    const routes = source('apps/api/src/buyer-refunds/staff-routes.ts');
    expect(routes).toContain('recordBuyerRefundPayment(');
    expect(routes).toContain('reverseBuyerRefundPayment(');
    const payment = source(
      'apps/api/src/buyer-refunds/record-buyer-refund-payment.ts',
    );
    const reversal = source(
      'apps/api/src/buyer-refunds/reverse-buyer-refund-payment.ts',
    );
    expect(payment).toContain("entry_type: 'PAYMENT'");
    expect(reversal).toContain("entry_type: 'REVERSAL'");
    expect(`${payment}\n${reversal}`).not.toMatch(
      /UPDATE\s+buyer_refund_payment_entries/iu,
    );
    expect(`${payment}\n${reversal}`).not.toMatch(
      /DELETE\s+FROM\s+buyer_refund_payment_entries/iu,
    );
  });

  it('preserves OVERPAID and does not cap net paid to due', () => {
    const shared = source(
      'apps/api/src/buyer-refunds/buyer-refund-shared.ts',
    );
    const routes = source('apps/api/src/buyer-refunds/staff-routes.ts');
    expect(shared).toContain("return 'OVERPAID';");
    expect(routes).toContain('Math.max(net - due, 0)');
    expect(routes).toContain('Math.max(due - net, 0)');
  });

  it('binds INTERNAL_ONLY proof files to Payment facts with explicit Staff audience', () => {
    const payment = source(
      'apps/api/src/buyer-refunds/record-buyer-refund-payment.ts',
    );
    const routes = source('apps/api/src/buyer-refunds/staff-routes.ts');
    expect(payment).toContain("row.purpose !== 'BUYER_REFUND_PROOF'");
    expect(payment).toContain("row.visibility !== 'INTERNAL_ONLY'");
    expect(payment).toContain("entityType: 'BUYER_REFUND'");
    expect(payment).toContain("subjectType: 'STAFF_INTERNAL'");
    expect(payment).toContain("permissionCode: 'BUYER_REFUND_VIEW'");
    expect(routes).not.toContain('object_key');
    expect(routes).not.toContain('permanent_url');
  });

  it('keeps Seller projections isolated from Buyer Refund cost and proof', () => {
    const sellerFiles = [
      'apps/api/src/seller-settlements/seller-routes.ts',
      'apps/api/src/seller-portal/routes.ts',
      'packages/contracts/src/seller-portal.ts',
      'packages/contracts/src/seller-settlement.ts',
    ].map(source).join('\n');
    for (const forbidden of [
      'buyer_refund_payment_entries',
      'BUYER_REFUND_PROOF',
      'buyer_refund_internal_note',
      'buyer_refund_payment_entry_files',
    ]) expect(sellerFiles).not.toContain(forbidden);
  });

  it('projects a Seller-isolated runtime response with exact refund math', async () => {
    const base = createMigratedTestDatabase();
    try {
      seedWave13RuntimeAuthority(base);
      const database = new Wave13RuntimeDatabase(base);
      const identity = await loginThroughDefaultApp(
        database,
        'owner',
        new MockObjectStorage(),
      );
      const response = await app.request(
        'https://api.example.test/api/staff/buyer-refunds/runtime-refund',
        { headers: { Cookie: identity.cookie } },
        identity.env,
      );
      expect(response.status).toBe(200);
      const body = await response.json() as {
        data: { buyer_refund: StaffBuyerRefundDetailDto };
      };
      expect(body.data.buyer_refund).toMatchObject({
        due_amount_cny_fen: '1000',
        gross_paid_cny_fen: '1000',
        reversed_cny_fen: '200',
        net_paid_cny_fen: '800',
        outstanding_amount_cny_fen: '200',
        overpaid_amount_cny_fen: '0',
        status: 'PARTIALLY_PAID',
        reminder_count: 2,
        last_reminded_at: 11_500,
        payments: [{
          internal_note: 'Staff-only payment note',
        }],
        reversals: [{
          internal_note: 'Staff-only reversal note',
        }],
      });
      expect(JSON.stringify(body.data.buyer_refund)).not.toMatch(
        /object_key|permanent_url|signed_url|seller_settlement/iu,
      );
    } finally {
      base.close();
    }
  });

  it('applies strict inclusive China-date list filters before pagination', async () => {
    const base = createMigratedTestDatabase();
    try {
      seedWave13RuntimeAuthority(base);
      const database = new Wave13RuntimeDatabase(base);
      const identity = await loginThroughDefaultApp(
        database,
        'owner',
        new MockObjectStorage(),
      );
      const request = async (query: string) => {
        const response = await app.request(
          `https://api.example.test/api/staff/buyer-refunds${query}`,
          { headers: { Cookie: identity.cookie } },
          identity.env,
        );
        const body = await response.json() as {
          data: {
            items: StaffBuyerRefundListItemDto[];
            next_cursor: string | null;
          };
        };
        return { response, body };
      };

      const day = await request('?from=2026-08-01&to=2026-08-01');
      expect(day.response.status).toBe(200);
      expect(day.body.data.items.map((item) => item.obligation_id)).toEqual([
        'runtime-refund-start',
        'runtime-refund-end',
      ]);
      expect(day.body.data.items[0]).toMatchObject({
        due_amount_cny_fen: '1000',
        gross_paid_cny_fen: '0',
        reversed_cny_fen: '0',
        net_paid_cny_fen: '0',
        outstanding_amount_cny_fen: '1000',
        overpaid_amount_cny_fen: '0',
        reminder_count: 2,
        last_reminded_at: Date.parse('2026-07-31T16:00:00.000Z') + 50,
        // P7c：承诺期限 = 评论通过 + 7 个工作日（周五 7/31 通过 → 8/11 周二），
        // 未结清按该期限升序、已结清沉底（见下方顺序断言）。
        review_approved_at: Date.parse('2026-07-31T16:00:00.000Z') - 5_000,
        promise_deadline_at: addChinaBusinessDays(
          Date.parse('2026-07-31T16:00:00.000Z') - 5_000,
          7,
        ),
        buyer: {
          buyer_customer_id: 'runtime-buyer',
          buyer_customer_no: 'P202608020001',
        },
        order: {
          formal_order_id: 'runtime-formal-order',
          marketplace: 'JP',
          amazon_order_number_normalized: '123-1234567-1234567',
          product_id: 'runtime-product',
          asin: 'B0RT000001',
        },
        workflow: {
          work_item_id: 'runtime-refund-work-item',
          assigned_staff_id: 'zz-phase3h-test-owner',
          assigned_team_id: null,
          fixed_assignment_id: 'runtime-refund-assignment',
        },
      });
      expect(JSON.stringify(day.body)).not.toMatch(
        /object_key|permanent_url|seller_settlement|internal_note/iu,
      );

      expect((await request('?from=2026-08-01')).body.data.items)
        .toHaveLength(3);
      expect((await request('?to=2026-08-01')).body.data.items)
        .toHaveLength(3);

      const first = await request(
        '?status=DUE&from=2026-08-01&to=2026-08-01&limit=1',
      );
      expect(first.body.data.items[0]?.obligation_id)
        .toBe('runtime-refund-start');
      expect(first.body.data.next_cursor).toEqual(expect.any(String));
      const second = await request(
        `?status=DUE&from=2026-08-01&to=2026-08-01&limit=1&cursor=${first.body.data.next_cursor}`,
      );
      expect(second.body.data.items[0]?.obligation_id)
        .toBe('runtime-refund-end');

      const scoped = await loginThroughDefaultApp(
        database,
        'scoped',
        new MockObjectStorage(),
      );
      const concealed = await app.request(
        'https://api.example.test/api/staff/buyer-refunds',
        { headers: { Cookie: scoped.cookie } },
        scoped.env,
      );
      expect(concealed.status).toBe(200);
      await expect(concealed.json()).resolves.toMatchObject({
        data: { items: [] },
      });
    } finally {
      base.close();
    }
  });

  it('rejects ambiguous refund list dates and invalid payment business dates', async () => {
    const base = createMigratedTestDatabase();
    try {
      seedWave13RuntimeAuthority(base);
      const database = new Wave13RuntimeDatabase(base);
      const identity = await loginThroughDefaultApp(
        database,
        'owner',
        new MockObjectStorage(),
      );
      for (const query of [
        '?from=2026-08-02&to=2026-08-01',
        '?from=2026-02-30',
        '?from=',
        '?from=2026-08-01&from=2026-08-02',
        '?to=2026-08-01&to=2026-08-02',
      ]) {
        const response = await app.request(
          `https://api.example.test/api/staff/buyer-refunds${query}`,
          { headers: { Cookie: identity.cookie } },
          identity.env,
        );
        expect(response.status, query).toBe(400);
      }

      const paidAt = Date.parse('2026-07-31T16:00:00.000Z');
      const basePayment = {
        expected_version: 1,
        amount_cny_fen: '100',
        paid_at: paidAt,
        china_business_date: '2026-08-01',
        payment_channel: 'WECHAT',
        proof_files: [{
          file_object_id: 'runtime-refund-proof',
          expected_file_version: 1,
        }],
      };
      for (const body of [
        Object.fromEntries(Object.entries(basePayment).filter(
          ([key]) => key !== 'china_business_date',
        )),
        { ...basePayment, china_business_date: '2026/08/01' },
        { ...basePayment, china_business_date: '2026-02-30' },
        { ...basePayment, china_business_date: '2026-08-02' },
      ]) {
        const response = await app.request(
          'https://api.example.test/api/staff/buyer-refunds/runtime-refund/payments',
          {
            method: 'POST',
            headers: {
              Cookie: identity.cookie,
              'Content-Type': 'application/json',
              'Idempotency-Key': 'runtime-refund-date-validation',
            },
            body: JSON.stringify(body),
          },
          identity.env,
        );
        expect(response.status).toBe(400);
      }
    } finally {
      base.close();
    }
  });
});
