import type { ObjectStorageAdapter, SqlDatabase } from '@ygb/contracts';

const DAY_MS = 86_400_000;
const VERIFIED_UNLINKED_TTL_MS = 30 * DAY_MS;
const UPLOADED_OR_REJECTED_TTL_MS = 7 * DAY_MS;

export interface FileRetentionRunResult {
  planned: number;
  deleted: number;
  deferred: number;
  backlog: number;
}

type Candidate = { id: string; object_key: string; status: string; delete_attempt_count: number };

/**
 * Conservative R2 retention:
 * - only objects that are known to have durable R2 bytes can enter deletion;
 * - active business links and active read intents always win over retention;
 * - never-uploaded RESERVED rows are metadata only and are not sent through
 *   the DELETION_PENDING state, whose existing schema correctly requires
 *   uploaded byte/hash/mime facts;
 * - D1 marks DELETION_PENDING first, R2 is deleted second, D1 becomes DELETED
 *   only after the storage delete succeeds.
 */
export async function reconcileUnlinkedFileRetention(
  database: SqlDatabase,
  storage: ObjectStorageAdapter,
  input: { now: number; limit?: number; deadlineReached?: () => boolean; dryRun?: boolean },
): Promise<FileRetentionRunResult> {
  const now = input.now,
    limit = input.limit ?? 25;
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error('invalid_file_retention_input');
  const planRows = await database
    .prepare(
      `SELECT object.id,object.object_key,object.status,object.delete_attempt_count
    FROM file_objects object JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
    WHERE object.status IN('UPLOADED','VERIFIED','REJECTED')
      AND object.uploaded_byte_size IS NOT NULL
      AND object.detected_mime IS NOT NULL
      AND object.uploaded_sha256 IS NOT NULL
      AND object.uploaded_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM file_entity_links link WHERE link.file_object_id=object.id AND link.revoked_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM file_read_intents read_intent WHERE read_intent.file_object_id=object.id AND read_intent.status='ISSUED' AND read_intent.expires_at>?)
      AND (
        (object.status='VERIFIED' AND object.verified_at<=?)
        OR (object.status IN('UPLOADED','REJECTED') AND object.updated_at<=?)
      )
    ORDER BY object.updated_at,object.id LIMIT ?`,
    )
    .bind(now, now - VERIFIED_UNLINKED_TTL_MS, now - UPLOADED_OR_REJECTED_TTL_MS, limit)
    .all<Candidate>();
  if (input.dryRun === true)
    return {
      planned: planRows.results.length,
      deleted: 0,
      deferred: 0,
      backlog: await countBacklog(database, now),
    };
  let planned = 0;
  for (const row of planRows.results) {
    if (input.deadlineReached?.()) break;
    const result = await database
      .prepare(
        `UPDATE file_objects
      SET status='DELETION_PENDING',next_delete_at=?,failure_code='RETENTION_UNLINKED',
        verified_at=NULL,version=version+1,updated_at=MAX(?,updated_at+1)
      WHERE id=? AND status=?
        AND uploaded_byte_size IS NOT NULL AND detected_mime IS NOT NULL
        AND uploaded_sha256 IS NOT NULL AND uploaded_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM file_entity_links link WHERE link.file_object_id=file_objects.id AND link.revoked_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM file_read_intents read_intent WHERE read_intent.file_object_id=file_objects.id AND read_intent.status='ISSUED' AND read_intent.expires_at>?)`,
      )
      .bind(now, now, row.id, row.status, now)
      .run();
    planned += Number(result.meta.changes ?? 0);
  }
  const deleteRows = await database
    .prepare(
      `SELECT object.id,object.object_key,object.status,object.delete_attempt_count
    FROM file_objects object
    WHERE object.status='DELETION_PENDING' AND object.next_delete_at<=?
      AND object.failure_code IN('RETENTION_UNLINKED','RETENTION_DELETE_RETRY')
      AND NOT EXISTS(SELECT 1 FROM file_entity_links link WHERE link.file_object_id=object.id AND link.revoked_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM file_read_intents read_intent WHERE read_intent.file_object_id=object.id AND read_intent.status='ISSUED' AND read_intent.expires_at>?)
    ORDER BY object.next_delete_at,object.updated_at,object.id LIMIT ?`,
    )
    .bind(now, now, limit)
    .all<Candidate>();
  let deleted = 0,
    deferred = 0;
  for (const row of deleteRows.results) {
    if (input.deadlineReached?.()) break;
    try {
      await storage.deleteObject(row.object_key);
      const result = await database
        .prepare(
          `UPDATE file_objects
        SET status='DELETED',delete_attempt_count=delete_attempt_count+1,next_delete_at=NULL,
          failure_code='RETENTION_DELETED',verified_at=NULL,version=version+1,
          updated_at=MAX(?,updated_at+1),deleted_at=?
        WHERE id=? AND status='DELETION_PENDING'
          AND NOT EXISTS(SELECT 1 FROM file_entity_links link WHERE link.file_object_id=file_objects.id AND link.revoked_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM file_read_intents read_intent WHERE read_intent.file_object_id=file_objects.id AND read_intent.status='ISSUED' AND read_intent.expires_at>?)`,
        )
        .bind(now, now, row.id, now)
        .run();
      deleted += Number(result.meta.changes ?? 0);
    } catch {
      const attempts = Number(row.delete_attempt_count) + 1;
      const delay = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.min(attempts, 7));
      await database
        .prepare(
          `UPDATE file_objects
        SET delete_attempt_count=delete_attempt_count+1,next_delete_at=?,failure_code='RETENTION_DELETE_RETRY',
          version=version+1,updated_at=MAX(?,updated_at+1)
        WHERE id=? AND status='DELETION_PENDING'`,
        )
        .bind(now + delay, now, row.id)
        .run();
      deferred += 1;
    }
  }
  return { planned, deleted, deferred, backlog: await countBacklog(database, now) };
}

async function countBacklog(database: SqlDatabase, now: number): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM file_objects object
    JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
    WHERE (
      (object.status='DELETION_PENDING' AND object.next_delete_at<=? AND object.failure_code IN('RETENTION_UNLINKED','RETENTION_DELETE_RETRY'))
      OR (object.status='VERIFIED' AND object.verified_at<=?)
      OR (object.status IN('UPLOADED','REJECTED') AND object.updated_at<=?)
    )
    AND object.uploaded_byte_size IS NOT NULL
    AND object.detected_mime IS NOT NULL
    AND object.uploaded_sha256 IS NOT NULL
    AND object.uploaded_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM file_entity_links link WHERE link.file_object_id=object.id AND link.revoked_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM file_read_intents read_intent WHERE read_intent.file_object_id=object.id AND read_intent.status='ISSUED' AND read_intent.expires_at>?)`,
    )
    .bind(now, now - VERIFIED_UNLINKED_TTL_MS, now - UPLOADED_OR_REJECTED_TTL_MS, now)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}
