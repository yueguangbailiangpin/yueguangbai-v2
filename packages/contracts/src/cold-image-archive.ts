import type { SupportedFileMime } from './file-storage';

/**
 * D-055 cold-archive contract (stage 5 runtime vocabulary).
 *
 * The superseded per-file Drive model (FILE_DRIVE_ARCHIVE_STATES,
 * DriveArchiveAdapter) was removed with its runtime in stage 5; archive units
 * are now business-entity bundles streamed as one ZIP plus manifest.json per
 * unit, uploaded resumably, verified by read-back, and only then may R2 hot
 * copies be deleted.
 */

export const COLD_ARCHIVE_PURPOSES = [
  'ORDER_EVIDENCE',
  'REVIEW_EVIDENCE',
  'BUYER_REFUND_PROOF',
  'SELLER_SETTLEMENT_PROOF',
  'ORDER_COMMUNICATION_SCREENSHOT',
] as const;
export type ColdArchivePurpose = typeof COLD_ARCHIVE_PURPOSES[number];

export const ARCHIVE_COMPONENT_STATES = ['COMPLETED', 'NOT_APPLICABLE'] as const;
export type ArchiveComponentState = typeof ARCHIVE_COMPONENT_STATES[number];

export const ARCHIVE_COMPONENTS = [
  'review',
  'buyer_refund',
  'seller_principal',
  'seller_service_fee',
] as const;
export type ArchiveComponent = typeof ARCHIVE_COMPONENTS[number];

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

export function isArchiveBundleTransition(
  from: ArchiveBundleState,
  to: ArchiveBundleState,
): boolean {
  return ARCHIVE_BUNDLE_TRANSITIONS[from].includes(to);
}

export const ARCHIVE_BUNDLE_TYPES = [
  'ORDER',
  'BUYER_REFUND_PAYMENT',
  'SELLER_SETTLEMENT_PAYMENT',
] as const;
export type ArchiveBundleType = typeof ARCHIVE_BUNDLE_TYPES[number];

/** Internal job phases — never exposed as bundle states. */
export const ARCHIVE_JOB_TYPES = [
  'ARCHIVE_BUNDLE',
  'RESTORE_BUNDLE',
  'CLEANUP_EXPIRED_RESTORE',
] as const;
export type ArchiveJobType = typeof ARCHIVE_JOB_TYPES[number];

export const ARCHIVE_JOB_PHASES = [
  'MANIFEST',
  'ZIP_STREAMING',
  'DRIVE_UPLOADING',
  'DRIVE_READBACK_VERIFY',
  'HOT_DELETING',
  'ARCHIVE_FINALIZE',
  'RESTORE_DOWNLOAD',
  'RESTORE_VERIFY',
  'RESTORE_EXTRACT',
  'RESTORE_FINALIZE',
  'CLEANUP_SCAN',
  'CLEANUP_DELETE',
] as const;
export type ArchiveJobPhase = typeof ARCHIVE_JOB_PHASES[number];

export const ARCHIVE_FAILURE_CATEGORIES = [
  'file_integrity_mismatch',
  'manifest_superseded',
  'storage_stream_unavailable',
  'temp_zip_failed',
  'drive_authorization_failed',
  'drive_rate_limited',
  'drive_unavailable',
  'drive_session_conflict',
  'drive_not_found',
  'drive_verification_failed',
  'hot_delete_failed',
  'restore_verify_failed',
  'restore_extract_failed',
  'cleanup_failed',
  'job_poison_message',
  'dependency_unavailable',
] as const;
export type ArchiveFailureCategory = typeof ARCHIVE_FAILURE_CATEGORIES[number];

export const RETRYABLE_ARCHIVE_FAILURE_CATEGORIES: readonly ArchiveFailureCategory[] = [
  'temp_zip_failed',
  'drive_authorization_failed',
  'drive_rate_limited',
  'drive_unavailable',
  'drive_session_conflict',
  'hot_delete_failed',
  'restore_verify_failed',
  'cleanup_failed',
  'dependency_unavailable',
];

export function isRetryableArchiveFailure(category: ArchiveFailureCategory): boolean {
  return RETRYABLE_ARCHIVE_FAILURE_CATEGORIES.includes(category);
}

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

/** Queue message body — the only payload allowed on the wire. No PII. */
export interface ArchiveQueueMessage {
  bundle_id: string;
  bundle_version: number;
  job_type: 'ARCHIVE_BUNDLE' | 'RESTORE_BUNDLE';
  trace_id: string;
}

export function parseArchiveQueueMessage(value: unknown): ArchiveQueueMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 4 || keys.some((key) => !['bundle_id', 'bundle_version', 'job_type', 'trace_id'].includes(key))) {
    return null;
  }
  const bundleId = record['bundle_id'];
  const bundleVersion = record['bundle_version'];
  const jobType = record['job_type'];
  const traceId = record['trace_id'];
  if (typeof bundleId !== 'string' || bundleId.length < 8 || bundleId.length > 120) return null;
  const version = Number(bundleVersion);
  if (!Number.isSafeInteger(version) || version < 1 || version > 1_000_000) return null;
  if (jobType !== 'ARCHIVE_BUNDLE' && jobType !== 'RESTORE_BUNDLE') return null;
  if (typeof traceId !== 'string' || traceId.length < 8 || traceId.length > 120) return null;
  return { bundle_id: bundleId, bundle_version: version, job_type: jobType, trace_id: traceId };
}

export interface ArchiveBundleFileManifestEntry {
  file_object_id: string;
  entry_index: number;
  safe_name: string;
  purpose: ColdArchivePurpose;
  visibility: string;
  mime_type: SupportedFileMime;
  byte_size: number;
  sha256: string;
  source_etag: string | null;
  source_version: number;
  entity_type: string;
  entity_id: string;
  source_created_at: number;
}

export interface ArchiveBundleManifest {
  manifest_version: 1;
  bundle_id: string;
  bundle_version: number;
  bundle_type: ArchiveBundleType;
  eligibility_at: number;
  created_at: number;
  file_count: number;
  total_bytes: number;
  files: readonly ArchiveBundleFileManifestEntry[];
}

/** Safe staff-facing bundle projection. No Drive tokens, no object keys. */
export interface ArchiveBundleStatusDto {
  bundle_id: string;
  bundle_version: number;
  bundle_type: ArchiveBundleType;
  state: ArchiveBundleState;
  formal_order_id: string | null;
  file_count: number | null;
  total_bytes: number | null;
  zip_byte_size: number | null;
  zip_sha256: string | null;
  drive_file_id: string | null;
  eligibility_at: number;
  sealed_at: number | null;
  archived_at: number | null;
  shadow_completed_at: number | null;
  hot_files_deleted: number | null;
  restore_expires_at: number | null;
  last_failure_category: string | null;
  is_current: boolean;
}

export interface ArchiveRestoreRequestResultDto {
  restore_id: string;
  bundle_id: string;
  bundle_version: number;
  state: 'REQUESTED' | 'COMPLETED';
  restore_expires_at: number;
  replayed: boolean;
}

export interface ArchiveMetricsDto {
  generated_at: number;
  eligible_backlog_bundles: number;
  eligible_backlog_files: number;
  eligible_backlog_bytes: number;
  oldest_eligible_age_ms: number | null;
  jobs_pending: number;
  jobs_processing: number;
  jobs_retry_scheduled: number;
  jobs_failed: number;
  jobs_dead_lettered: number;
  archive_succeeded_total: number;
  archive_failed_total: number;
  restore_succeeded_total: number;
  restore_failed_total: number;
  last_success_at: number | null;
  temporary_restore_active_count: number;
  cleanup_backlog: number;
  shadow_copy_projected_files: number;
  shadow_copy_projected_bytes: number;
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

/**
 * Server-only resumable Drive client port (D-055). Replaces the per-file
 * DriveArchiveAdapter. Implementations MUST NOT log or persist tokens, MUST
 * NOT create public shares, and MUST NOT delete archived Drive files. No
 * member of this interface is safe for an HTTP DTO.
 */
export type DriveArchiveFailureCategory =
  | 'authorization_failed'
  | 'rate_limited'
  | 'service_unavailable'
  | 'session_conflict'
  | 'not_found'
  | 'invalid_response'
  | 'interrupted';

export class DriveArchiveClientError extends Error {
  constructor(
    public readonly category: DriveArchiveFailureCategory,
    detail?: string,
  ) {
    super(`drive_archive_${category}`);
    this.name = 'DriveArchiveClientError';
    // Keep the raw detail out of the message so a careless logger cannot leak
    // token fragments; category alone drives retry classification.
    this.cause = detail === undefined ? undefined : detail;
  }
}

export interface DriveUploadSessionState {
  sessionKey: string;
  folderKey: string;
  acceptedByteSize: number;
  completedFileId: string | null;
}

export interface DriveArchiveClient {
  /** Opens a resumable session for one bundle ZIP under the configured folder. */
  createUploadSession(input: {
    fileName: string;
    mimeType: 'application/zip';
    totalByteSize: number;
    sha256Hex: string;
  }): Promise<DriveUploadSessionState>;
  /**
   * Uploads one chunk at `offset`. Interruption mid-chunk resolves with the
   * partially accepted byte count instead of throwing when possible.
   */
  uploadChunk(input: {
    sessionKey: string;
    offset: number;
    bytes: Uint8Array<ArrayBuffer>;
    isFinal: boolean;
  }): Promise<{ acceptedByteSize: number; completedFileId: string | null }>;
  /** Returns the durable session state for resume, or null when unknown. */
  queryUploadSession(sessionKey: string): Promise<DriveUploadSessionState | null>;
  /** Metadata-only probe used by read-back verification. */
  readFileMetadata(fileId: string): Promise<{ byteSize: number; mimeType: string }>;
  /** Streaming read-back; the caller hashes without buffering the object. */
  openFileStream(fileId: string): Promise<{
    byteSize: number;
    mimeType: string;
    body: ReadableStream<Uint8Array>;
  }>;
}
