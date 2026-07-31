import { describe, expect, it } from 'vitest';
import {
  FILE_ENTITY_TYPES,
  FILE_PURPOSES,
  FILE_VISIBILITIES,
  isFileEntityType,
  isFilePurpose,
  isFileVisibility,
  isSupportedFileMime,
} from './file-storage';

describe('file storage contracts', () => {
  it('publishes the frozen purpose and visibility values', () => {
    expect(FILE_PURPOSES).toEqual([
      'PRODUCT_APPLICATION_IMAGE',
      'ORDER_EVIDENCE',
      'REVIEW_EVIDENCE',
      'BUYER_REFUND_PROOF',
      'SELLER_SETTLEMENT_PROOF',
      'SUPPORT_ATTACHMENT',
    ]);
    expect(FILE_VISIBILITIES).toEqual([
      'INTERNAL_ONLY',
      'BUYER_VISIBLE',
      'SELLER_VISIBLE',
    ]);
    expect(FILE_ENTITY_TYPES).toHaveLength(6);
  });

  it('rejects unpublished values', () => {
    expect(isFilePurpose('ORDER_IMAGE')).toBe(false);
    expect(isFileVisibility('PUBLIC')).toBe(false);
    expect(isFileEntityType('PAYMENT')).toBe(false);
    expect(isSupportedFileMime('image/svg+xml')).toBe(false);
    expect(isSupportedFileMime('text/html')).toBe(false);
  });
});
