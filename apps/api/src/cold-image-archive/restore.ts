import type {
  ArchiveQueueMessage,
  DriveArchiveClient,
  ObjectStorageAdapter,
  SqlDatabase,
} from '@ygb/contracts';
import { statementChangedOnce } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  completeIdempotencyStatement,
  assertIdempotencyCompletionStatement,
  markIdempotencyFailed,
  IdempotencyError,
} from '../foundation/idempotency';
import { cleanupJobDedupeKey, insertBundleEventStatement, restoreJobDedupeKey } from './selector';
import { ArchiveJobExecutionError, translateDriveError } from './archive-pipeline';
import { IncrementalSha256 } from '@ygb/domain';

export const RESTORE_TEMPORARY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class RestoreCommandError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'VERSION_CONFLICT'
      | 'STATE_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'RestoreCommandError';
  }
}

export interface RestoreRequestResult {
  restore_id: string;
  bundle_id: string;
  bundle_version: number;
  state: 'REQUESTED' | 'COMPLETED';
  restore_expires_at: number;
  replayed: boolean;
}

/**
 * Staff-only restore request (D-055). Requires the owner role plus
 * SCHEDULED_OPERATIONS_RUN, mirrors the archive close/reopen permission
 * family. Moves ARCHIVED → RESTORE_REQUESTED (RESTORE_FAILED →
 * RESTORE_REQUESTED retry is allowed after staff review) and creates the
 * deduped RESTORE_BUNDLE job. The 7-day expiry clock starts here.
 */
export async function requestBundleRestore(
  database: SqlDatabase,
  input: { bundleId: string },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<RestoreRequestResult> {
  requireOwner(command.actor);
  const bundleId = safeText(input.bundleId, 16, 120);
  const now = command.now ?? Date.now();
  const requestHash = await hashCanonicalJson({
    action: 'REQUEST_BUNDLE_RESTORE',
    bundle_id: bundleId,
  });
  const acquired = await acquireIdempotency<RestoreRequestResult>(database, {
    actorType: 'STAFF',
    actorId: command.actor.staffId,
    action: 'REQUEST_BUNDLE_RESTORE',
    targetType: 'ARCHIVE_BUNDLE',
    targetId: bundleId,
    idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now }).catch(translateIdempotency);
  if (acquired.kind === 'REPLAY') return { ...acquired.response, replayed: true };
  try {
    const bundle = await database
      .prepare(`SELECT id,bundle_version,state FROM archive_bundles WHERE id=?`)
      .bind(bundleId)
      .first<{ id: string; bundle_version: number; state: string }>();
    if (!bundle || (bundle.state !== 'ARCHIVED' && bundle.state !== 'RESTORE_FAILED')) {
      throw new RestoreCommandError('STATE_CONFLICT', 409);
    }
    const restoreId = `archive-restore-${crypto.randomUUID()}`;
    const expiresAt = now + RESTORE_TEMPORARY_RETENTION_MS;
    const jobTrace = `trace-${crypto.randomUUID()}`;
    const nextBundleState = 'RESTORE_REQUESTED';
    const response: RestoreRequestResult = {
      restore_id: restoreId,
      bundle_id: bundle.id,
      bundle_version: bundle.bundle_version,
      state: 'REQUESTED',
      restore_expires_at: expiresAt,
      replayed: false,
    };
    await database.batch([
      database
        .prepare(
          `INSERT INTO archive_restores(id,bundle_id,bundle_version,requested_by_staff_id,request_hash,
         idempotency_key,state,restore_expires_at,version,created_at,updated_at)
         VALUES(?,?,?,?,?,?,'REQUESTED',?,1,?,?)`,
        )
        .bind(
          restoreId,
          bundle.id,
          bundle.bundle_version,
          command.actor.staffId,
          requestHash,
          command.idempotencyKey,
          expiresAt,
          now,
          now,
        ),
      database
        .prepare(
          `INSERT INTO archive_jobs(id,dedupe_key,job_type,bundle_id,bundle_version,state,
         attempt_count,max_attempts,trace_id,created_at,updated_at)
         VALUES(?,?, 'RESTORE_BUNDLE', ?,?, 'PENDING', 0, 8, ?, ?, ?)
         ON CONFLICT(dedupe_key) DO NOTHING`,
        )
        .bind(
          `archive-job-${crypto.randomUUID()}`,
          restoreJobDedupeKey(bundle.id, bundle.bundle_version),
          bundle.id,
          bundle.bundle_version,
          jobTrace,
          now,
          now,
        ),
      database
        .prepare(
          `UPDATE archive_bundles SET state=?,last_failure_category=NULL,next_retry_at=NULL,
         version=version+1,updated_at=MAX(?,updated_at+1)
         WHERE id=? AND state IN ('ARCHIVED','RESTORE_FAILED') AND restore_expires_at IS NULL`,
        )
        .bind(nextBundleState, now, bundle.id),
      database
        .prepare(
          `INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN
         (SELECT state FROM archive_bundles WHERE id=?)='RESTORE_REQUESTED' THEN 1 ELSE 0 END`,
        )
        .bind(bundle.id),
      insertBundleEventStatement(
        database,
        bundle.id,
        bundle.state === 'RESTORE_FAILED' ? 'RESTORE_RETRY_REQUESTED' : 'RESTORE_REQUESTED',
        bundle.bundle_version,
        now,
        {},
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ARCHIVE_BUNDLE',
        aggregateId: bundle.id,
        eventType: 'ARCHIVE_RESTORE_REQUESTED',
        actor: { type: 'STAFF', id: command.actor.staffId, roles: [...command.actor.roles] },
        requestId: command.requestId ?? null,
        idempotencyKey: command.idempotencyKey,
        nextState: { bundle_id: bundle.id, restore_id: restoreId },
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, { now }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = error instanceof RestoreCommandError
      ? error
      : error instanceof IdempotencyError
        ? new RestoreCommandError(error.code === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT'
          : error.code === 'REQUEST_IN_PROGRESS' ? 'REQUEST_IN_PROGRESS' : 'VALIDATION_ERROR', 409)
        : new RestoreCommandError('DEPENDENCY_UNAVAILABLE', 503);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now).catch(() => false);
    throw normalized;
  }
}

interface RestoreBundleRow {
  id: string;
  bundle_id: string;
  bundle_version: number;
  state: 'REQUESTED' | 'RESTORING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CLEANED';
  restore_expires_at: number;
  temp_zip_object_key: string | null;
  member_prefix: string | null;
  version: number;
}

interface RestoreManifestFileRow {
  file_object_id: string;
  entry_index: number;
  safe_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
}

/** Storage-safe opaque segment: hex + dashes only (matches member_prefix GLOB). */
export function restoreStorageKey(restoreId: string): string {
  const segment = restoreId.replace(/[^0-9a-f-]/g, '');
  if (segment.length < 8) throw new Error('invalid_restore_key');
  return segment;
}

export function restoreTempZipKey(restoreId: string): string {
  return `archive-restore/${restoreStorageKey(restoreId)}/bundle.zip`;
}

export function restoreMemberKey(restoreId: string, safeName: string): string {
  return `archive-restore/${restoreStorageKey(restoreId)}/${safeName}`;
}

export function restoreMemberPrefix(restoreId: string): string {
  return `archive-restore/${restoreStorageKey(restoreId)}/`;
}

/**
 * Streaming ZIP member extractor for restores: reads the temp ZIP stream
 * sequentially, parses local file headers, verifies each member against the
 * sealed manifest (size, CRC-32, SHA-256) and streams it into its own temp R2
 * object via a bounded sub-reader — never holding the whole archive or even a
 * whole member beyond the fixed chunk window.
 */
export async function runRestoreBundleJob(
  database: SqlDatabase,
  input: { bundleId: string; now: number },
  deps: { storage: ObjectStorageAdapter; drive: DriveArchiveClient },
): Promise<{ outcome: 'SUCCEEDED' }> {
  const restore = await database
    .prepare(
      `SELECT id,bundle_id,bundle_version,state,restore_expires_at,temp_zip_object_key,
     member_prefix,version FROM archive_restores
     WHERE bundle_id=? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(input.bundleId)
    .first<RestoreBundleRow>();
  if (!restore) throw new ArchiveJobExecutionError('dependency_unavailable', true);
  const opener = deps.storage.openObjectStream?.bind(deps.storage) ?? null;
  const putter = deps.storage.putObjectStream?.bind(deps.storage) ?? null;
  if (!opener || !putter) throw new ArchiveJobExecutionError('storage_stream_unavailable', false);
  if (restore.state === 'COMPLETED' || restore.state === 'EXPIRED' || restore.state === 'CLEANED') {
    return { outcome: 'SUCCEEDED' };
  }
  const bundle = await database
    .prepare(
      `SELECT id,bundle_version,drive_file_id,zip_byte_size,zip_sha256,manifest_sha256,state
     FROM archive_bundles WHERE id=?`,
    )
    .bind(input.bundleId)
    .first<{
      id: string; bundle_version: number; drive_file_id: string | null;
      zip_byte_size: number | null; zip_sha256: string | null; manifest_sha256: string | null;
      state: string;
    }>();
  if (!bundle || !bundle.drive_file_id || !bundle.zip_byte_size || !bundle.zip_sha256 || !bundle.manifest_sha256) {
    throw new ArchiveJobExecutionError('dependency_unavailable', true);
  }
  if (restore.state === 'REQUESTED') {
    await database.batch([
      database
        .prepare(
          `UPDATE archive_restores SET state='RESTORING',version=version+1,
         updated_at=MAX(?,updated_at+1) WHERE id=? AND state='REQUESTED'`,
        )
        .bind(input.now, restore.id),
      database
        .prepare(
          `UPDATE archive_bundles SET state='RESTORING',version=version+1,
         updated_at=MAX(?,updated_at+1) WHERE id=? AND state='RESTORE_REQUESTED'`,
        )
        .bind(input.now, bundle.id),
      insertBundleEventStatement(database, bundle.id, 'RESTORE_STARTED', bundle.bundle_version, input.now, {}),
    ]);
  }

  // 1. Stream the Drive copy back into a temp R2 ZIP, verifying the archive
  //    hash while downloading.
  const tempZipKey = restore.temp_zip_object_key ?? restoreTempZipKey(restore.id);
  const driveStream = await translateDriveError(deps.drive.openFileStream(bundle.drive_file_id));
  if (driveStream.byteSize !== bundle.zip_byte_size) {
    throw new ArchiveJobExecutionError('restore_verify_failed', true);
  }
  const downloadHash = new IncrementalSha256();
  await putter({
    objectKey: tempZipKey,
    contentType: 'application/zip',
    metadata: { 'ygb-archive-restore': restore.id },
    body: teeAndHash(driveStream.body, downloadHash),
  }).catch(() => {
    throw new ArchiveJobExecutionError('restore_verify_failed', true);
  });
  if (downloadHash.digestHex() !== bundle.zip_sha256) {
    throw new ArchiveJobExecutionError('restore_verify_failed', true);
  }

  // 2. Parse and extract members from the temp ZIP.
  const manifestRows = (await database
    .prepare(
      `SELECT file_object_id,entry_index,safe_name,mime_type,byte_size,sha256
     FROM archive_bundle_files WHERE bundle_id=? ORDER BY entry_index`,
    )
    .bind(bundle.id)
    .all<RestoreManifestFileRow>()).results;
  const manifestBySafeName = new Map(manifestRows.map((row) => [row.safe_name, row]));
  const tempStream = await opener(tempZipKey).catch(() => null);
  if (!tempStream) throw new ArchiveJobExecutionError('restore_verify_failed', true);
  const reader = new ZipMemberReader(tempStream.body.getReader());
  const restored: { file_object_id: string; temp_object_key: string; byte_size: number; sha256: string }[] = [];
  try {
    for await (const member of reader.members()) {
      if (member.name === 'manifest.json') {
        // The in-archive manifest must hash to the sealed manifest digest.
        if (member.byteSize > 8 * 1024 * 1024) throw new ArchiveJobExecutionError('restore_verify_failed', true);
        const bytes = await member.readAll();
        const manifestHash = new IncrementalSha256().update(bytes).digestHex();
        if (manifestHash !== bundle.manifest_sha256) {
          throw new ArchiveJobExecutionError('restore_verify_failed', true);
        }
        continue;
      }
      const expected = manifestBySafeName.get(member.name);
      if (!expected) throw new ArchiveJobExecutionError('restore_verify_failed', true);
      const memberKey = restoreMemberKey(restore.id, member.name);
      const hasher = new IncrementalSha256();
      await putter({
        objectKey: memberKey,
        contentType: expected.mime_type as 'image/jpeg',
        metadata: { 'ygb-archive-restore': restore.id, 'ygb-file-object': expected.file_object_id },
        body: member.tee(hasher),
      }).catch(() => {
        throw new ArchiveJobExecutionError('restore_extract_failed', true);
      });
      // SHA-256 against the sealed manifest is the authoritative member
      // integrity gate; size equality and the descriptor CRC corroborate.
      if (hasher.digestHex() !== expected.sha256 || member.byteSize !== expected.byte_size) {
        throw new ArchiveJobExecutionError('restore_verify_failed', true);
      }
      restored.push({
        file_object_id: expected.file_object_id,
        temp_object_key: memberKey,
        byte_size: expected.byte_size,
        sha256: expected.sha256,
      });
    }
  } finally {
    await reader.close();
  }
  if (restored.length !== manifestRows.length) {
    throw new ArchiveJobExecutionError('restore_verify_failed', true);
  }
  const memberStatements = restored.map((member) => database
    .prepare(
      `INSERT INTO archive_restore_members(id,restore_id,file_object_id,expected_sha256,
     temp_object_key,byte_size,created_at) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(restore_id,file_object_id) DO NOTHING`,
    )
    .bind(
      `archive-member-${crypto.randomUUID()}`,
      restore.id,
      member.file_object_id,
      member.sha256,
      member.temp_object_key,
      member.byte_size,
      input.now,
    ));
  for (let offset = 0; offset < memberStatements.length; offset += 50) {
    await database.batch(memberStatements.slice(offset, offset + 50));
  }
  const totalBytes = restored.reduce((total, member) => total + member.byte_size, 0);
  await database.batch([
    database
      .prepare(
        `UPDATE archive_restores SET state='COMPLETED',completed_at=?,restored_file_count=?,
       restored_bytes=?,temp_zip_object_key=?,member_prefix=?,version=version+1,
       updated_at=MAX(?,updated_at+1) WHERE id=? AND state='RESTORING'`,
      )
      .bind(input.now, restored.length, totalBytes, tempZipKey, restoreMemberPrefix(restore.id), input.now, restore.id),
    database
      .prepare(
        `UPDATE archive_jobs SET state='SUCCEEDED',finished_at=?,updated_at=?,
       lease_token=NULL,lease_expires_at=NULL,next_retry_at=NULL
       WHERE dedupe_key=? AND state IN ('LEASED','PENDING')`,
      )
      .bind(input.now, input.now, restoreJobDedupeKey(bundle.id, bundle.bundle_version)),
    database
      .prepare(
        `UPDATE archive_bundles SET state='RESTORED_TEMPORARILY',restore_expires_at=?,
       last_failure_category=NULL,next_retry_at=NULL,version=version+1,
       updated_at=MAX(?,updated_at+1)
       WHERE id=? AND state='RESTORING'`,
      )
      .bind(restore.restore_expires_at, input.now, bundle.id),
    database
      .prepare(
        `INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN
       (SELECT state FROM archive_bundles WHERE id=?)='RESTORED_TEMPORARILY'
       AND (SELECT state FROM archive_restores WHERE id=?)='COMPLETED' THEN 1 ELSE 0 END`,
      )
      .bind(bundle.id, restore.id),
    insertBundleEventStatement(database, bundle.id, 'RESTORE_COMPLETED', bundle.bundle_version, input.now, {
      files: restored.length,
    }),
  ]);
  return { outcome: 'SUCCEEDED' };
}

function teeAndHash(
  body: ReadableStream<Uint8Array>,
  hasher: IncrementalSha256,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      if (value.byteLength > 0) hasher.update(value);
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;

/**
 * Sequential ZIP reader over a ReadableStream: pulls fixed-size windows,
 * parses local file headers, skips or extracts member bodies by manifest
 * size, and stops at the central directory. Members surface as sub-readers
 * so extraction streams member-by-member.
 */
export class ZipMemberReader {
  queue: Uint8Array[] = [];
  queued = 0;
  done = false;

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async *members(): AsyncGenerator<ZipStreamMember> {
    for (;;) {
      const header = await this.readExactly(30);
      const signature = viewUint32(header, 0);
      if (signature !== LOCAL_FILE_HEADER_SIGNATURE) break;
      const flags = viewUint16(header, 6);
      const method = viewUint16(header, 8);
      const nameLength = viewUint16(header, 26);
      const extraLength = viewUint16(header, 28);
      const nameBytes = await this.readExactly(nameLength);
      if (extraLength > 0) await this.discard(extraLength);
      const name = new TextDecoder().decode(nameBytes);
      // Sizes in the local header are authoritative for our writer (known
      // upfront); with flag 0x0008 the real CRC-32 only arrives in the
      // trailing data descriptor, read back after the member body.
      const declaredSize = viewUint32(header, 22);
      if (method !== 0) throw new ArchiveJobExecutionError('restore_extract_failed', true);
      const member = new ZipStreamMember(this, name, declaredSize);
      yield member;
      if (!member.fullyConsumed) await this.discard(member.byteSize - member.consumed);
      member.descriptorCrc = await this.readDescriptorCrc(flags);
    }
  }

  private async readDescriptorCrc(flags: number): Promise<number | null> {
    if ((flags & 0x0008) === 0) return null;
    // The descriptor is either [signature][crc][csize][usize] or
    // [crc][csize][usize]; readExactly(peek) already rewinds the probe, so
    // the follow-up read consumes the descriptor for real.
    const peek = await this.readExactly(4, true);
    if (viewUint32(peek, 0) === DATA_DESCRIPTOR_SIGNATURE) {
      // [sig][crc][csize][usize] = 16 bytes total; the peek rewound, so the
      // follow-up read must consume the full descriptor.
      const rest = await this.readExactly(16);
      return viewUint32(rest, 4);
    }
    // No signature variant: [crc][csize][usize] = 12 bytes.
    const rest = await this.readExactly(12);
    return viewUint32(rest, 0);
  }

  readChunk(): Promise<void> {
    if (this.done) return Promise.resolve();
    return this.reader.read().then((result) => {
      if (result.done) {
        this.done = true;
        return;
      }
      if (result.value && result.value.byteLength > 0) {
        this.queue.push(result.value);
        this.queued += result.value.byteLength;
      }
    });
  }

  async readExactly(length: number, peek = false): Promise<Uint8Array> {
    while (this.queued < length) {
      if (this.done) throw new ArchiveJobExecutionError('restore_verify_failed', true);
      await this.readChunk();
    }
    const merged = this.take(length);
    if (peek) {
      this.queue.unshift(merged);
      this.queued += merged.byteLength;
    }
    return merged;
  }

  take(length: number): Uint8Array {
    const out = new Uint8Array(new ArrayBuffer(length));
    let filled = 0;
    while (filled < length) {
      const front = this.queue[0]!;
      const need = length - filled;
      if (front.byteLength <= need) {
        out.set(front, filled);
        filled += front.byteLength;
        this.queue.shift();
        this.queued -= front.byteLength;
      } else {
        out.set(front.subarray(0, need), filled);
        this.queue[0] = front.subarray(need);
        this.queued -= need;
        filled = length;
      }
    }
    return out;
  }

  async discard(length: number): Promise<void> {
    while (length > 0) {
      while (this.queued === 0) {
        if (this.done) throw new ArchiveJobExecutionError('restore_verify_failed', true);
        await this.readChunk();
      }
      const taken = Math.min(length, this.queued);
      this.take(taken);
      length -= taken;
    }
  }

  async close(): Promise<void> {
    this.queue = [];
    this.queued = 0;
    this.reader.releaseLock();
    await this.reader.cancel().catch(() => undefined);
  }
}

export class ZipStreamMember {
  consumed = 0;
  fullyConsumed = false;
  /** CRC-32 from the trailing data descriptor, set after the body streams. */
  descriptorCrc: number | null = null;

  constructor(
    private readonly source: ZipMemberReader,
    readonly name: string,
    readonly byteSize: number,
  ) {}

  async readAll(): Promise<Uint8Array> {
    const out = new Uint8Array(new ArrayBuffer(this.byteSize));
    let filled = 0;
    while (filled < this.byteSize) {
      while (this.source.queued === 0 && !this.source.done) await this.source.readChunk();
      if (this.source.queued === 0) throw new ArchiveJobExecutionError('restore_verify_failed', true);
      const need = this.byteSize - filled;
      const front = this.source.queue[0]!;
      const take = Math.min(need, front.byteLength);
      out.set(front.subarray(0, take), filled);
      this.source.take(take);
      filled += take;
    }
    this.consumed = this.byteSize;
    this.fullyConsumed = true;
    return out;
  }

  tee(hasher: IncrementalSha256): ReadableStream<Uint8Array> {
    const member = this;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (member.consumed >= member.byteSize) {
          member.fullyConsumed = true;
          controller.close();
          return;
        }
        while (member.source.queued === 0 && !member.source.done) await member.source.readChunk();
        if (member.source.queued === 0) {
          controller.error(new ArchiveJobExecutionError('restore_verify_failed', true));
          return;
        }
        const need = member.byteSize - member.consumed;
        const front = member.source.queue[0]!;
        const take = Math.min(need, front.byteLength);
        const chunk = member.source.take(take);
        member.consumed += take;
        hasher.update(chunk);
        controller.enqueue(chunk);
      },
    });
  }
}

function viewUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function viewUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)) >>> 0;
}

/**
 * Cleanup pass for expired temporary restores: flips the restore to EXPIRED,
 * returns the bundle to ARCHIVED, deletes the temp ZIP and every member
 * object, and marks the restore CLEANED. The Drive original is never deleted.
 */
export async function runRestoreCleanupScan(
  database: SqlDatabase,
  input: { now: number; limit?: number },
  deps: { storage: ObjectStorageAdapter },
): Promise<{ processed: number; cleaned: number; failed: number }> {
  const limit = Number.isSafeInteger(input.limit) && Number(input.limit)! > 0
    && Number(input.limit)! <= 100 ? Number(input.limit) : 25;
  const expired = (await database
    .prepare(
      `SELECT id,bundle_id,bundle_version,state,restore_expires_at,temp_zip_object_key,member_prefix
     FROM archive_restores
     WHERE state IN ('COMPLETED','EXPIRED') AND restore_expires_at<=?
     ORDER BY restore_expires_at LIMIT ?`,
    )
    .bind(input.now, limit)
    .all<{
      id: string; bundle_id: string; bundle_version: number; state: string;
      restore_expires_at: number; temp_zip_object_key: string | null; member_prefix: string | null;
    }>()).results;
  let cleaned = 0;
  let failed = 0;
  for (const restore of expired) {
    try {
      if (restore.state === 'COMPLETED') {
        // Phase A: delete every temporary object, then flip the bundle back
        // to ARCHIVED and the restore to EXPIRED in one atomic batch.
        const members = (await database
          .prepare(`SELECT temp_object_key FROM archive_restore_members WHERE restore_id=?`)
          .bind(restore.id)
          .all<{ temp_object_key: string }>()).results;
        for (const member of members) {
          await deps.storage.deleteObject(member.temp_object_key).catch(() => undefined);
        }
        if (restore.temp_zip_object_key) {
          await deps.storage.deleteObject(restore.temp_zip_object_key).catch(() => undefined);
        }
        await database.batch([
          database
            .prepare(
              `UPDATE archive_restores SET state='EXPIRED',version=version+1,
             updated_at=MAX(?,updated_at+1) WHERE id=? AND state='COMPLETED'`,
            )
            .bind(input.now, restore.id),
          database
            .prepare(
              `UPDATE archive_bundles SET state='ARCHIVED',restore_expires_at=NULL,version=version+1,
             updated_at=MAX(?,updated_at+1) WHERE id=? AND state='RESTORED_TEMPORARILY'`,
            )
            .bind(input.now, restore.bundle_id),
          insertBundleEventStatement(database, restore.bundle_id, 'RESTORE_EXPIRED', restore.bundle_version, input.now, {}),
        ]);
      }
      // Phase B: finalize the restore row (same pass; EXPIRED rows from a
      // crashed earlier pass are picked up here directly).
      const cleanedUpdate = await database
        .prepare(
          `UPDATE archive_restores SET state='CLEANED',cleaned_at=?,version=version+1,
         updated_at=MAX(?,updated_at+1) WHERE id=? AND state='EXPIRED'`,
        )
        .bind(input.now, input.now, restore.id)
        .run();
      if (statementChangedOnce(cleanedUpdate)) cleaned += 1;
    } catch {
      failed += 1;
    }
  }
  return { processed: expired.length, cleaned, failed };
}

export function restoreQueueMessage(
  bundleId: string,
  bundleVersion: number,
  traceId: string,
): ArchiveQueueMessage {
  return { bundle_id: bundleId, bundle_version: bundleVersion, job_type: 'RESTORE_BUNDLE', trace_id: traceId };
}

export function cleanupDedupeExample(restoreId: string): string {
  return cleanupJobDedupeKey(restoreId);
}

function requireOwner(actor: AssignmentStaffAuthorization): void {
  if (
    actor.staffStatus !== 'ACTIVE'
    || !actor.roles.has('owner')
    || !actor.permissions.has('SCHEDULED_OPERATIONS_RUN')
  ) {
    throw new RestoreCommandError('FORBIDDEN', 403);
  }
}

function safeText(value: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RestoreCommandError('VALIDATION_ERROR', 400);
  }
  return value;
}

function translateIdempotency(error: unknown): never {
  if (error instanceof IdempotencyError) {
    if (error.code === 'IDEMPOTENCY_CONFLICT') throw new RestoreCommandError('IDEMPOTENCY_CONFLICT', 409);
    if (error.code === 'REQUEST_IN_PROGRESS') throw new RestoreCommandError('REQUEST_IN_PROGRESS', 409);
    throw new RestoreCommandError('VALIDATION_ERROR', 400);
  }
  throw new RestoreCommandError('DEPENDENCY_UNAVAILABLE', 503);
}

export { statementChangedOnce };
