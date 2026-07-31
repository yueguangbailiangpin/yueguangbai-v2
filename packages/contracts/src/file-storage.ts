export const FILE_PURPOSES = [
  'PRODUCT_APPLICATION_IMAGE',
  'ORDER_EVIDENCE',
  'REVIEW_EVIDENCE',
  'BUYER_REFUND_PROOF',
  'SELLER_SETTLEMENT_PROOF',
  'SUPPORT_ATTACHMENT',
] as const;

export type FilePurpose = typeof FILE_PURPOSES[number];

export const FILE_VISIBILITIES = [
  'INTERNAL_ONLY',
  'BUYER_VISIBLE',
  'SELLER_VISIBLE',
] as const;

export type FileVisibility = typeof FILE_VISIBILITIES[number];

export const FILE_UPLOAD_INTENT_STATUSES = [
  'ISSUED',
  'VERIFYING',
  'VERIFIED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;

export type FileUploadIntentStatus =
  typeof FILE_UPLOAD_INTENT_STATUSES[number];

export const FILE_OBJECT_STATUSES = [
  'RESERVED',
  'UPLOADED',
  'VERIFIED',
  'REJECTED',
  'DELETION_PENDING',
  'DELETED',
] as const;

export type FileObjectStatus = typeof FILE_OBJECT_STATUSES[number];

export const FILE_READ_INTENT_STATUSES = [
  'ISSUED',
  'CONSUMED',
  'EXPIRED',
  'REVOKED',
] as const;

export type FileReadIntentStatus =
  typeof FILE_READ_INTENT_STATUSES[number];

export const FILE_ENTITY_TYPES = [
  'PRODUCT_APPLICATION',
  'ORDER',
  'REVIEW',
  'BUYER_REFUND',
  'SELLER_SETTLEMENT',
  'SUPPORT_CASE',
] as const;

export type FileEntityType = typeof FILE_ENTITY_TYPES[number];

export const FILE_ACTOR_TYPES = [
  'STAFF',
  'BUYER_CUSTOMER',
  'SELLER_MEMBER',
  'SYSTEM',
] as const;

export type FileActorType = typeof FILE_ACTOR_TYPES[number];

export interface FileActor {
  type: FileActorType;
  id: string;
  roles: readonly string[];
}

export interface FileUploadDescriptor {
  clientFileName: string;
  declaredMime: string;
  byteSize: number;
}

export interface NormalizedFileUploadDescriptor {
  clientFileName: string;
  declaredMime: SupportedFileMime;
  extension: SupportedFileExtension;
  byteSize: number;
}

export const SUPPORTED_FILE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type SupportedFileMime = typeof SUPPORTED_FILE_MIMES[number];

export const SUPPORTED_FILE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'pdf',
] as const;

export type SupportedFileExtension =
  typeof SUPPORTED_FILE_EXTENSIONS[number];

export interface FileManifestRecord {
  fileObjectId: string;
  uploadIntentId: string;
  slotNo: number;
  purpose: FilePurpose;
  visibility: FileVisibility;
  clientFileName: string;
  declaredMime: SupportedFileMime;
  detectedMime: SupportedFileMime | null;
  extension: SupportedFileExtension;
  expectedByteSize: number;
  verifiedByteSize: number | null;
  sha256: string | null;
  status: FileObjectStatus;
  version: number;
}

export interface FileUploadSlot {
  fileObjectId: string;
  slotNo: number;
  uploadToken: string | null;
  uploadTokenAvailable: boolean;
  expiresAt: number;
}

export interface FileUploadIntentResult {
  uploadIntentId: string;
  purpose: FilePurpose;
  visibility: FileVisibility;
  status: 'ISSUED';
  version: number;
  expiresAt: number;
  uploads: readonly FileUploadSlot[];
  replayed: boolean;
}

export interface FileObjectUploadResult {
  fileObjectId: string;
  uploadIntentId: string;
  status: 'UPLOADED';
  detectedMime: SupportedFileMime;
  byteSize: number;
  sha256: string;
  version: number;
  replayed: boolean;
}

export interface FileUploadVerificationResult {
  uploadIntentId: string;
  status: 'VERIFIED';
  version: number;
  files: readonly FileManifestRecord[];
  replayed: boolean;
}

export interface FileEntityLinkResult {
  linkId: string;
  fileObjectId: string;
  entityType: FileEntityType;
  entityId: string;
  purpose: FilePurpose;
  visibility: FileVisibility;
  replayed: boolean;
}

export interface FileReadIntentResult {
  readIntentId: string;
  fileObjectId: string;
  accessToken: string | null;
  accessTokenAvailable: boolean;
  expiresAt: number;
  replayed: boolean;
}

export interface ObjectStoragePutInput {
  objectKey: string;
  bytes: Uint8Array<ArrayBuffer>;
  contentType: SupportedFileMime;
  metadata: Readonly<Record<string, string>>;
}

export interface ObjectStoragePutResult {
  etag: string;
  byteSize: number;
  contentType: SupportedFileMime;
  checksumSha256: string;
}

export interface ObjectStorageHead {
  objectKey: string;
  etag: string;
  byteSize: number;
  contentType: SupportedFileMime;
  checksumSha256: string;
  metadata: Readonly<Record<string, string>>;
}

export interface ObjectStorageAdapter {
  putObject(input: ObjectStoragePutInput): Promise<ObjectStoragePutResult>;
  headObject(objectKey: string): Promise<ObjectStorageHead | null>;
  readPrefix(
    objectKey: string,
    maximumBytes: number,
  ): Promise<Uint8Array<ArrayBuffer>>;
  readObject(objectKey: string): Promise<Uint8Array<ArrayBuffer>>;
  deleteObject(objectKey: string): Promise<void>;
}

export function isFilePurpose(value: unknown): value is FilePurpose {
  return isPublished(value, FILE_PURPOSES);
}

export function isFileVisibility(
  value: unknown,
): value is FileVisibility {
  return isPublished(value, FILE_VISIBILITIES);
}

export function isSupportedFileMime(
  value: unknown,
): value is SupportedFileMime {
  return isPublished(value, SUPPORTED_FILE_MIMES);
}

export function isFileEntityType(
  value: unknown,
): value is FileEntityType {
  return isPublished(value, FILE_ENTITY_TYPES);
}

function isPublished<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === 'string'
    && (values as readonly string[]).includes(value);
}
