import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAFF_BUYER_REFUND_PATHS } from '@ygb/contracts';

const root = path.resolve(process.cwd());
const source = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

describe('Wave 13 Staff Buyer Refund API', () => {
  it('registers canonical Staff routes and dedicated permissions', () => {
    for (const route of Object.values(STAFF_BUYER_REFUND_PATHS)) {
      expect(route).toMatch(/^\/api\/staff\/buyer-refunds/u);
      expect(route).not.toContain('/api/v2/');
    }
    const routes = source('apps/api/src/buyer-refunds/staff-routes.ts');
    expect(routes).toContain('BUYER_REFUND_VIEW');
    expect(routes).toContain('BUYER_REFUND_RECORD');
    expect(routes).not.toContain('SELLER_SETTLEMENT_VIEW');
    expect(routes).not.toContain('SELLER_SETTLEMENT_RECORD');
    expect(routes).not.toContain('FINANCIAL_VIEW');
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
    expect(payment).toContain("expectedPurpose: 'BUYER_REFUND_PROOF'");
    expect(payment).toContain("expectedVisibility: 'INTERNAL_ONLY'");
    expect(payment).toContain("entityType: 'BUYER_REFUND'");
    expect(payment).toContain("audienceType: 'STAFF_INTERNAL'");
    expect(payment).toContain("permissionCode: 'BUYER_REFUND_VIEW'");
    expect(routes).not.toContain('object_key');
    expect(routes).not.toContain('permanent_url');
  });

  it('keeps Seller projections isolated from Buyer Refund cost and proof', () => {
    const sellerFiles = [
      'apps/api/src/seller-portal/routes.ts',
      'apps/api/src/seller-settlements/routes.ts',
      'packages/contracts/src/seller-portal.ts',
      'packages/contracts/src/seller-settlement.ts',
    ].map(source).join('\n');
    for (const forbidden of [
      'buyer_refund_payment_entries',
      'BUYER_REFUND_PROOF',
      'buyer_refund_internal_note',
    ]) expect(sellerFiles).not.toContain(forbidden);
  });
});
