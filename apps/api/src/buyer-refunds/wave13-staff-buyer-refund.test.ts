import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STAFF_BUYER_REFUND_PATHS,
  type StaffBuyerRefundDetailDto,
} from '@ygb/contracts';
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
        net_paid_cny_fen: '0',
        outstanding_amount_cny_fen: '1000',
        overpaid_amount_cny_fen: '0',
        status: 'DUE',
        payments: [],
        reversals: [],
      });
      expect(JSON.stringify(body.data.buyer_refund)).not.toMatch(
        /object_key|permanent_url|signed_url|seller_settlement/iu,
      );
    } finally {
      base.close();
    }
  });
});
