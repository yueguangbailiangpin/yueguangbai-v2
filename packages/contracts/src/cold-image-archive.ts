import type { SupportedFileMime } from './file-storage';

export const COLD_ARCHIVE_PURPOSES = [
  'ORDER_EVIDENCE',
  'REVIEW_EVIDENCE',
  'BUYER_REFUND_PROOF',
  'SELLER_SETTLEMENT_PROOF',
] as const;
export type ColdArchivePurpose = typeof COLD_ARCHIVE_PURPOSES[number];

export const FILE_DRIVE_ARCHIVE_STATES = [
  'R2_HOT',
  'DRIVE_COPYING',
  'DRIVE_VERIFIED',
  'R2_DELETE_PENDING',
  'DRIVE_ARCHIVED',
] as const;
export type FileDriveArchiveState = typeof FILE_DRIVE_ARCHIVE_STATES[number];

export const ARCHIVE_COMPONENT_STATES = ['COMPLETED', 'NOT_APPLICABLE'] as const;
export type ArchiveComponentState = typeof ARCHIVE_COMPONENT_STATES[number];

export const ARCHIVE_COMPONENTS = [
  'review',
  'buyer_refund',
  'seller_principal',
  'seller_service_fee',
] as const;
export type ArchiveComponent = typeof ARCHIVE_COMPONENTS[number];

/**
 * Stage 4 contract-only archive lifecycle (D-055, stage 5 implements the
 * runtime). A bundle starts ONLINE; after the six-Shanghai-month hot window it
 * becomes ARCHIVED. Only Staff may request a restore, which moves it through
 * RESTORE_REQUESTED and RESTORING into RESTORED_TEMPORILY's seven-day
 * temporary R2 copy (or RESTORE_FAILED, which stays retryable). The enum and
 * transitions below are the authoritative vocabulary for stage 5 — no public
 * restore endpoint exists yet, so no route serves these states today.
 */
export const ARCHIVE_BUNDLE_STATES = [
  'ONLINE',
  'ARCHIVED',
  'RESTORE_REQUESTED',
  'RESTORING',
  'RESTORED_TEMPORARILY',
  'RESTORE_FAILED',
] as const;
export type ArchiveBundleState = typeof ARCHIVE_BUNDLE_STATES[number];

export const ARCHIVE_BUNDLE_TRANSITIONS: Readonly<
  Record<ArchiveBundleState, readonly ArchiveBundleState[]>
> = Object.freeze({
  ONLINE: ['ARCHIVED'],
  ARCHIVED: ['RESTORE_REQUESTED'],
  RESTORE_REQUESTED: ['RESTORING', 'ARCHIVED'],
  RESTORING: ['RESTORED_TEMPORARILY', 'RESTORE_FAILED'],
  RESTORED_TEMPORARILY: ['ARCHIVED'],
  RESTORE_FAILED: ['RESTORE_REQUESTED'],
});

export interface OrderArchiveClosureResultDto {
  formal_order_id: string;
  status: 'CLOSED' | 'REOPENED';
  version: number;
  business_closed_at: number;
  archive_due_at: number;
  review_state: ArchiveComponentState;
  buyer_refund_state: ArchiveComponentState;
  seller_principal_state: ArchiveComponentState;
  seller_service_fee_state: ArchiveComponentState;
  replayed: boolean;
}

export interface FileDriveRehydrationResultDto {
  file_object_id: string;
  status: 'COMPLETED';
  archive_version: number;
  replayed: boolean;
}

export interface DriveArchiveUploadInput {
  fileObjectId: string;
  fileName: string;
  mimeType: SupportedFileMime;
  byteSize: number;
  sha256: string;
  bytes: Uint8Array<ArrayBuffer>;
  resumeSessionKey?: string | null;
}

export interface DriveArchiveUploadResult {
  completed: boolean;
  fileId: string | null;
  folderId: string;
  ownerAccountKey: string;
  resumeSessionKey: string | null;
}

export interface DriveArchiveReadResult {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: SupportedFileMime;
  byteSize: number;
}

/** Server-only adapter. No member is safe for an HTTP DTO. */
export interface DriveArchiveAdapter {
  upload(input: DriveArchiveUploadInput): Promise<DriveArchiveUploadResult>;
  readFile(fileId: string): Promise<DriveArchiveReadResult>;
}

export interface SafeFileArchiveStatusDto {
  storage_state: 'HOT' | 'ARCHIVED';
  archived_at: number | null;
  time_basis: 'UTC_MS';
  display_timezone: 'Asia/Shanghai';
}

export function isColdArchivePurpose(value: unknown): value is ColdArchivePurpose {
  return typeof value === 'string'
    && (COLD_ARCHIVE_PURPOSES as readonly string[]).includes(value);
}

export function parseSafeFileArchiveStatusDto(value: unknown): SafeFileArchiveStatusDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_file_archive_status');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 4 || keys.some((key) => ![
    'storage_state', 'archived_at', 'time_basis', 'display_timezone',
  ].includes(key))) throw new Error('invalid_file_archive_status');
  if ((record['storage_state'] !== 'HOT' && record['storage_state'] !== 'ARCHIVED')
    || !(record['archived_at'] === null
      || (Number.isSafeInteger(record['archived_at']) && Number(record['archived_at']) >= 0))
    || record['time_basis'] !== 'UTC_MS'
    || record['display_timezone'] !== 'Asia/Shanghai'
    || (record['storage_state'] === 'HOT' && record['archived_at'] !== null)
    || (record['storage_state'] === 'ARCHIVED' && record['archived_at'] === null)) {
    throw new Error('invalid_file_archive_status');
  }
  return {
    storage_state: record['storage_state'],
    archived_at: record['archived_at'] as number | null,
    time_basis: 'UTC_MS',
    display_timezone: 'Asia/Shanghai',
  };
}
