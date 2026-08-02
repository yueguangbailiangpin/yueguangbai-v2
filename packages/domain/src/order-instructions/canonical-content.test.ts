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
  orderedKeywordHmacDigests: ['d'.repeat(64), 'e'.repeat(64)],
  keywordImageSha256: ['a'.repeat(64), 'b'.repeat(64)],
  generatorVersion: 'generator-v1',
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
    ['keyword HMAC order', {
      orderedKeywordHmacDigests:
        [...base.orderedKeywordHmacDigests].reverse(),
    }],
    ['keyword order', { keywordImageSha256: [...base.keywordImageSha256].reverse() }],
    ['reference amount', { referenceOrderAmountJpy: 9999 }],
  ] as const)('changes when %s changes', async (_name, patch) => {
    expect(await orderInstructionContentHash({ ...base, ...patch })).not.toBe(
      await orderInstructionContentHash(base),
    );
  });
});
