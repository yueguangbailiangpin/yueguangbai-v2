import {
  DriveArchiveClientError,
  type ArchiveFailureCategory,
  type DriveArchiveClient,
  type ObjectStorageAdapter,
  type SqlDatabase,
  type SupportedFileMime,
} from '@ygb/contracts';
import { statementChangedOnce } from '@ygb/contracts';
import { canonicalJson, IncrementalSha256, sha256HexOfStream } from '@ygb/domain';
import { buildBundleManifest } from './manifest';
import {
  fetchUnitFileFacts,
  insertBundleEventStatement,
  type SelectorUnit,
} from './selector';
import { createStreamingZip, ZIP_MAX_FILE_ENTRIES } from './zip-writer';

/** Hard caps mirrored from the ZIP writer; sealing refuses larger sets. */

export interface ArchivePipelineControls {
  driveUploadEnabled: boolean;
  hotDeleteEnabled: boolean;
  shadowCopyOnly: boolean;
}

export interface ArchivePipelineDeps {
  storage: ObjectStorageAdapter;
  drive: DriveArchiveClient;
}

export class ArchiveJobExecutionError extends Error {
  constructor(
    public readonly category: ArchiveFailureCategory,
    public readonly retryable: boolean,
  ) {
    super(`archive_job_${category}`);
    this.name = 'ArchiveJobExecutionError';
  }
}

interface BundleRow {
  id: string;
  bundle_type: 'ORDER' | 'BUYER_REFUND_PAYMENT' | 'SELLER_SETTLEMENT_PAYMENT';
  ref_id: string;
  formal_order_id: string;
  bundle_version: number;
  state: 'ONLINE' | 'ARCHIVED' | 'RESTORE_REQUESTED' | 'RESTORING' | 'RESTORED_TEMPORARILY' | 'RESTORE_FAILED';
  eligibility_at: number;
  sealed_at: number | null;
  manifest_sha256: string | null;
  manifest_file_count: number | null;
  manifest_total_bytes: number | null;
  zip_byte_size: number | null;
  zip_sha256: string | null;
  temp_zip_object_key: string | null;
  drive_file_id: string | null;
  drive_folder_id: string | null;
  drive_session_key: string | null;
  drive_verified_at: number | null;
  hot_files_total: number | null;
  hot_files_deleted: number | null;
  shadow_completed_at: number | null;
  archived_at: number | null;
  attempt_count: number;
}

interface ManifestRow {
  id: string;
  file_object_id: string;
  entry_index: number;
  safe_name: string;
  purpose: string;
  visibility: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  source_etag: string | null;
  source_version: number;
  entity_type: string;
  entity_id: string;
  source_created_at: number;
  delete_state: 'PENDING' | 'DELETED';
}

export function tempZipObjectKey(bundleId: string, bundleVersion: number): string {
  return `archive-bundles/${bundleId}/v${bundleVersion}.zip`;
}

async function loadBundle(database: SqlDatabase, bundleId: string): Promise<BundleRow | null> {
  return database
    .prepare('SELECT * FROM archive_bundles WHERE id=?')
    .bind(bundleId)
    .first<BundleRow>();
}

async function loadManifestRows(database: SqlDatabase, bundleId: string): Promise<ManifestRow[]> {
  const rows = await database
    .prepare(
      'SELECT * FROM archive_bundle_files WHERE bundle_id=? ORDER BY entry_index',
    )
    .bind(bundleId)
    .all<ManifestRow>();
  return rows.results;
}

/**
 * Executes one ARCHIVE_BUNDLE job end to end, resuming from whatever phase the
 * bundle row already recorded. Every phase transition is a D1 batch with
 * assertions; nothing is buffered whole: ZIP members stream from R2 through
 * the ZIP writer into the temp object, Drive chunks ride a fixed 256 KiB
 * window, and verification hashes stream.
 */
export async function runArchiveBundleJob(
  database: SqlDatabase,
  input: { bundleId: string; now: number },
  deps: ArchivePipelineDeps,
  controls: ArchivePipelineControls,
): Promise<{ outcome: 'SUCCEEDED' | 'SHADOW_COMPLETED' }> {
  const bundle = await loadBundle(database, input.bundleId);
  if (!bundle) throw new ArchiveJobExecutionError('dependency_unavailable', true);
  if (bundle.state !== 'ONLINE' || bundle.archived_at !== null) {
    // Already finalized or mid-restore; the job is done from our perspective.
    return { outcome: 'SUCCEEDED' };
  }
  if (!bundle.sealed_at || !bundle.manifest_sha256) {
    await sealManifestPhase(database, bundle, input.now, deps);
  }
  const sealed = (await loadBundle(database, input.bundleId))!;
  if (!sealed.zip_sha256) {
    await streamZipPhase(database, sealed, input.now, deps);
  }
  const zipped = (await loadBundle(database, input.bundleId))!;
  if (!zipped.drive_file_id) {
    if (!controls.driveUploadEnabled) {
      throw new ArchiveJobExecutionError('dependency_unavailable', true);
    }
    await driveUploadPhase(database, zipped, input.now, deps);
  }
  const uploaded = (await loadBundle(database, input.bundleId))!;
  if (!uploaded.drive_verified_at) {
    await driveVerifyPhase(database, uploaded, input.now, deps);
  }
  const verified = (await loadBundle(database, input.bundleId))!;
  const shadow = controls.shadowCopyOnly || !controls.hotDeleteEnabled;
  if (shadow) {
    await finalizeShadow(database, verified, input.now);
    return { outcome: 'SHADOW_COMPLETED' };
  }
  await hotDeletePhase(database, verified, input.now, deps);
  const deleted = (await loadBundle(database, input.bundleId))!;
  await finalizeArchived(database, deleted, input.now);
  return { outcome: 'SUCCEEDED' };
}

async function sealManifestPhase(
  database: SqlDatabase,
  bundle: BundleRow,
  now: number,
  deps: ArchivePipelineDeps,
): Promise<void> {
  if (!deps.storage.openObjectStream || !deps.storage.putObjectStream) {
    throw new ArchiveJobExecutionError('storage_stream_unavailable', false);
  }
  const unit: SelectorUnit = {
    bundle_type: bundle.bundle_type,
    ref_id: bundle.ref_id,
    formal_order_id: bundle.formal_order_id,
    last_closed_at: bundle.eligibility_at,
  };
  const covered = new Set(
    (await database
      .prepare(
        `SELECT covered_files.file_object_id FROM archive_bundle_files covered_files
       JOIN archive_bundles covered ON covered.id=covered_files.bundle_id
       WHERE covered.bundle_type=? AND covered.ref_id=? AND covered_files.delete_state='DELETED'`,
      )
      .bind(bundle.bundle_type, bundle.ref_id)
      .all<{ file_object_id: string }>()).results.map((row) => row.file_object_id),
  );
  const facts = (await fetchUnitFileFacts(database, unit))
    .filter((fact) => !covered.has(fact.file_object_id));
  if (facts.length === 0) throw new ArchiveJobExecutionError('manifest_superseded', false);
  if (facts.length > ZIP_MAX_FILE_ENTRIES) throw new ArchiveJobExecutionError('manifest_superseded', false);

  // Snap the live R2 etag per file; a missing head means the hot copy is gone
  // while D1 still says VERIFIED — an integrity break, fail closed.
  const objectKeys = new Map(
    (await database
      .prepare('SELECT id,object_key FROM file_objects WHERE id IN ('
        + facts.map(() => '?').join(',') + ')')
      .bind(...facts.map((fact) => fact.file_object_id))
      .all<{ id: string; object_key: string }>()).results.map((row) => [row.id, row.object_key]),
  );
  const entries: {
    file_object_id: string;
    purpose: never;
    visibility: string;
    mime_type: SupportedFileMime;
    byte_size: number;
    sha256: string;
    source_etag: string | null;
    source_version: number;
    entity_type: string;
    entity_id: string;
    source_created_at: number;
  }[] = [];
  for (const fact of facts) {
    const head = await deps.storage.headObject(objectKeys.get(fact.file_object_id)!)
      .catch(() => null);
    if (!head) throw new ArchiveJobExecutionError('file_integrity_mismatch', false);
    entries.push({
      file_object_id: fact.file_object_id,
      purpose: fact.purpose as never,
      visibility: fact.visibility,
      mime_type: fact.detected_mime as SupportedFileMime,
      byte_size: fact.uploaded_byte_size,
      sha256: fact.uploaded_sha256,
      source_etag: head.etag,
      source_version: fact.source_version,
      entity_type: fact.entity_type,
      entity_id: fact.entity_id,
      source_created_at: fact.source_created_at,
    });
  }
  const { manifest, manifestJson, manifestSha256 } = await buildBundleManifest({
    bundleId: bundle.id,
    bundleVersion: bundle.bundle_version,
    bundleType: bundle.bundle_type,
    eligibilityAt: bundle.eligibility_at,
    createdAt: now,
    entries,
  });
  const insertStatements = manifest.files.map((entry) => database
    .prepare(
      `INSERT OR IGNORE INTO archive_bundle_files(id,bundle_id,file_object_id,entry_index,safe_name,
     purpose,visibility,mime_type,byte_size,sha256,source_etag,source_version,entity_type,entity_id,
     source_created_at,delete_state,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',?)`,
    )
    .bind(
      `archive-entry-${crypto.randomUUID()}`,
      bundle.id,
      entry.file_object_id,
      entry.entry_index,
      entry.safe_name,
      entry.purpose,
      entry.visibility,
      entry.mime_type,
      entry.byte_size,
      entry.sha256,
      entry.source_etag,
      entry.source_version,
      entry.entity_type,
      entry.entity_id,
      entry.source_created_at,
      now,
    ));
  for (let offset = 0; offset < insertStatements.length; offset += 50) {
    await database.batch(insertStatements.slice(offset, offset + 50));
  }
  const sealed = await database.batch([
    database
      .prepare(
        `UPDATE archive_bundles SET sealed_at=?,manifest_version=1,manifest_sha256=?,
       manifest_file_count=?,manifest_total_bytes=?,version=version+1,updated_at=MAX(?,updated_at+1)
       WHERE id=? AND sealed_at IS NULL`,
      )
      .bind(now, manifestSha256, manifest.file_count, manifest.total_bytes, now, bundle.id),
    database
      .prepare(
        `INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN
       (SELECT COUNT(*) FROM archive_bundle_files WHERE bundle_id=?)=(SELECT manifest_file_count FROM archive_bundles WHERE id=?)
       THEN 1 ELSE 0 END`,
      )
      .bind(bundle.id, bundle.id),
    insertBundleEventStatement(database, bundle.id, 'MANIFEST_SEALED', bundle.bundle_version, now, {
      file_count: manifest.file_count,
      total_bytes: manifest.total_bytes,
    }),
  ]);
  if (!statementChangedOnce(sealed[0]!)) {
    throw new ArchiveJobExecutionError('dependency_unavailable', true);
  }
  void manifestJson;
}

async function streamZipPhase(
  database: SqlDatabase,
  bundle: BundleRow,
  now: number,
  deps: ArchivePipelineDeps,
): Promise<void> {
  const streaming = deps.storage.putObjectStream?.bind(deps.storage) ?? null;
  const opener = deps.storage.openObjectStream?.bind(deps.storage) ?? null;
  if (!streaming || !opener) throw new ArchiveJobExecutionError('storage_stream_unavailable', false);
  const rows = await loadManifestRows(database, bundle.id);
  if (rows.length === 0 || !bundle.manifest_sha256 || bundle.manifest_file_count !== rows.length) {
    throw new ArchiveJobExecutionError('dependency_unavailable', true);
  }
  const objectKeys = new Map(
    (await database
      .prepare(`SELECT id,object_key FROM file_objects WHERE id IN (${rows.map(() => '?').join(',')})`)
      .bind(...rows.map((row) => row.file_object_id))
      .all<{ id: string; object_key: string }>()).results.map((row) => [row.id, row.object_key]),
  );
  const manifestJson = manifestJsonFromRows(bundle, rows);
  const writer = createStreamingZip(async () => ({
    manifestJsonBytes: new TextEncoder().encode(manifestJson),
    members: rows.map((row) => ({
      safeName: row.safe_name,
      byteSize: row.byte_size,
      open: async () => {
        const stream = await opener(objectKeys.get(row.file_object_id)!).catch(() => null);
        if (!stream) return null;
        if (stream.head.byteSize !== row.byte_size
          || stream.head.checksumSha256 !== row.sha256) {
          await stream.body.cancel().catch(() => undefined);
          return null;
        }
        return stream.body;
      },
    })),
  }));
  const tempKey = tempZipObjectKey(bundle.id, bundle.bundle_version);
  const put = await streaming({
    objectKey: tempKey,
    contentType: 'application/zip',
    metadata: { 'ygb-archive-bundle': bundle.id, 'ygb-archive-version': String(bundle.bundle_version) },
    body: writer.stream,
  }).catch(() => null);
  if (!put) {
    await writer.stream.cancel().catch(() => undefined);
    await writer.result.catch(() => undefined);
    throw new ArchiveJobExecutionError('temp_zip_failed', true);
  }
  const zipResult = await writer.result.catch(() => null);
  if (!zipResult) throw new ArchiveJobExecutionError('temp_zip_failed', true);
  for (let index = 0; index < rows.length; index += 1) {
    const member = zipResult.members[index];
    if (!member || member.sha256Hex !== rows[index]!.sha256 || member.byteSize !== rows[index]!.byte_size) {
      throw new ArchiveJobExecutionError('file_integrity_mismatch', false);
    }
  }
  // Read the temp object back from R2 and hash it: only a verified stored copy
  // may proceed to the Drive upload.
  const readBack = await opener(tempKey).catch(() => null);
  if (!readBack) throw new ArchiveJobExecutionError('temp_zip_failed', true);
  const readBackHash = await sha256HexOfStream(readBack.body).catch(() => null);
  if (!readBackHash || readBackHash.byteSize !== zipResult.byteSize
    || readBackHash.sha256Hex !== zipResult.sha256Hex) {
    throw new ArchiveJobExecutionError('temp_zip_failed', true);
  }
  const updated = await database.batch([
    database
      .prepare(
        `UPDATE archive_bundles SET zip_byte_size=?,zip_mime='application/zip',zip_sha256=?,
       temp_zip_object_key=?,version=version+1,updated_at=MAX(?,updated_at+1)
       WHERE id=? AND zip_sha256 IS NULL`,
      )
      .bind(zipResult.byteSize, zipResult.sha256Hex, tempKey, now, bundle.id),
    insertBundleEventStatement(database, bundle.id, 'ZIP_STREAMED', bundle.bundle_version, now, {
      byte_size: zipResult.byteSize,
      entry_count: zipResult.entryCount,
    }),
  ]);
  if (!statementChangedOnce(updated[0]!)) {
    throw new ArchiveJobExecutionError('dependency_unavailable', true);
  }
}

function manifestJsonFromRows(bundle: BundleRow, rows: readonly ManifestRow[]): string {
  // Must serialize identically to buildBundleManifest's canonicalJson so the
  // copy embedded in the ZIP hashes to the sealed manifest_sha256.
  return canonicalJson({
    manifest_version: 1,
    bundle_id: bundle.id,
    bundle_version: bundle.bundle_version,
    bundle_type: bundle.bundle_type,
    eligibility_at: bundle.eligibility_at,
    created_at: bundle.sealed_at,
    file_count: rows.length,
    total_bytes: rows.reduce((total, row) => total + row.byte_size, 0),
    files: rows.map((row) => ({
      file_object_id: row.file_object_id,
      entry_index: row.entry_index,
      safe_name: row.safe_name,
      purpose: row.purpose,
      visibility: row.visibility,
      mime_type: row.mime_type,
      byte_size: row.byte_size,
      sha256: row.sha256,
      source_etag: row.source_etag,
      source_version: row.source_version,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      source_created_at: row.source_created_at,
    })),
  });
}

const DRIVE_CHUNK_BYTES = 256 * 1024;

async function driveUploadPhase(
  database: SqlDatabase,
  bundle: BundleRow,
  now: number,
  deps: ArchivePipelineDeps,
): Promise<void> {
  const opener = deps.storage.openObjectStream?.bind(deps.storage) ?? null;
  if (!opener || !bundle.temp_zip_object_key || !bundle.zip_byte_size || !bundle.zip_sha256) {
    throw new ArchiveJobExecutionError('dependency_unavailable', true);
  }
  let sessionKey = bundle.drive_session_key;
  let accepted = 0;
  if (sessionKey) {
    const state = await deps.drive.queryUploadSession(sessionKey).catch(() => null);
    if (state && state.completedFileId) {
      await recordDriveIdentity(database, bundle, state.completedFileId, state.folderKey, now);
      return;
    }
    if (state) {
      accepted = state.acceptedByteSize;
    } else {
      sessionKey = null;
    }
  }
  const totalBytes = bundle.zip_byte_size;
  let progress = accepted;
  let folderKey = bundle.drive_folder_id ?? '';
  if (!sessionKey) {
    const session = await translateDriveError(deps.drive.createUploadSession({
      fileName: `${bundle.id}-v${bundle.bundle_version}.zip`,
      mimeType: 'application/zip',
      totalByteSize: totalBytes,
      sha256Hex: bundle.zip_sha256,
    }));
    sessionKey = session.sessionKey;
    folderKey = session.folderKey;
    await database.batch([
      database
        .prepare(
          `UPDATE archive_bundles SET drive_session_key=?,drive_folder_id=?,version=version+1,
         updated_at=MAX(?,updated_at+1) WHERE id=? AND drive_session_key IS NULL`,
        )
        .bind(sessionKey, folderKey, now, bundle.id),
      insertBundleEventStatement(database, bundle.id, 'DRIVE_UPLOAD_STARTED', bundle.bundle_version, now, {}),
    ]);
    progress = 0;
  }
  if (!sessionKey) throw new ArchiveJobExecutionError('dependency_unavailable', true);

  // The temp ZIP is an immutable R2 object, so after a mid-chunk interruption
  // (Drive accepted only part of a chunk) the pass is simply restarted from
  // the accepted offset: re-open the stream, skip forward, continue. Each
  // pass keeps at most one 256 KiB chunk window in memory.
  for (;;) {
    const passStart = progress;
    const temp = await opener(bundle.temp_zip_object_key).catch(() => null);
    if (!temp || temp.head.byteSize !== totalBytes) {
      throw new ArchiveJobExecutionError('temp_zip_failed', true);
    }
    const reader = temp.body.getReader();
    let completedFileId: string | null = null;
    try {
      let position = 0;
      while (position < progress) {
        const { done, value } = await reader.read();
        if (done || !value) throw new ArchiveJobExecutionError('temp_zip_failed', true);
        position += value.byteLength;
      }
      let offset = progress;
      let buffer: Uint8Array[] = [];
      let buffered = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer.push(value);
        buffered += value.byteLength;
        if (buffered < DRIVE_CHUNK_BYTES) continue;
        const chunk = mergeChunks(buffer, buffered);
        buffer = [];
        buffered = 0;
        const result = await translateDriveError(deps.drive.uploadChunk({
          sessionKey,
          offset,
          bytes: chunk,
          isFinal: offset + chunk.byteLength >= totalBytes,
        }));
        if (result.completedFileId) {
          completedFileId = result.completedFileId;
          break;
        }
        progress = result.acceptedByteSize;
        if (result.acceptedByteSize < offset + chunk.byteLength) break;
        offset = result.acceptedByteSize;
      }
      if (!completedFileId && buffered > 0) {
        const chunk = mergeChunks(buffer, buffered);
        const result = await translateDriveError(deps.drive.uploadChunk({
          sessionKey,
          offset,
          bytes: chunk,
          isFinal: true,
        }));
        if (result.completedFileId) completedFileId = result.completedFileId;
        else progress = result.acceptedByteSize;
      }
    } finally {
      reader.releaseLock();
      await temp.body.cancel().catch(() => undefined);
    }
    if (completedFileId) {
      await recordDriveIdentity(database, bundle, completedFileId, folderKey, now);
      return;
    }
    if (progress === passStart) {
      // A full pass made no forward progress — surface as retryable instead of
      // spinning forever on a stuck session.
      throw new ArchiveJobExecutionError('drive_session_conflict', true);
    }
  }
}

function mergeChunks(chunks: readonly Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const merged = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

async function recordDriveIdentity(
  database: SqlDatabase,
  bundle: BundleRow,
  fileId: string,
  folderKey: string,
  now: number,
): Promise<void> {
  const updated = await database.batch([
    database
      .prepare(
        `UPDATE archive_bundles SET drive_file_id=?,drive_folder_id=?,drive_session_key=NULL,
       drive_uploaded_at=?,version=version+1,updated_at=MAX(?,updated_at+1)
       WHERE id=? AND drive_file_id IS NULL`,
      )
      .bind(fileId, folderKey || null, now, now, bundle.id),
    insertBundleEventStatement(database, bundle.id, 'DRIVE_UPLOADED', bundle.bundle_version, now, {}),
  ]);
  if (!statementChangedOnce(updated[0]!)) {
    throw new ArchiveJobExecutionError('dependency_unavailable', true);
  }
}

async function driveVerifyPhase(
  database: SqlDatabase,
  bundle: BundleRow,
  now: number,
  deps: ArchivePipelineDeps,
): Promise<void> {
  if (!bundle.drive_file_id || !bundle.zip_byte_size || !bundle.zip_sha256) {
    throw new ArchiveJobExecutionError('dependency_unavailable', true);
  }
  const metadata = await translateDriveError(deps.drive.readFileMetadata(bundle.drive_file_id));
  if (metadata.mimeType !== 'application/zip' || metadata.byteSize !== bundle.zip_byte_size) {
    throw new ArchiveJobExecutionError('drive_verification_failed', true);
  }
  const stream = await translateDriveError(deps.drive.openFileStream(bundle.drive_file_id));
  const hashed = await sha256HexOfStream(stream.body).catch(() => null);
  if (!hashed || hashed.byteSize !== bundle.zip_byte_size || hashed.sha256Hex !== bundle.zip_sha256) {
    throw new ArchiveJobExecutionError('drive_verification_failed', true);
  }
  const updated = await database.batch([
    database
      .prepare(
        `UPDATE archive_bundles SET drive_verified_at=?,version=version+1,updated_at=MAX(?,updated_at+1)
       WHERE id=? AND drive_verified_at IS NULL AND drive_file_id IS NOT NULL`,
      )
      .bind(now, now, bundle.id),
    insertBundleEventStatement(database, bundle.id, 'DRIVE_READBACK_VERIFIED', bundle.bundle_version, now, {}),
  ]);
  if (!statementChangedOnce(updated[0]!)) {
    throw new ArchiveJobExecutionError('dependency_unavailable', true);
  }
}

async function hotDeletePhase(
  database: SqlDatabase,
  bundle: BundleRow,
  now: number,
  deps: ArchivePipelineDeps,
): Promise<void> {
  const rows = await loadManifestRows(database, bundle.id);
  const pending = rows.filter((row) => row.delete_state === 'PENDING');
  if (pending.length === 0) return;
  // Re-assert current facts immediately before each deletion: version, hash,
  // size and purpose must all still match the sealed manifest.
  const facts = new Map(
    (await database
      .prepare(`SELECT id,purpose,visibility,detected_mime,uploaded_byte_size,uploaded_sha256,version,object_key
       FROM file_objects WHERE id IN (${pending.map(() => '?').join(',')})`)
      .bind(...pending.map((row) => row.file_object_id))
      .all<{
        id: string; purpose: string; visibility: string; detected_mime: string;
        uploaded_byte_size: number; uploaded_sha256: string; version: number; object_key: string;
      }>()).results.map((row) => [row.id, row]),
  );
  let deletedCount = bundle.hot_files_deleted ?? 0;
  for (const row of pending) {
    const fact = facts.get(row.file_object_id);
    if (!fact
      || fact.purpose !== row.purpose
      || fact.visibility !== row.visibility
      || fact.detected_mime !== row.mime_type
      || fact.uploaded_byte_size !== row.byte_size
      || fact.uploaded_sha256 !== row.sha256
      || fact.version !== row.source_version) {
      throw new ArchiveJobExecutionError('file_integrity_mismatch', false);
    }
    await deps.storage.deleteObject(fact.object_key).catch(() => {
      throw new ArchiveJobExecutionError('hot_delete_failed', true);
    });
    const updated = await database.batch([
      database
        .prepare(
          `UPDATE archive_bundle_files SET delete_state='DELETED',deleted_at=?
         WHERE bundle_id=? AND file_object_id=? AND delete_state='PENDING'`,
        )
        .bind(now, bundle.id, row.file_object_id),
      database
        .prepare(
          `UPDATE archive_bundles SET hot_files_deleted=COALESCE(hot_files_deleted,0)+1,
         version=version+1,updated_at=MAX(?,updated_at+1) WHERE id=?`,
        )
        .bind(now, bundle.id),
      insertBundleEventStatement(database, bundle.id, 'HOT_FILE_DELETED', bundle.bundle_version, now, {
        entry_index: row.entry_index,
      }),
    ]);
    if (!statementChangedOnce(updated[0]!)) continue;
    deletedCount += 1;
  }
  const total = rows.length;
  await database.batch([
    database
      .prepare(
        `UPDATE archive_bundles SET hot_files_total=?,hot_delete_completed_at=?,
       version=version+1,updated_at=MAX(?,updated_at+1)
       WHERE id=? AND (SELECT COUNT(*) FROM archive_bundle_files WHERE bundle_id=? AND delete_state='DELETED')=?`,
      )
      .bind(total, now, now, bundle.id, bundle.id, total),
    insertBundleEventStatement(database, bundle.id, 'HOT_DELETE_COMPLETED', bundle.bundle_version, now, {
      files: total,
    }),
  ]);
  void deletedCount;
}

async function finalizeShadow(database: SqlDatabase, bundle: BundleRow, now: number): Promise<void> {
  const updated = await database.batch([
    database
      .prepare(
        `UPDATE archive_bundles SET shadow_completed_at=?,version=version+1,updated_at=MAX(?,updated_at+1)
       WHERE id=? AND shadow_completed_at IS NULL AND archived_at IS NULL`,
      )
      .bind(now, now, bundle.id),
    insertBundleEventStatement(database, bundle.id, 'SHADOW_COPY_COMPLETED', bundle.bundle_version, now, {
      projected_files: bundle.manifest_file_count ?? 0,
      projected_bytes: bundle.manifest_total_bytes ?? 0,
    }),
  ]);
  if (!statementChangedOnce(updated[0]!)) {
    throw new ArchiveJobExecutionError('dependency_unavailable', true);
  }
}

async function finalizeArchived(database: SqlDatabase, bundle: BundleRow, now: number): Promise<void> {
  // Single atomic batch: the job must be SUCCEEDED in the same transaction in
  // which the bundle flips to ARCHIVED (trigger-enforced fail-closed).
  const updated = await database.batch([
    database
      .prepare(
        `UPDATE archive_jobs SET state='SUCCEEDED',finished_at=?,updated_at=?,
       lease_token=NULL,lease_expires_at=NULL,next_retry_at=NULL
       WHERE bundle_id=? AND bundle_version=? AND job_type='ARCHIVE_BUNDLE' AND state IN ('LEASED','PENDING')`,
      )
      .bind(now, now, bundle.id, bundle.bundle_version),
    database
      .prepare(
        `UPDATE archive_bundles SET state='ARCHIVED',archived_at=?,version=version+1,
       updated_at=MAX(?,updated_at+1)
       WHERE id=? AND state='ONLINE'
       AND EXISTS (SELECT 1 FROM archive_jobs job WHERE job.bundle_id=? AND job.bundle_version=?
         AND job.job_type='ARCHIVE_BUNDLE' AND job.state='SUCCEEDED')`,
      )
      .bind(now, now, bundle.id, bundle.id, bundle.bundle_version),
    database
      .prepare(
        `INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN
       (SELECT state FROM archive_bundles WHERE id=?)='ARCHIVED'
       AND (SELECT state FROM archive_jobs WHERE dedupe_key=?)='SUCCEEDED' THEN 1 ELSE 0 END`,
      )
      .bind(bundle.id, `ARCHIVE_BUNDLE:${bundle.id}:${bundle.bundle_version}`),
    insertBundleEventStatement(database, bundle.id, 'ARCHIVE_FINALIZED', bundle.bundle_version, now, {}),
  ]);
  if (!statementChangedOnce(updated[1]!)) {
    throw new ArchiveJobExecutionError('dependency_unavailable', true);
  }
}

const DRIVE_CATEGORY_MAP: Record<string, ArchiveFailureCategory> = {
  authorization_failed: 'drive_authorization_failed',
  rate_limited: 'drive_rate_limited',
  service_unavailable: 'drive_unavailable',
  session_conflict: 'drive_session_conflict',
  not_found: 'drive_not_found',
  invalid_response: 'drive_verification_failed',
  interrupted: 'drive_session_conflict',
};

export function translateDriveError<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    if (error instanceof DriveArchiveClientError) {
      const category = DRIVE_CATEGORY_MAP[error.category] ?? 'drive_unavailable';
      throw new ArchiveJobExecutionError(category, category !== 'drive_not_found');
    }
    throw new ArchiveJobExecutionError('drive_unavailable', true);
  });
}

export async function hashManifestJson(manifestJson: string): Promise<string> {
  const encoder = new TextEncoder().encode(manifestJson);
  const hasher = new IncrementalSha256().update(encoder);
  return hasher.digestHex();
}
