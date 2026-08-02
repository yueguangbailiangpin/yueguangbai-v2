import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  API_ERROR_HTTP_STATUS,
  STAFF_ORDER_EVIDENCE_PATHS,
} from '@ygb/contracts';
import { exactOneOrderEvidenceScreenshotGuard } from './http-one-screenshot-guard';

const root = path.resolve(process.cwd());
const source = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

async function guarded(fileObjectIds: unknown): Promise<Response> {
  const app = new Hono();
  app.use('*', exactOneOrderEvidenceScreenshotGuard());
  app.post('*', (context) => context.json({ ok: true }));
  return app.request('https://example.test/order-evidence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_object_ids: fileObjectIds }),
  });
}

describe('Wave 13 Staff Order Evidence API', () => {
  it('enforces exactly one screenshot at the HTTP boundary', async () => {
    expect((await guarded([])).status).toBe(400);
    expect((await guarded(['file-a', 'file-b'])).status).toBe(400);
    expect((await guarded(['file-a'])).status).toBe(200);
    expect((await guarded(['file-a', 'file-a'])).status).toBe(400);
    const domain = source('apps/api/src/order-evidence/order-evidence-shared.ts');
    expect(domain).toContain('values.length !== 1');
  });

  it('registers only canonical /api Staff Order Evidence paths', () => {
    for (const route of Object.values(STAFF_ORDER_EVIDENCE_PATHS)) {
      expect(route).toMatch(/^\/api\/staff\/order-evidence/u);
      expect(route).not.toContain('/api/v2/');
    }
  });

  it('keeps approval as one top-level D1 batch without nested public commands', () => {
    const approval = source(
      'apps/api/src/order-evidence/approve-order-evidence.ts',
    );
    expect(approval).toContain('database.batch(statements)');
    expect(approval).not.toContain('verifyOrderEvidence(');
    expect(approval).not.toContain('confirmFormalOrder(');
    expect(approval).toContain("action: 'APPROVE_ORDER_EVIDENCE'");
    expect(approval).toContain('completeIdempotencyStatement');
    expect(approval).toContain('finalizeOrderNumberClaimStatement');
    expect(approval).toContain('prepareSellerPayableCreation');
    expect(approval).toContain('completeFormalInstructionStatements');
    expect(approval).toContain('prepareWorkItemCompletionStatements');
  });

  it('freezes every PRICE_MISMATCH decision and request-hash input', () => {
    const approval = source(
      'apps/api/src/order-evidence/approve-order-evidence.ts',
    );
    expect(API_ERROR_HTTP_STATUS.PRICE_MISMATCH).toBe(409);
    expect(approval).toContain("'PRICE_MISMATCH', 409");
    expect(approval).toContain('price_mismatch_acknowledged: acknowledged ?? null');
    expect(approval).toContain('price_mismatch_reason: normalizedReason');
    expect(approval).toContain('if (input.acknowledged !== true)');
    expect(approval).toContain('if (!input.reason)');
    expect(approval).toContain('input.acknowledged === true || input.reason !== null');
    expect(approval).toContain('reference_order_amount_jpy');
    expect(approval).toContain('final_paid_jpy');
    expect(approval).toContain('price_difference_jpy');
    expect(approval).toContain('confirmed_by_staff_id');
  });

  it('uses final_paid_jpy for the formal order and snapshot math', () => {
    const approval = source(
      'apps/api/src/order-evidence/approve-order-evidence.ts',
    );
    expect(approval).toContain('const finalPaidJpy = parseJpyInteger');
    expect(approval).toContain('calculateBuyerFormalFinancials({');
    expect(approval).toContain('finalPaidJpy: source.final_paid_jpy');
    expect(approval).toContain('sellerExpectedPrincipal = convertJpyToCnyFen');
    expect(approval).not.toContain(
      'finalPaidJpy: source.reference_order_amount_jpy',
    );
  });

  it('keeps mismatch reason out of Buyer DTOs', () => {
    const buyerRoutes = source(
      'apps/api/src/buyer-order-evidence-portal/routes.ts',
    );
    const buyerContracts = source(
      'packages/contracts/src/buyer-order-evidence-portal.ts',
    );
    expect(`${buyerRoutes}\n${buyerContracts}`).not.toContain(
      'price_mismatch_reason',
    );
    expect(`${buyerRoutes}\n${buyerContracts}`).not.toContain(
      'internal_review_note',
    );
  });
});
