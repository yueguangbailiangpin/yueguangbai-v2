import { describe, expect, it } from 'vitest';
import {
  FILE_ENTITY_TYPES,
  FILE_AUDIENCE_SUBJECT_TYPES,
  FILE_LINK_AUTHORIZATION_MODES,
  FILE_PURPOSES,
  FILE_VISIBILITIES,
  isFileEntityType,
  isFileLinkAuthorizationMode,
  isFilePurpose,
  isFileVisibility,
  isSupportedFileMime,
  ObjectStoragePutFailure,
  objectStoragePutMayHaveStored,
} from './file-storage';

describe('file storage contracts', () => {
  it('publishes the frozen purpose and visibility values', () => {
    expect(FILE_PURPOSES).toEqual([
      'PRODUCT_APPLICATION_IMAGE',
      'PRODUCT_IMAGE',
      'ORDER_INSTRUCTION_KEYWORD_IMAGE',
      'ORDER_EVIDENCE',
      'ORDER_COMMUNICATION_SCREENSHOT',
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
    expect(FILE_ENTITY_TYPES).toEqual([
      'PRODUCT_APPLICATION',
      'PRODUCT_VERSION',
      'ORDER_INSTRUCTION_VERSION',
      'ORDER',
      'ORDER_EVIDENCE_SUBMISSION',
      'REVIEW',
      'BUYER_REFUND',
      'SELLER_SETTLEMENT',
      'SUPPORT_CASE',
    ]);
    expect(FILE_LINK_AUTHORIZATION_MODES).toEqual([
      'LEGACY_VISIBILITY',
      'EXPLICIT_AUDIENCES',
    ]);
    expect(FILE_AUDIENCE_SUBJECT_TYPES).toEqual([
      'BUYER',
      'SELLER_ORGANIZATION',
      'STAFF_INTERNAL',
    ]);
  });

  it('publishes only the two new formal product-file values', () => {
    expect(isFilePurpose('PRODUCT_IMAGE')).toBe(true);
    expect(isFileEntityType('PRODUCT_VERSION')).toBe(true);
    expect(isFilePurpose('ORDER_IMAGE')).toBe(false);
    expect(isFileVisibility('PUBLIC')).toBe(false);
    expect(isFileLinkAuthorizationMode('BOTH')).toBe(false);
    expect(isFileLinkAuthorizationMode('EXPLICIT_AUDIENCES')).toBe(true);
    expect(isFileEntityType('PAYMENT')).toBe(false);
    expect(isSupportedFileMime('image/svg+xml')).toBe(false);
    expect(isSupportedFileMime('text/html')).toBe(false);
  });

  it('marks only explicit ambiguous PUT failures as possibly stored', () => {
    expect(objectStoragePutMayHaveStored(
      new ObjectStoragePutFailure('ambiguous', true),
    )).toBe(true);
    expect(objectStoragePutMayHaveStored(
      new ObjectStoragePutFailure('rejected', false),
    )).toBe(false);
    expect(objectStoragePutMayHaveStored(new Error('unknown'))).toBe(false);
  });
});
