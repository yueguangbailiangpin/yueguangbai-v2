import type {
  FileEntityType,
  FilePurpose,
  SupportedFileMime,
} from '@ygb/contracts';

export const MEBIBYTE = 1024 * 1024;

export interface FilePurposePolicy {
  maximumFileCount: number;
  maximumByteSize: number;
  allowedMimes: readonly SupportedFileMime[];
  entityType: FileEntityType;
}

const IMAGE_MIMES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
] as const satisfies readonly SupportedFileMime[]);

const EVIDENCE_MIMES = Object.freeze([
  ...IMAGE_MIMES,
  'application/pdf',
] as const satisfies readonly SupportedFileMime[]);

const PURPOSE_POLICIES: Readonly<Record<FilePurpose, FilePurposePolicy>> =
  Object.freeze({
    PRODUCT_APPLICATION_IMAGE: Object.freeze({
      maximumFileCount: 8,
      maximumByteSize: 10 * MEBIBYTE,
      allowedMimes: IMAGE_MIMES,
      entityType: 'PRODUCT_APPLICATION',
    }),
    PRODUCT_IMAGE: Object.freeze({
      maximumFileCount: 1,
      maximumByteSize: 10 * MEBIBYTE,
      allowedMimes: IMAGE_MIMES,
      entityType: 'PRODUCT_VERSION',
    }),
    ORDER_INSTRUCTION_KEYWORD_IMAGE: Object.freeze({
      maximumFileCount: 1,
      maximumByteSize: 10 * MEBIBYTE,
      allowedMimes: IMAGE_MIMES,
      entityType: 'ORDER_INSTRUCTION_VERSION',
    }),
    ORDER_EVIDENCE: Object.freeze({
      maximumFileCount: 1,
      maximumByteSize: 20 * MEBIBYTE,
      allowedMimes: IMAGE_MIMES,
      entityType: 'ORDER',
    }),
    ORDER_EVIDENCE_INTERNAL_COMMUNICATION: Object.freeze({
      maximumFileCount: 1,
      maximumByteSize: 20 * MEBIBYTE,
      allowedMimes: IMAGE_MIMES,
      entityType: 'ORDER_EVIDENCE_SUBMISSION',
    }),
    REVIEW_EVIDENCE: Object.freeze({
      maximumFileCount: 10,
      maximumByteSize: 20 * MEBIBYTE,
      allowedMimes: EVIDENCE_MIMES,
      entityType: 'REVIEW',
    }),
    BUYER_REFUND_PROOF: Object.freeze({
      maximumFileCount: 6,
      maximumByteSize: 20 * MEBIBYTE,
      allowedMimes: EVIDENCE_MIMES,
      entityType: 'BUYER_REFUND',
    }),
    SELLER_SETTLEMENT_PROOF: Object.freeze({
      maximumFileCount: 6,
      maximumByteSize: 20 * MEBIBYTE,
      allowedMimes: EVIDENCE_MIMES,
      entityType: 'SELLER_SETTLEMENT',
    }),
    SUPPORT_ATTACHMENT: Object.freeze({
      maximumFileCount: 10,
      maximumByteSize: 25 * MEBIBYTE,
      allowedMimes: EVIDENCE_MIMES,
      entityType: 'SUPPORT_CASE',
    }),
  });

export function filePurposePolicy(
  purpose: FilePurpose,
): FilePurposePolicy {
  return PURPOSE_POLICIES[purpose];
}

export function filePurposeEntityType(
  purpose: FilePurpose,
): FileEntityType {
  return filePurposePolicy(purpose).entityType;
}
