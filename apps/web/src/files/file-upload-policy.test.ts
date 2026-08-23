// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  assertCompleteMatchesIntent,
  assertIntentMatchesWorkflow,
  completeUploadResponseSchema,
  uploadContentResponseSchema,
  uploadIntentRequestSchema,
  uploadIntentResponseSchema,
} from './file-contracts';
import { descriptorForFile, validateFileSelection } from './file-descriptor';
import {
  FILE_UPLOAD_WORKFLOW_KEYS,
  MEBIBYTE,
  fileUploadWorkflows,
  requireFileUploadWorkflow,
} from './file-purpose-config';
import { initialFileUploadSnapshot } from './file-upload-operation';
import {
  assertFileUploadTransition,
  FileUploadTransitionError,
} from './file-transfer-machine';
import { measuredUploadProgress } from './file-upload-transport';

const png = (name = 'proof.png', size = 4) => {
  const file = new File([new Uint8Array(size)], name, {
    type: 'image/png', lastModified: 1_700_000_000_000,
  });
  return file;
};

describe('purpose-bound frontend file policies', () => {
  it('freezes the public workflow keys and no generic selector', () => {
    expect(FILE_UPLOAD_WORKFLOW_KEYS).toEqual([
      'buyerOrderEvidence',
      'buyerReviewEvidence',
      'sellerProductApplicationImage',
      'staffBuyerRefundProof',
      'staffBuyerChatScreenshot',
      'staffSellerSettlementProof',
      'staffSellerOrderChatScreenshot',
      'staffProductImage',
    ]);
    expect(Object.keys(fileUploadWorkflows)).toEqual(FILE_UPLOAD_WORKFLOW_KEYS);
    expect(() => requireFileUploadWorkflow('ORDER_EVIDENCE')).toThrow();
    expect(() => requireFileUploadWorkflow('buyerOrderEvidence')).not.toThrow();
    expect(fileUploadWorkflows.staffSellerOrderChatScreenshot.purpose)
      .toBe('ORDER_EVIDENCE_INTERNAL_COMMUNICATION');
  });

  it.each([
    ['buyerOrderEvidence', 'buyer', '/api/buyer-portal/file-uploads/order-evidence/intents', 'ORDER_EVIDENCE', 'BUYER_VISIBLE', 1, 5],
    ['buyerReviewEvidence', 'buyer', '/api/buyer-portal/file-uploads/review-evidence/intents', 'REVIEW_EVIDENCE', 'SELLER_VISIBLE', 10, 20],
    ['sellerProductApplicationImage', 'seller', '/api/seller-portal/file-uploads/product-application-images/intents', 'PRODUCT_APPLICATION_IMAGE', 'SELLER_VISIBLE', 8, 5],
    ['staffBuyerRefundProof', 'staff', '/api/staff/file-uploads/buyer-refund-proofs/intents', 'BUYER_REFUND_PROOF', 'INTERNAL_ONLY', 6, 20],
    ['staffSellerSettlementProof', 'staff', '/api/staff/file-uploads/seller-settlement-proofs/intents', 'SELLER_SETTLEMENT_PROOF', 'INTERNAL_ONLY', 6, 20],
    ['staffSellerOrderChatScreenshot', 'staff', '/api/staff/file-uploads/seller-order-chat-screenshots/intents', 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION', 'SELLER_VISIBLE', 1, 5],
    ['staffProductImage', 'staff', '/api/staff/file-uploads/product-images/intents', 'PRODUCT_IMAGE', 'SELLER_VISIBLE', 1, 5],
  ] as const)('%s matches the frozen route and policy', (
    key, identity, path, purpose, visibility, count, mib,
  ) => {
    expect(fileUploadWorkflows[key]).toMatchObject({
      identity, intentPath: path, purpose, visibility,
      maximumFileCount: count, maximumByteSize: mib * MEBIBYTE,
    });
  });
});

describe('local file selection and descriptor validation', () => {
  it.each([
    ['photo.jpg', 'image/jpeg', 'jpg'],
    ['photo.jpeg', 'image/jpeg', 'jpeg'],
    ['photo.png', 'image/png', 'png'],
    ['photo.webp', 'image/webp', 'webp'],
  ] as const)('accepts %s as %s', (name, type, extension) => {
    const file = new File(['safe'], name, { type, lastModified: 1 });
    expect(descriptorForFile(fileUploadWorkflows.buyerReviewEvidence, file)).toEqual({
      client_file_name: name,
      extension,
      declared_mime: type,
      byte_size: 4,
    });
  });

  it.each([
    ['buyerReviewEvidence', true],
    ['staffBuyerRefundProof', true],
    ['staffSellerSettlementProof', true],
    ['buyerOrderEvidence', false],
    ['sellerProductApplicationImage', false],
    ['staffSellerOrderChatScreenshot', false],
  ] as const)('%s PDF allowance is %s', (key, allowed) => {
    const action = () => descriptorForFile(
      fileUploadWorkflows[key],
      new File(['%PDF-safe'], 'proof.pdf', { type: 'application/pdf' }),
    );
    if (allowed) expect(action).not.toThrow();
    else expect(action).toThrow();
  });

  it.each([
    ['empty MIME', new File(['x'], 'proof.png', { type: '' })],
    ['MIME mismatch', new File(['x'], 'proof.png', { type: 'image/jpeg' })],
    ['extension mismatch', new File(['x'], 'proof.txt', { type: 'image/png' })],
    ['empty file', new File([], 'proof.png', { type: 'image/png' })],
    ['double extension', new File(['x'], 'proof.safe.png', { type: 'image/png' })],
  ])('rejects %s before transport', (_label, file) => {
    expect(() => validateFileSelection(fileUploadWorkflows.buyerReviewEvidence, [file]))
      .toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('rejects over-size, over-count, and ORDER_EVIDENCE multi-file selection', () => {
    const large = png();
    Object.defineProperty(large, 'size', { value: 20 * MEBIBYTE + 1 });
    expect(() => validateFileSelection(fileUploadWorkflows.buyerOrderEvidence, [large])).toThrow();
    expect(() => validateFileSelection(
      fileUploadWorkflows.buyerReviewEvidence,
      Array.from({ length: 11 }, (_, index) => png(`proof-${index}.png`)),
    )).toThrow();
    expect(() => validateFileSelection(
      fileUploadWorkflows.buyerOrderEvidence,
      [png('one.png'), png('two.png')],
    )).toThrow();
  });

  it('rejects the same File object and descriptor fingerprint without reading bytes', () => {
    const same = png();
    expect(() => validateFileSelection(fileUploadWorkflows.buyerReviewEvidence, [same, same]))
      .toThrowError(expect.objectContaining({ safeDetails: { field: 'files', reason: 'duplicate_file_object' } }));
    expect(() => validateFileSelection(fileUploadWorkflows.buyerReviewEvidence, [png(), png()]))
      .toThrowError(expect.objectContaining({ safeDetails: { field: 'files', reason: 'duplicate_file_descriptor' } }));
  });
});

describe('strict upload runtime contracts', () => {
  const intent = {
    upload_intent_id: 'intent-1', purpose: 'ORDER_EVIDENCE', visibility: 'BUYER_VISIBLE',
    status: 'ISSUED', version: 1, expires_at: 1,
    uploads: [{
      file_object_id: 'file-1', slot_no: 1, upload_token: 't'.repeat(32),
      upload_token_available: true, expires_at: 1,
    }], replayed: false,
  } as const;
  const complete = {
    upload_intent_id: 'intent-1', status: 'VERIFIED', version: 2,
    files: [{
      file_object_id: 'file-1', purpose: 'ORDER_EVIDENCE', visibility: 'BUYER_VISIBLE',
      detected_mime: 'image/png', byte_size: 4, sha256: 'a'.repeat(64), version: 2,
    }], replayed: false,
  } as const;

  it('accepts exact Intent, Upload, and Complete DTOs', () => {
    expect(uploadIntentResponseSchema.parse(intent)).toEqual(intent);
    expect(uploadContentResponseSchema.safeParse({
      file_object_id: 'file-1', upload_intent_id: 'intent-1', status: 'UPLOADED',
      detected_mime: 'image/png', byte_size: 4, sha256: 'a'.repeat(64), version: 2,
      replayed: false,
    }).success).toBe(true);
    expect(completeUploadResponseSchema.parse(complete)).toEqual(complete);
  });

  it.each([
    ['unknown request member', { files: [{ client_file_name: 'a.png', extension: 'png', declared_mime: 'image/png', byte_size: 1 }], purpose: 'ORDER_EVIDENCE' }],
    ['zero version', { ...intent, version: 0 }],
    ['unsafe time', { ...intent, expires_at: Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid digest', { ...complete, files: [{ ...complete.files[0], sha256: 'not-a-digest' }] }],
    ['storage authority', { ...complete, storageAuthority: 'private' }],
  ])('rejects %s', (label, value) => {
    const schema = label === 'unknown request member'
      ? uploadIntentRequestSchema
      : label === 'invalid digest' || label === 'storage authority'
        ? completeUploadResponseSchema
        : uploadIntentResponseSchema;
    expect(schema.safeParse(value).success).toBe(false);
  });

  it('rejects Purpose/Visibility, duplicate slots, unknown manifest IDs, and count mismatch', () => {
    const uploadedReceipts = new Map([['file-1', {
      detectedMime: 'image/png' as const,
      byteSize: 4,
      sha256: 'a'.repeat(64),
      uploadedVersion: 2,
    }]]);
    expect(() => assertIntentMatchesWorkflow(
      uploadIntentResponseSchema.parse({ ...intent, visibility: 'SELLER_VISIBLE' }),
      fileUploadWorkflows.buyerOrderEvidence,
      1,
    )).toThrow();
    expect(() => assertIntentMatchesWorkflow(
      { ...intent, uploads: [intent.uploads[0], intent.uploads[0]] },
      fileUploadWorkflows.buyerReviewEvidence,
      2,
    )).toThrow();
    expect(() => assertCompleteMatchesIntent(
      { ...complete, files: [{ ...complete.files[0], file_object_id: 'file-unknown' }] },
      {
        intentId: 'intent-1', intentVersion: 1,
        workflow: fileUploadWorkflows.buyerOrderEvidence, uploadedReceipts,
      },
    )).toThrow();
    expect(() => assertCompleteMatchesIntent(
      { ...complete, files: [] },
      {
        intentId: 'intent-1', intentVersion: 1,
        workflow: fileUploadWorkflows.buyerOrderEvidence, uploadedReceipts,
      },
    )).toThrow();
  });

  it('reports only computable bounded upload progress and never invents bytes', () => {
    expect(measuredUploadProgress({ lengthComputable: true, loaded: 25, total: 100 })).toEqual({
      mode: 'DETERMINATE', loadedBytes: 25, totalBytes: 100, percent: 25,
    });
    expect(measuredUploadProgress({ lengthComputable: true, loaded: 150, total: 100 })).toEqual({
      mode: 'DETERMINATE', loadedBytes: 100, totalBytes: 100, percent: 100,
    });
    expect(measuredUploadProgress({ lengthComputable: false, loaded: 25, total: 100 })).toEqual({
      mode: 'INDETERMINATE', loadedBytes: null, totalBytes: null, percent: null,
    });
  });

  it.each([
    ['VERIFIED', 'CANCELED'],
    ['COMPLETING', 'CANCELED'],
    ['FILE_COMPENSATION_REQUIRED', 'VERIFIED'],
  ] as const)('the authoritative transition table rejects %s → %s', (from, to) => {
    expect(() => assertFileUploadTransition(
      { ...initialFileUploadSnapshot, state: from },
      { ...initialFileUploadSnapshot, state: to },
    )).toThrow(FileUploadTransitionError);
  });
});
