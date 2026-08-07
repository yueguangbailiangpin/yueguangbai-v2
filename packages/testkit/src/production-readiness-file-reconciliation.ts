import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  CapacityDryRunReport,
  FileAuthorityEvidence,
  FileReconciliationFinding,
  FileReconciliationFindingKind,
  FileReconciliationReport,
  OfflineStorageManifestEntry,
  StorageLocation,
} from '@ygb/contracts';

const PRODUCTION_READINESS_FORMAT_VERSION = 1 as const;

const FINDING_KINDS: readonly FileReconciliationFindingKind[] = [
  'MISSING',
  'ORPHAN',
  'DUPLICATE',
  'PROTECTED_REF_MISMATCH',
  'SIZE_MISMATCH',
  'MIME_MISMATCH',
  'SHA256_MISMATCH',
  'PUBLIC_LINK',
] as const;

export function readFileAuthorityEvidence(
  database: DatabaseSync,
): FileAuthorityEvidence[] {
  const rows = database.prepare(`SELECT
      object.id AS file_object_id,
      object.object_key,
      object.uploaded_byte_size AS byte_size,
      object.detected_mime AS mime_type,
      object.uploaded_sha256 AS sha256,
      archive.status AS archive_status,
      archive.drive_file_id
    FROM file_objects object
    LEFT JOIN file_drive_archives archive ON archive.file_object_id=object.id
    WHERE object.status IN ('VERIFIED','DELETION_PENDING','DELETED')
      AND object.uploaded_byte_size IS NOT NULL
      AND object.detected_mime IS NOT NULL
      AND object.uploaded_sha256 IS NOT NULL
    ORDER BY object.id`).all() as Array<{
      file_object_id: string;
      object_key: string;
      byte_size: number;
      mime_type: string;
      sha256: string;
      archive_status: string | null;
      drive_file_id: string | null;
    }>;
  return rows.map((row) => {
    const expectedLocation: StorageLocation = row.archive_status === 'DRIVE_ARCHIVED'
      ? 'DRIVE'
      : 'R2';
    if (expectedLocation === 'DRIVE' && !row.drive_file_id) {
      throw new Error('drive_authority_reference_missing');
    }
    return {
      authority_hash: protectReference('file', row.file_object_id),
      expected_location: expectedLocation,
      expected_protected_ref: protectReference(
        expectedLocation.toLowerCase(),
        expectedLocation === 'DRIVE' ? String(row.drive_file_id) : row.object_key,
      ),
      byte_size: row.byte_size,
      mime_type: row.mime_type,
      sha256: row.sha256,
    };
  });
}

export function reconcileFileManifests(input: {
  authority: readonly FileAuthorityEvidence[];
  r2Manifest: readonly OfflineStorageManifestEntry[];
  driveManifest: readonly OfflineStorageManifestEntry[];
  generatedAtUtcMs?: number;
}): FileReconciliationReport {
  const generatedAtUtcMs = input.generatedAtUtcMs ?? Date.now();
  if (!Number.isSafeInteger(generatedAtUtcMs) || generatedAtUtcMs < 0) {
    throw new Error('invalid_timestamp');
  }
  validateAuthority(input.authority);
  validateStorageManifest(input.r2Manifest);
  validateStorageManifest(input.driveManifest);
  const findings: FileReconciliationFinding[] = [];
  const authorities = new Map(input.authority.map((entry) => [
    entry.authority_hash,
    entry,
  ]));
  const stores: Array<{
    location: StorageLocation;
    entries: readonly OfflineStorageManifestEntry[];
  }> = [
    { location: 'R2', entries: input.r2Manifest },
    { location: 'DRIVE', entries: input.driveManifest },
  ];

  for (const { location, entries } of stores) {
    const byAuthority = groupByAuthority(entries);
    for (const [authorityHash, matches] of byAuthority) {
      if (matches.length > 1) add(findings, 'DUPLICATE', location, authorityHash);
      if (!authorities.has(authorityHash)) add(findings, 'ORPHAN', location, authorityHash);
      for (const entry of matches) {
        if (entry.public_url !== null || containsPublicLink(entry)) {
          add(findings, 'PUBLIC_LINK', location, authorityHash);
        }
      }
    }
  }

  const r2ByAuthority = groupByAuthority(input.r2Manifest);
  const driveByAuthority = groupByAuthority(input.driveManifest);
  for (const authority of input.authority) {
    const expectedMap = authority.expected_location === 'R2'
      ? r2ByAuthority
      : driveByAuthority;
    const otherMap = authority.expected_location === 'R2'
      ? driveByAuthority
      : r2ByAuthority;
    const entries = expectedMap.get(authority.authority_hash) ?? [];
    if (entries.length === 0) {
      add(findings, 'MISSING', authority.expected_location, authority.authority_hash);
    } else {
      compareEntry(authority, entries[0]!, findings);
    }
    if ((otherMap.get(authority.authority_hash) ?? []).length > 0) {
      add(
        findings,
        'DUPLICATE',
        authority.expected_location === 'R2' ? 'DRIVE' : 'R2',
        authority.authority_hash,
      );
    }
  }

  const unique = [...new Map(findings.map((finding) => [
    `${finding.kind}:${finding.location}:${finding.authority_hash}`,
    finding,
  ])).values()].sort((left, right) =>
    `${left.kind}:${left.location}:${left.authority_hash}`
      .localeCompare(`${right.kind}:${right.location}:${right.authority_hash}`));
  const findingCounts = Object.fromEntries(FINDING_KINDS.map((kind) => [
    kind,
    unique.filter((finding) => finding.kind === kind).length,
  ])) as Record<FileReconciliationFindingKind, number>;
  return {
    format_version: PRODUCTION_READINESS_FORMAT_VERSION,
    generated_at_utc_ms: generatedAtUtcMs,
    status: unique.length === 0 ? 'PASS' : 'FAIL',
    authority_count: input.authority.length,
    r2_manifest_count: input.r2Manifest.length,
    drive_manifest_count: input.driveManifest.length,
    finding_counts: findingCounts,
    findings: unique,
    external_calls: 0,
    r2_deletes: 0,
  };
}

export function protectReference(kind: string, value: string): string {
  if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(kind) || value.length < 1) {
    throw new Error('invalid_reference');
  }
  return createHash('sha256').update(`${kind}:${value}`, 'utf8').digest('hex');
}

export function runAnonymousCapacityDryRun(
  generatedAtUtcMs = Date.now(),
): CapacityDryRunReport {
  if (!Number.isSafeInteger(generatedAtUtcMs) || generatedAtUtcMs < 0) {
    throw new Error('invalid_timestamp');
  }
  const started = performance.now();
  const staffCount = 8;
  const dailyOrders = 200;
  const peakOrders = 50;
  const filesPerOrder = 4;
  const fileCount = dailyOrders * filesPerOrder;
  const authority = Array.from({ length: fileCount }, (_, index) => {
    const id = `anonymous-file-${index + 1}`;
    const archived = index % 8 === 0;
    return {
      authority_hash: protectReference('file', id),
      expected_location: archived ? 'DRIVE' as const : 'R2' as const,
      expected_protected_ref: protectReference(
        archived ? 'drive' : 'r2',
        archived ? `drive-${id}` : `files/v1/${id}`,
      ),
      byte_size: 1024 + index,
      mime_type: 'image/jpeg',
      sha256: protectReference('content', id),
    };
  });
  const entries = authority.map((entry) => ({
    authority_hash: entry.authority_hash,
    protected_ref: entry.expected_protected_ref,
    byte_size: entry.byte_size,
    mime_type: entry.mime_type,
    sha256: entry.sha256,
    public_url: null,
  }));
  const reconciliation = reconcileFileManifests({
    authority,
    r2Manifest: entries.filter((_, index) => index % 8 !== 0),
    driveManifest: entries.filter((_, index) => index % 8 === 0),
    generatedAtUtcMs,
  });
  const elapsedMs = Math.ceil(performance.now() - started);
  const actionableSummaries = Math.ceil(dailyOrders * 0.25);
  const maxOrdersPerStaff = Math.ceil(dailyOrders / staffCount);
  const status = reconciliation.status === 'PASS'
    && actionableSummaries <= 50
    && maxOrdersPerStaff <= 25
    && elapsedMs <= 10_000 ? 'PASS' : 'FAIL';
  return {
    format_version: PRODUCTION_READINESS_FORMAT_VERSION,
    generated_at_utc_ms: generatedAtUtcMs,
    status,
    staff_count: staffCount,
    daily_orders: dailyOrders,
    peak_orders_15m: peakOrders,
    file_objects: fileCount,
    actionable_summaries: actionableSummaries,
    order_batches_at_50: Math.ceil(dailyOrders / 50),
    file_batches_at_50: Math.ceil(fileCount / 50),
    max_orders_per_staff: maxOrdersPerStaff,
    reconciliation_findings: reconciliation.findings.length,
    elapsed_ms: elapsedMs,
    external_calls: 0,
  };
}

function compareEntry(
  authority: FileAuthorityEvidence,
  entry: OfflineStorageManifestEntry,
  findings: FileReconciliationFinding[],
): void {
  const location = authority.expected_location;
  if (entry.protected_ref !== authority.expected_protected_ref) {
    add(findings, 'PROTECTED_REF_MISMATCH', location, authority.authority_hash);
  }
  if (entry.byte_size !== authority.byte_size) {
    add(findings, 'SIZE_MISMATCH', location, authority.authority_hash);
  }
  if (entry.mime_type !== authority.mime_type) {
    add(findings, 'MIME_MISMATCH', location, authority.authority_hash);
  }
  if (entry.sha256 !== authority.sha256) {
    add(findings, 'SHA256_MISMATCH', location, authority.authority_hash);
  }
}

function validateAuthority(entries: readonly FileAuthorityEvidence[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!hash(entry.authority_hash) || !hash(entry.expected_protected_ref)
      || !hash(entry.sha256) || !Number.isSafeInteger(entry.byte_size)
      || entry.byte_size < 1 || !safeMime(entry.mime_type)
      || (entry.expected_location !== 'R2' && entry.expected_location !== 'DRIVE')
      || seen.has(entry.authority_hash)) {
      throw new Error('invalid_file_authority');
    }
    seen.add(entry.authority_hash);
  }
}

function validateStorageManifest(entries: readonly OfflineStorageManifestEntry[]): void {
  for (const entry of entries) {
    if (!hash(entry.authority_hash) || !hash(entry.protected_ref)
      || !hash(entry.sha256) || !Number.isSafeInteger(entry.byte_size)
      || entry.byte_size < 1 || !safeMime(entry.mime_type)
      || !(entry.public_url === null || (typeof entry.public_url === 'string'
        && entry.public_url.length <= 2048))) {
      throw new Error('invalid_offline_storage_manifest');
    }
  }
}

function groupByAuthority(
  entries: readonly OfflineStorageManifestEntry[],
): Map<string, OfflineStorageManifestEntry[]> {
  const result = new Map<string, OfflineStorageManifestEntry[]>();
  for (const entry of entries) {
    const current = result.get(entry.authority_hash) ?? [];
    current.push(entry);
    result.set(entry.authority_hash, current);
  }
  return result;
}

function containsPublicLink(entry: OfflineStorageManifestEntry): boolean {
  return Object.values(entry).some((value) =>
    typeof value === 'string' && /^https?:\/\//iu.test(value));
}

function add(
  findings: FileReconciliationFinding[],
  kind: FileReconciliationFindingKind,
  location: StorageLocation,
  authorityHash: string,
): void {
  findings.push({ kind, location, authority_hash: authorityHash });
}

function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function safeMime(value: unknown): value is string {
  return value === 'image/jpeg' || value === 'image/png'
    || value === 'image/webp' || value === 'application/pdf';
}
