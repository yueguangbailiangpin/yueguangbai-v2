import {
  FILE_HTTP_PURPOSE_ROUTES,
  type FilePurpose,
  type FileVisibility,
  type SupportedFileMime,
} from '@ygb/contracts';
import type { RequestIdentity } from '../api/identity-request';

export const MEBIBYTE = 1024 * 1024;

export const FILE_UPLOAD_WORKFLOW_KEYS = [
  'buyerOrderEvidence',
  'buyerReviewEvidence',
  'sellerProductApplicationImage',
  'staffBuyerRefundProof',
  'staffSellerSettlementProof',
  'staffSellerOrderChatScreenshot',
] as const;

export type FileUploadWorkflowKey = typeof FILE_UPLOAD_WORKFLOW_KEYS[number];

export type FileUploadWorkflow = Readonly<{
  identity: RequestIdentity;
  intentPath: `/api/${string}`;
  lifecyclePrefix: '/api/buyer-portal' | '/api/seller-portal' | '/api/staff';
  purpose: FilePurpose;
  visibility: FileVisibility;
  maximumFileCount: number;
  maximumByteSize: number;
  allowedMimes: readonly SupportedFileMime[];
}>;

const IMAGE_MIMES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
] as const satisfies readonly SupportedFileMime[]);
const EVIDENCE_MIMES = Object.freeze([
  ...IMAGE_MIMES,
  'application/pdf',
] as const satisfies readonly SupportedFileMime[]);

export const fileUploadWorkflows = Object.freeze({
  buyerOrderEvidence: Object.freeze({
    identity: 'buyer',
    intentPath: FILE_HTTP_PURPOSE_ROUTES.buyerOrderEvidence.path,
    lifecyclePrefix: '/api/buyer-portal',
    purpose: 'ORDER_EVIDENCE',
    visibility: 'BUYER_VISIBLE',
    maximumFileCount: 1,
    maximumByteSize: 20 * MEBIBYTE,
    allowedMimes: IMAGE_MIMES,
  }),
  buyerReviewEvidence: Object.freeze({
    identity: 'buyer',
    intentPath: FILE_HTTP_PURPOSE_ROUTES.buyerReviewEvidence.path,
    lifecyclePrefix: '/api/buyer-portal',
    purpose: 'REVIEW_EVIDENCE',
    visibility: 'SELLER_VISIBLE',
    maximumFileCount: 10,
    maximumByteSize: 20 * MEBIBYTE,
    allowedMimes: EVIDENCE_MIMES,
  }),
  sellerProductApplicationImage: Object.freeze({
    identity: 'seller',
    intentPath: FILE_HTTP_PURPOSE_ROUTES.sellerProductApplicationImage.path,
    lifecyclePrefix: '/api/seller-portal',
    purpose: 'PRODUCT_APPLICATION_IMAGE',
    visibility: 'SELLER_VISIBLE',
    maximumFileCount: 8,
    maximumByteSize: 10 * MEBIBYTE,
    allowedMimes: IMAGE_MIMES,
  }),
  staffBuyerRefundProof: Object.freeze({
    identity: 'staff',
    intentPath: FILE_HTTP_PURPOSE_ROUTES.staffBuyerRefundProof.path,
    lifecyclePrefix: '/api/staff',
    purpose: 'BUYER_REFUND_PROOF',
    visibility: 'INTERNAL_ONLY',
    maximumFileCount: 6,
    maximumByteSize: 20 * MEBIBYTE,
    allowedMimes: EVIDENCE_MIMES,
  }),
  staffSellerSettlementProof: Object.freeze({
    identity: 'staff',
    intentPath: FILE_HTTP_PURPOSE_ROUTES.staffSellerSettlementProof.path,
    lifecyclePrefix: '/api/staff',
    purpose: 'SELLER_SETTLEMENT_PROOF',
    visibility: 'INTERNAL_ONLY',
    maximumFileCount: 6,
    maximumByteSize: 20 * MEBIBYTE,
    allowedMimes: EVIDENCE_MIMES,
  }),
  staffSellerOrderChatScreenshot: Object.freeze({
    identity: 'staff',
    intentPath: FILE_HTTP_PURPOSE_ROUTES.staffSellerOrderChatScreenshot.path,
    lifecyclePrefix: '/api/staff',
    purpose: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
    visibility: 'SELLER_VISIBLE',
    maximumFileCount: 1,
    maximumByteSize: 20 * MEBIBYTE,
    allowedMimes: IMAGE_MIMES,
  }),
} as const satisfies Record<FileUploadWorkflowKey, FileUploadWorkflow>);

export function isFileUploadWorkflowKey(
  value: unknown,
): value is FileUploadWorkflowKey {
  return typeof value === 'string'
    && (FILE_UPLOAD_WORKFLOW_KEYS as readonly string[]).includes(value);
}

export function requireFileUploadWorkflow(
  value: unknown,
): FileUploadWorkflow {
  if (!isFileUploadWorkflowKey(value)) throw new TypeError('unsupported_file_upload_workflow');
  return fileUploadWorkflows[value];
}
