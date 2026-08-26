import type {
  FilePurpose,
  FileVisibility,
  SupportedFileMime,
} from './file-storage';

export const FILE_HTTP_PURPOSE_ROUTES = Object.freeze({
  buyerOrderEvidence: {
    path: '/api/buyer-portal/file-uploads/order-evidence/intents',
    purpose: 'ORDER_EVIDENCE',
    visibility: 'BUYER_VISIBLE',
  },
  buyerReviewEvidence: {
    path: '/api/buyer-portal/file-uploads/review-evidence/intents',
    purpose: 'REVIEW_EVIDENCE',
    visibility: 'SELLER_VISIBLE',
  },
  sellerProductApplicationImage: {
    path: '/api/seller-portal/file-uploads/product-application-images/intents',
    purpose: 'PRODUCT_APPLICATION_IMAGE',
    visibility: 'SELLER_VISIBLE',
  },
  staffBuyerRefundProof: {
    path: '/api/staff/file-uploads/buyer-refund-proofs/intents',
    purpose: 'BUYER_REFUND_PROOF',
    visibility: 'INTERNAL_ONLY',
  },
  staffSellerSettlementProof: {
    path: '/api/staff/file-uploads/seller-settlement-proofs/intents',
    purpose: 'SELLER_SETTLEMENT_PROOF',
    visibility: 'INTERNAL_ONLY',
  },
  staffProductImage: {
    path: '/api/staff/file-uploads/product-images/intents',
    purpose: 'PRODUCT_IMAGE',
    visibility: 'SELLER_VISIBLE',
  },
} as const satisfies Record<string, {
  path: string;
  purpose: FilePurpose;
  visibility: FileVisibility;
}>);

/** Kept as a compatibility export; the former deferred purpose is now active. */
export const WAVE13_DEFERRED_FILE_PURPOSES = Object.freeze(
  [] as const satisfies readonly FilePurpose[],
);

export interface FileHttpUploadDescriptor {
  client_file_name: string;
  extension: string;
  declared_mime: SupportedFileMime;
  byte_size: number;
}

export interface PurposeBoundFileUploadIntentRequest {
  files: readonly FileHttpUploadDescriptor[];
}

export interface FileHttpUploadSlotSafeDto {
  file_object_id: string;
  slot_no: number;
  upload_token: string | null;
  upload_token_available: boolean;
  expires_at: number;
}

export interface FileHttpUploadIntentSafeDto {
  upload_intent_id: string;
  purpose: FilePurpose;
  visibility: FileVisibility;
  status: 'ISSUED';
  version: number;
  expires_at: number;
  uploads: readonly FileHttpUploadSlotSafeDto[];
  replayed: boolean;
}

export interface CompleteFileUploadIntentRequest {
  expected_version: number;
}

export interface FileHttpVerifiedFileSafeDto {
  file_object_id: string;
  purpose: FilePurpose;
  visibility: FileVisibility;
  detected_mime: SupportedFileMime;
  byte_size: number;
  sha256: string;
  version: number;
}

export interface FileHttpCompleteSafeDto {
  upload_intent_id: string;
  status: 'VERIFIED';
  version: number;
  files: readonly FileHttpVerifiedFileSafeDto[];
  replayed: boolean;
}

export interface CreateFileReadIntentRequest {
  expected_file_version: number;
}

export interface FileHttpReadIntentSafeDto {
  read_intent_id: string;
  file_object_id: string;
  access_token: string | null;
  access_token_available: boolean;
  expires_at: number;
  replayed: boolean;
}

export interface SafeFileReferenceDto {
  file_object_id: string;
  file_version: number;
  purpose: FilePurpose;
  visibility: FileVisibility;
}

export const FILE_HTTP_LIFECYCLE_PATHS = Object.freeze({
  buyerUpload: '/api/buyer-portal/file-uploads/:fileObjectId/content',
  sellerUpload: '/api/seller-portal/file-uploads/:fileObjectId/content',
  staffUpload: '/api/staff/file-uploads/:fileObjectId/content',
  buyerComplete: '/api/buyer-portal/file-upload-intents/:id/complete',
  sellerComplete: '/api/seller-portal/file-upload-intents/:id/complete',
  staffComplete: '/api/staff/file-upload-intents/:id/complete',
  buyerReadIntent: '/api/buyer-portal/files/:fileObjectId/read-intents',
  sellerReadIntent: '/api/seller-portal/files/:fileObjectId/read-intents',
  staffReadIntent: '/api/staff/files/:fileObjectId/read-intents',
  buyerReadIntentBatch: '/api/buyer-portal/file-read-intents/batch',
  sellerReadIntentBatch: '/api/seller-portal/file-read-intents/batch',
  staffReadIntentBatch: '/api/staff/file-read-intents/batch',
  buyerRead: '/api/buyer-portal/file-read-intents/:id/content',
  sellerRead: '/api/seller-portal/file-read-intents/:id/content',
  staffRead: '/api/staff/file-read-intents/:id/content',
} as const);
