import { describe, expect, it } from 'vitest';
import { orderInstructionContentHash } from './canonical-content';

const base = {
  reservationId: 'reservation-1',
  productVersionId: 'product-version-1',
  productVersionNo: 1,
  productName: 'Product',
  mainImageFileObjectId: 'main-image-1',
  mainImageSha256: 'c'.repeat(64),
  storeDisplayName: 'Store',
  buyerVisibleNotes: null,
  staffPublicNote: null,
  referenceOrderAmountJpy: 10_000,
  buyerSelfPayBps: 1000,
  colorSpecMode: 'MAIN_IMAGE_VARIANT' as const,
  orderedKeywords: ['coffee scale', 'コーヒースケール'],
};

describe('instruction canonical content hash', () => {
  it('is stable for identical content', async () => {
    expect(await orderInstructionContentHash(base)).toBe(
      await orderInstructionContentHash({ ...base }),
    );
  });

  it.each([
    ['staff note', { staffPublicNote: 'updated' }],
    ['main image', { mainImageFileObjectId: 'main-image-2' }],
    ['product name', { productName: 'Updated Product' }],
    ['main image hash', { mainImageSha256: 'f'.repeat(64) }],
    ['keyword order', { orderedKeywords: [...base.orderedKeywords].reverse() }],
    ['reference amount', { referenceOrderAmountJpy: 9999 }],
  ] as const)('changes when %s changes', async (_name, patch) => {
    expect(await orderInstructionContentHash({ ...base, ...patch })).not.toBe(
      await orderInstructionContentHash(base),
    );
  });
});
