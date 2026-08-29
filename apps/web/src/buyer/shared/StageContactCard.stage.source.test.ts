import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Stage 7.5R source guard: every buyer stage page takes its contact stage
 * from the single authoritative STAGE_FOR_ROUTE map — pages must not decide
 * PRE_SALES/AFTER_SALES locally, and no page may pass a literal stage prop.
 */

const root = path.resolve(import.meta.dirname, '../../../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const PAGE_EXPECTATIONS: ReadonlyArray<readonly [string, string]> = [
  ['apps/web/src/buyer/reservations/BuyerReservationsPage.tsx', '/buyer/reservations'],
  ['apps/web/src/buyer/reservations/BuyerReservationDetailPage.tsx', '/buyer/reservations'],
  ['apps/web/src/buyer/instructions/BuyerInstructionPage.tsx', '/buyer/reservations'],
  ['apps/web/src/buyer/order-evidence/BuyerOrderMaterialsPage.tsx', '/buyer/order-materials'],
  ['apps/web/src/buyer/order-evidence/BuyerOrderEvidenceFormPage.tsx', '/buyer/order-materials'],
  ['apps/web/src/buyer/order-evidence/BuyerOrderEvidenceDetailPage.tsx', '/buyer/order-materials'],
  ['apps/web/src/buyer/formal-orders/BuyerFormalOrdersPage.tsx', '/buyer/orders'],
  ['apps/web/src/buyer/formal-orders/BuyerFormalOrderDetailPage.tsx', '/buyer/orders'],
  ['apps/web/src/buyer/reviews/BuyerReviewsPage.tsx', '/buyer/reviews'],
  ['apps/web/src/buyer/reviews/BuyerReviewFormPage.tsx', '/buyer/reviews'],
  ['apps/web/src/buyer/reviews/BuyerReviewDetailPage.tsx', '/buyer/reviews'],
  ['apps/web/src/buyer/refunds/BuyerRefundsPage.tsx', '/buyer/refunds'],
  ['apps/web/src/buyer/refunds/BuyerRefundDetailPage.tsx', '/buyer/refunds'],
];

describe('buyer stage contact card stage selection', () => {
  it('maps every route family to the authoritative stage', () => {
    const card = read('apps/web/src/buyer/shared/StageContactCard.tsx');
    expect(card).toContain("'/buyer/reservations': 'PRE_SALES'");
    expect(card).toContain("'/buyer/order-materials': 'PRE_SALES'");
    expect(card).toContain("'/buyer/orders': 'AFTER_SALES'");
    expect(card).toContain("'/buyer/reviews': 'AFTER_SALES'");
    expect(card).toContain("'/buyer/refunds': 'AFTER_SALES'");
    expect(card).toContain('Record<RouteFamily, ContactStage>');
  });

  it('every stage page imports the card and passes the family stage', () => {
    for (const [file, family] of PAGE_EXPECTATIONS) {
      const source = read(file);
      expect(source, file).toContain('StageContactCard');
      expect(source, file).toContain(`STAGE_FOR_ROUTE['${family}']`);
      // Pages must never hardcode the stage or invent a local mapping.
      expect(source, file).not.toMatch(/stage=("|')(?:PRE_SALES|AFTER_SALES)\1/u);
      expect(source, file).not.toMatch(/===\s*('|")PRE_SALES\1/u);
      expect(source, file).not.toMatch(/===\s*('|")AFTER_SALES\1/u);
    }
  });

  it('renders the QR only through the controlled SafeFileReference chain', () => {
    const card = read('apps/web/src/buyer/shared/StageContactCard.tsx');
    expect(card).toContain('<ProtectedImage');
    expect(card).not.toContain('qr_file_object_id');
    // Stage 7.5R-2: the channel + SafeFileReference runtime schema is the
    // single shared contract in `@ygb/contracts`; the buyer runtime only
    // re-exports it and must not re-declare a local copy.
    const runtime = read('apps/web/src/buyer/contracts/runtime.ts');
    expect(runtime).toContain("from '@ygb/contracts'");
    expect(runtime).toContain('buyerServiceChannelsResponseSchema as buyerServiceChannelsSchema');
    expect(runtime).not.toContain('qr_file: z.object');
    expect(runtime).not.toContain("z.literal('SERVICE_CHANNEL_QR')");
    expect(runtime).not.toContain('qr_file_object_id');
    const shared = read('packages/contracts/src/runtime-schemas.ts');
    expect(shared).toContain('qr_file: safeFileReferenceSchema.nullable()');
  });
});
