import type {
  DriveArchiveAdapter,
  FileDriveArchiveState,
  ObjectStorageAdapter,
  SqlDatabase,
  SupportedFileMime,
} from '@ygb/contracts';
import { isColdArchivePurpose, statementChangedOnce } from '@ygb/contracts';
import { detectSupportedMime, hashCanonicalJson, sha256Hex } from '@ygb/domain';
import { ingestScheduledOperationalSignal } from '../scheduled-operations/signals';

const LEASE_MS = 90_000;
const MAX_BATCH = 50;
interface Candidate {
  file_object_id: string;
  purpose: string;
  archive_due_at: number;
}
interface ArchiveRow extends Candidate {
  status: FileDriveArchiveState;
  drive_file_id: string | null;
  drive_folder_id: string | null;
  owner_account_key: string | null;
  resumable_session_key: string | null;
  uploaded_byte_size: number | null;
  uploaded_mime: SupportedFileMime | null;
  uploaded_sha256: string | null;
  attempt_count: number;
  version: number;
  lease_token: string | null;
}
interface SourceFile {
  object_key: string;
  client_file_name: string;
  detected_mime: SupportedFileMime;
  uploaded_byte_size: number;
  uploaded_sha256: string;
}

export interface DriveArchiveBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  backlog: number;
  failureCategory?: string;
}

export async function reconcileDriveArchiveBatch(
  database: SqlDatabase,
  drive: DriveArchiveAdapter,
  input: { now?: number; limit?: number; deadlineReached?: () => boolean },
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const now = input.now ?? Date.now();
  const limit =
    Number.isSafeInteger(input.limit) && Number(input.limit) > 0 && Number(input.limit) <= 10
      ? Number(input.limit)
      : 5;
  const rows = await database
    .prepare(
      `
    SELECT archive.file_object_id,archive.drive_file_id,manifest.byte_size,manifest.mime_type,manifest.sha256
    FROM file_drive_archives archive JOIN file_drive_archive_manifests manifest
      ON manifest.file_object_id=archive.file_object_id
    WHERE archive.status='DRIVE_ARCHIVED'
    ORDER BY COALESCE((SELECT MAX(check_row.checked_at) FROM file_drive_archive_reconciliations check_row
      WHERE check_row.file_object_id=archive.file_object_id),0),archive.file_object_id LIMIT ?
  `,
    )
    .bind(limit)
    .all<{
      file_object_id: string;
      drive_file_id: string;
      byte_size: number;
      mime_type: SupportedFileMime;
      sha256: string;
    }>();
  let succeeded = 0;
  let failed = 0;
  for (const row of rows.results) {
    if (input.deadlineReached?.()) break;
    try {
      const value = await drive.readFile(row.drive_file_id);
      await verifyBytes(value.bytes, row.mime_type, row.byte_size, row.sha256);
      await database
        .prepare(
          `INSERT INTO file_drive_archive_reconciliations(id,file_object_id,result,
        failure_category,checked_byte_size,checked_mime,checked_sha256,checked_at)
        VALUES(?,?,'HEALTHY',NULL,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          row.file_object_id,
          value.byteSize,
          value.mimeType,
          await sha256Hex(value.bytes),
          now,
        )
        .run();
      succeeded += 1;
    } catch (error) {
      const category = classifyReconciliation(error);
      await database
        .prepare(
          `INSERT INTO file_drive_archive_reconciliations(id,file_object_id,result,
        failure_category,checked_byte_size,checked_mime,checked_sha256,checked_at)
        VALUES(?,?,'FAILED',?,NULL,NULL,NULL,?)`,
        )
        .bind(crypto.randomUUID(), row.file_object_id, category, now)
        .run();
      await recordFailureSignal(database, row.file_object_id, now);
      failed += 1;
    }
  }
  return { processed: succeeded + failed, succeeded, failed };
}

export async function runDriveArchiveBatch(
  database: SqlDatabase,
  r2: ObjectStorageAdapter,
  drive: DriveArchiveAdapter,
  input: {
    now?: number;
    limit?: number;
    copyEnabled: boolean;
    proxyReadEnabled: boolean;
    r2DeleteEnabled: boolean;
    dryRun?: boolean;
    deadlineReached?: () => boolean;
  },
): Promise<DriveArchiveBatchResult> {
  const now = input.now ?? Date.now();
  const limit =
    Number.isSafeInteger(input.limit) && Number(input.limit) > 0 && Number(input.limit) <= MAX_BATCH
      ? Number(input.limit)
      : MAX_BATCH;
  const controls = await readControls(database);
  if (!input.copyEnabled || controls.copy_enabled !== 1)
    return { processed: 0, succeeded: 0, failed: 0, backlog: await countBacklog(database, now) };
  const candidates = await eligibleCandidates(database, now, limit + 1);
  if (input.dryRun) return { processed: 0, succeeded: 0, failed: 0, backlog: candidates.length };
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  for (const candidate of candidates.slice(0, limit)) {
    if (input.deadlineReached?.()) break;
    processed += 1;
    try {
      const outcome = await processCandidate(database, r2, drive, candidate, {
        now,
        allowDelete:
          input.proxyReadEnabled &&
          input.r2DeleteEnabled &&
          controls.proxy_read_enabled === 1 &&
          controls.r2_delete_enabled === 1,
      });
      if (outcome === 'SUCCEEDED') succeeded += 1;
    } catch (error) {
      failed += 1;
      await recordFailureSignal(database, candidate.file_object_id, now);
    }
  }
  return {
    processed,
    succeeded,
    failed,
    backlog: await countBacklog(database, now),
    ...(failed ? { failureCategory: 'job_item_failed' } : {}),
  };
}

async function processCandidate(
  database: SqlDatabase,
  r2: ObjectStorageAdapter,
  drive: DriveArchiveAdapter,
  candidate: Candidate,
  input: { now: number; allowDelete: boolean },
): Promise<'SUCCEEDED' | 'DEFERRED'> {
  if (!isColdArchivePurpose(candidate.purpose)) throw new Error('archive_purpose_not_allowed');
  await database.batch([
    database
      .prepare(
        `INSERT INTO file_drive_archives(
      file_object_id,purpose,status,archive_due_at,version,created_at,updated_at
    ) VALUES(?,?,'R2_HOT',?,1,?,?) ON CONFLICT(file_object_id) DO NOTHING`,
      )
      .bind(
        candidate.file_object_id,
        candidate.purpose,
        candidate.archive_due_at,
        input.now,
        input.now,
      ),
    database
      .prepare(
        `INSERT INTO file_drive_archive_events(id,file_object_id,event_type,previous_status,next_status,
      archive_version,failure_category,metadata_json,created_at)
      SELECT ?,?,'ELIGIBILITY_RECORDED','R2_HOT','R2_HOT',1,NULL,'{}',? WHERE changes()=1`,
      )
      .bind(crypto.randomUUID(), candidate.file_object_id, input.now),
  ]);
  const token = `drive-archive:${crypto.randomUUID()}`;
  const leased = await database
    .prepare(
      `
    UPDATE file_drive_archives
    SET lease_token=?,lease_expires_at=?,version=version+1,updated_at=MAX(?,updated_at+1)
    WHERE file_object_id=? AND archive_due_at<=?
      AND status<>'DRIVE_ARCHIVED'
      AND (next_retry_at IS NULL OR next_retry_at<=?)
      AND (lease_expires_at IS NULL OR lease_expires_at<=?)
    RETURNING *
  `,
    )
    .bind(
      token,
      input.now + LEASE_MS,
      input.now,
      candidate.file_object_id,
      input.now,
      input.now,
      input.now,
    )
    .first<ArchiveRow>();
  if (!leased) return 'DEFERRED';
  try {
    if (leased.status === 'R2_DELETE_PENDING') {
      return await deleteR2(database, r2, drive, leased, token, input);
    }
    if (leased.status === 'DRIVE_VERIFIED') {
      if (!input.allowDelete) {
        await release(database, leased.file_object_id, token, input.now);
        return 'SUCCEEDED';
      }
      const pending = await transitionToDeletePending(database, leased, token, input.now);
      return await deleteR2(database, r2, drive, pending, token, input);
    }
    const source = await requireSource(database, leased.file_object_id);
    const bytes = await r2.readObject(source.object_key);
    await verifyBytes(
      bytes,
      source.detected_mime,
      source.uploaded_byte_size,
      source.uploaded_sha256,
    );
    let copying = leased;
    if (copying.status === 'R2_HOT') copying = await startCopy(database, copying, token, input.now);
    if (!copying.drive_file_id) {
      const upload = await drive.upload({
        fileObjectId: copying.file_object_id,
        fileName: source.client_file_name,
        mimeType: source.detected_mime,
        byteSize: source.uploaded_byte_size,
        sha256: source.uploaded_sha256,
        bytes,
        resumeSessionKey: copying.resumable_session_key,
      });
      if (!upload.completed || !upload.fileId) {
        await saveResume(database, copying, token, upload.resumeSessionKey, input.now);
        return 'DEFERRED';
      }
      copying = await saveUploadedIdentity(
        database,
        copying,
        token,
        { ...upload, fileId: upload.fileId },
        input.now,
      );
    }
    if (!copying.drive_file_id) throw tagged('d1_conflict');
    const readBack = await drive.readFile(copying.drive_file_id);
    await verifyBytes(
      readBack.bytes,
      source.detected_mime,
      source.uploaded_byte_size,
      source.uploaded_sha256,
    );
    if (
      readBack.mimeType !== source.detected_mime ||
      readBack.byteSize !== source.uploaded_byte_size
    ) {
      throw tagged('manifest_mismatch');
    }
    const verified = await finalizeManifest(database, copying, token, source, input.now);
    if (!input.allowDelete) {
      await release(database, verified.file_object_id, token, input.now);
      return 'SUCCEEDED';
    }
    const pending = await transitionToDeletePending(database, verified, token, input.now);
    return await deleteR2(database, r2, drive, pending, token, input);
  } catch (error) {
    await failArchive(database, leased.file_object_id, token, classify(error), input.now).catch(
      () => undefined,
    );
    throw error;
  }
}

async function eligibleCandidates(
  database: SqlDatabase,
  now: number,
  limit: number,
): Promise<Candidate[]> {
  const result = await database
    .prepare(
      `
    WITH associated(file_object_id,formal_order_id) AS (
      SELECT link.file_object_id,formal_order.id FROM file_entity_links link
      JOIN formal_orders formal_order ON formal_order.id=link.entity_id
        OR formal_order.order_evidence_version_id=link.entity_id
      WHERE link.entity_type='ORDER' AND link.revoked_at IS NULL
      UNION
      SELECT link.file_object_id,review.formal_order_id
      FROM file_entity_links link JOIN review_cases review ON review.id=link.entity_id
      WHERE link.entity_type='REVIEW' AND link.revoked_at IS NULL
      UNION
      SELECT link.file_object_id,refund.formal_order_id
      FROM file_entity_links link JOIN buyer_refund_obligations refund ON refund.id=link.entity_id
      WHERE link.entity_type='BUYER_REFUND' AND link.revoked_at IS NULL
      UNION
      SELECT link.file_object_id,payable.formal_order_id
      FROM file_entity_links link
      JOIN seller_payment_allocations allocation ON allocation.payment_id=link.entity_id
      JOIN seller_payables payable ON payable.id=allocation.payable_id
      WHERE link.entity_type='SELLER_SETTLEMENT' AND link.revoked_at IS NULL
    ), eligible AS (
      SELECT associated.file_object_id,MAX(closure.archive_due_at) AS archive_due_at
      FROM associated JOIN order_archive_closures closure
        ON closure.formal_order_id=associated.formal_order_id AND closure.status='CLOSED'
      WHERE (
        (closure.review_state='COMPLETED' AND EXISTS (SELECT 1 FROM review_cases review
          WHERE review.formal_order_id=closure.formal_order_id AND review.status='APPROVED'))
        OR (closure.review_state='NOT_APPLICABLE' AND NOT EXISTS (SELECT 1 FROM review_cases review
          WHERE review.formal_order_id=closure.formal_order_id))
      ) AND (
        (closure.buyer_refund_state='COMPLETED' AND EXISTS (SELECT 1 FROM buyer_refund_ledger_balances refund
          WHERE refund.formal_order_id=closure.formal_order_id AND refund.status='PAID'))
        OR (closure.buyer_refund_state='NOT_APPLICABLE' AND NOT EXISTS (SELECT 1 FROM buyer_refund_obligations refund
          WHERE refund.formal_order_id=closure.formal_order_id))
      ) AND (
        (closure.seller_principal_state='COMPLETED' AND EXISTS (SELECT 1 FROM seller_payable_balances payable
          WHERE payable.formal_order_id=closure.formal_order_id AND payable.payable_type='SELLER_PRINCIPAL'
            AND payable.derived_status='PAID'))
        OR (closure.seller_principal_state='NOT_APPLICABLE' AND NOT EXISTS (SELECT 1 FROM seller_payables payable
          WHERE payable.formal_order_id=closure.formal_order_id AND payable.payable_type='SELLER_PRINCIPAL'))
      ) AND (
        (closure.seller_service_fee_state='COMPLETED' AND EXISTS (SELECT 1 FROM seller_payable_balances payable
          WHERE payable.formal_order_id=closure.formal_order_id AND payable.payable_type='SELLER_SERVICE_FEE'
            AND payable.derived_status='PAID'))
        OR (closure.seller_service_fee_state='NOT_APPLICABLE' AND NOT EXISTS (SELECT 1 FROM seller_payables payable
          WHERE payable.formal_order_id=closure.formal_order_id AND payable.payable_type='SELLER_SERVICE_FEE'))
      )
      GROUP BY associated.file_object_id
      HAVING COUNT(DISTINCT associated.formal_order_id)=(
        SELECT COUNT(DISTINCT all_links.formal_order_id)
        FROM associated all_links WHERE all_links.file_object_id=associated.file_object_id
      )
    )
    SELECT object.id AS file_object_id,object.purpose,eligible.archive_due_at
    FROM eligible JOIN file_objects object ON object.id=eligible.file_object_id
    JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
    LEFT JOIN file_drive_archives archive ON archive.file_object_id=object.id
    WHERE object.status='VERIFIED' AND intent.status='VERIFIED'
      AND object.purpose IN ('ORDER_EVIDENCE','REVIEW_EVIDENCE','BUYER_REFUND_PROOF','SELLER_SETTLEMENT_PROOF')
      AND eligible.archive_due_at<=?
      AND COALESCE(archive.status,'R2_HOT')<>'DRIVE_ARCHIVED'
      AND (archive.next_retry_at IS NULL OR archive.next_retry_at<=?)
    ORDER BY eligible.archive_due_at,object.id LIMIT ?
  `,
    )
    .bind(now, now, limit)
    .all<Candidate>();
  return result.results;
}

async function requireSource(database: SqlDatabase, fileObjectId: string): Promise<SourceFile> {
  const row = await database
    .prepare(
      `
    SELECT object_key,client_file_name,detected_mime,uploaded_byte_size,uploaded_sha256
    FROM file_objects WHERE id=? AND status='VERIFIED'
      AND detected_mime IS NOT NULL AND uploaded_byte_size IS NOT NULL AND uploaded_sha256 IS NOT NULL
  `,
    )
    .bind(fileObjectId)
    .first<SourceFile>();
  if (!row) throw tagged('d1_conflict');
  return row;
}

async function startCopy(
  database: SqlDatabase,
  row: ArchiveRow,
  token: string,
  now: number,
): Promise<ArchiveRow> {
  return atomicTransition(
    database,
    row.file_object_id,
    token,
    `UPDATE file_drive_archives SET status='DRIVE_COPYING',attempt_count=attempt_count+1,
    next_retry_at=NULL,last_failure_category=NULL,version=version+1,updated_at=MAX(?,updated_at+1)
    WHERE file_object_id=? AND status='R2_HOT' AND lease_token=?`,
    [now, row.file_object_id, token],
    'COPY_STARTED',
    'R2_HOT',
    'DRIVE_COPYING',
    row.version + 1,
    null,
    now,
  );
}
async function saveResume(
  database: SqlDatabase,
  row: ArchiveRow,
  token: string,
  session: string | null,
  now: number,
): Promise<void> {
  await atomicMutation(
    database,
    database
      .prepare(
        `UPDATE file_drive_archives SET resumable_session_key=?,lease_token=NULL,
    lease_expires_at=NULL,next_retry_at=?,version=version+1,updated_at=MAX(?,updated_at+1)
    WHERE file_object_id=? AND status='DRIVE_COPYING' AND lease_token=?`,
      )
      .bind(session, now, now, row.file_object_id, token),
    archiveEventStatement(
      database,
      row.file_object_id,
      'COPY_RESUMED',
      'DRIVE_COPYING',
      'DRIVE_COPYING',
      row.version + 1,
      null,
      now,
    ),
  );
}
async function saveUploadedIdentity(
  database: SqlDatabase,
  row: ArchiveRow,
  token: string,
  upload: { fileId: string; folderId: string; ownerAccountKey: string },
  now: number,
): Promise<ArchiveRow> {
  return atomicTransition(
    database,
    row.file_object_id,
    token,
    `UPDATE file_drive_archives SET drive_file_id=?,drive_folder_id=?,owner_account_key=?,
    resumable_session_key=NULL,version=version+1,updated_at=MAX(?,updated_at+1)
    WHERE file_object_id=? AND status='DRIVE_COPYING' AND lease_token=?`,
    [upload.fileId, upload.folderId, upload.ownerAccountKey, now, row.file_object_id, token],
    'DRIVE_UPLOAD_RECORDED',
    'DRIVE_COPYING',
    'DRIVE_COPYING',
    row.version + 1,
    null,
    now,
  );
}
async function finalizeManifest(
  database: SqlDatabase,
  row: ArchiveRow,
  token: string,
  source: SourceFile,
  now: number,
): Promise<ArchiveRow> {
  if (!row.drive_file_id || !row.drive_folder_id || !row.owner_account_key)
    throw tagged('d1_conflict');
  const id = crypto.randomUUID();
  await database.batch([
    database
      .prepare(
        `INSERT INTO file_drive_archive_manifests(id,file_object_id,drive_file_id,drive_folder_id,
      owner_account_key,byte_size,mime_type,sha256,verified_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        row.file_object_id,
        row.drive_file_id,
        row.drive_folder_id,
        row.owner_account_key,
        source.uploaded_byte_size,
        source.detected_mime,
        source.uploaded_sha256,
        now,
        now,
      ),
    database
      .prepare(
        `UPDATE file_drive_archives SET status='DRIVE_VERIFIED',uploaded_byte_size=?,uploaded_mime=?,
      uploaded_sha256=?,verified_at=?,next_retry_at=NULL,last_failure_category=NULL,version=version+1,
      updated_at=MAX(?,updated_at+1) WHERE file_object_id=? AND status='DRIVE_COPYING' AND lease_token=?`,
      )
      .bind(
        source.uploaded_byte_size,
        source.detected_mime,
        source.uploaded_sha256,
        now,
        now,
        row.file_object_id,
        token,
      ),
    changedOnceStatement(database),
    archiveEventStatement(
      database,
      row.file_object_id,
      'DRIVE_VERIFIED',
      'DRIVE_COPYING',
      'DRIVE_VERIFIED',
      row.version + 1,
      null,
      now,
    ),
    database
      .prepare(
        `INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN EXISTS(
      SELECT 1 FROM file_drive_archives archive JOIN file_drive_archive_manifests manifest
      ON manifest.file_object_id=archive.file_object_id WHERE archive.file_object_id=?
      AND archive.status='DRIVE_VERIFIED' AND archive.lease_token=?) THEN 1 ELSE 0 END`,
      )
      .bind(row.file_object_id, token),
  ]);
  const current = await database
    .prepare('SELECT * FROM file_drive_archives WHERE file_object_id=?')
    .bind(row.file_object_id)
    .first<ArchiveRow>();
  if (!current) throw tagged('d1_conflict');
  return current;
}
async function transitionToDeletePending(
  database: SqlDatabase,
  row: ArchiveRow,
  token: string,
  now: number,
): Promise<ArchiveRow> {
  return atomicTransition(
    database,
    row.file_object_id,
    token,
    `UPDATE file_drive_archives SET status='R2_DELETE_PENDING',
    version=version+1,updated_at=MAX(?,updated_at+1) WHERE file_object_id=? AND status='DRIVE_VERIFIED'
    AND lease_token=?`,
    [now, row.file_object_id, token],
    'R2_DELETE_REQUESTED',
    'DRIVE_VERIFIED',
    'R2_DELETE_PENDING',
    row.version + 1,
    null,
    now,
  );
}
async function deleteR2(
  database: SqlDatabase,
  r2: ObjectStorageAdapter,
  drive: DriveArchiveAdapter,
  row: ArchiveRow,
  token: string,
  input: { now: number; allowDelete: boolean },
): Promise<'SUCCEEDED' | 'DEFERRED'> {
  const controls = await readControls(database);
  if (
    !input.allowDelete ||
    controls.copy_enabled !== 1 ||
    controls.proxy_read_enabled !== 1 ||
    controls.r2_delete_enabled !== 1
  ) {
    await release(database, row.file_object_id, token, input.now);
    return 'DEFERRED';
  }
  if (!(await stillEligibleForDeletion(database, row.file_object_id, input.now))) {
    await release(database, row.file_object_id, token, input.now);
    return 'DEFERRED';
  }
  const source = await requireSource(database, row.file_object_id);
  await verifyDriveCopy(drive, row, source);
  try {
    await r2.deleteObject(source.object_key);
  } catch (error) {
    await failArchive(database, row.file_object_id, token, 'r2_delete_failed', input.now);
    throw error;
  }
  await atomicMutation(
    database,
    database
      .prepare(
        `UPDATE file_drive_archives SET status='DRIVE_ARCHIVED',r2_deleted_at=?,
    archived_at=?,lease_token=NULL,lease_expires_at=NULL,next_retry_at=NULL,last_failure_category=NULL,
    version=version+1,updated_at=MAX(?,updated_at+1) WHERE file_object_id=? AND status='R2_DELETE_PENDING'
    AND lease_token=?`,
      )
      .bind(input.now, input.now, input.now, row.file_object_id, token),
    archiveEventStatement(
      database,
      row.file_object_id,
      'DRIVE_ARCHIVED',
      'R2_DELETE_PENDING',
      'DRIVE_ARCHIVED',
      row.version + 1,
      null,
      input.now,
    ),
  );
  return 'SUCCEEDED';
}
async function verifyDriveCopy(
  drive: DriveArchiveAdapter,
  row: ArchiveRow,
  source: SourceFile,
): Promise<void> {
  if (
    !row.drive_file_id ||
    row.uploaded_byte_size === null ||
    row.uploaded_mime === null ||
    !row.uploaded_sha256
  ) {
    throw tagged('d1_conflict');
  }
  const readBack = await drive.readFile(row.drive_file_id);
  await verifyBytes(
    readBack.bytes,
    source.detected_mime,
    source.uploaded_byte_size,
    source.uploaded_sha256,
  );
  if (
    readBack.byteSize !== row.uploaded_byte_size ||
    readBack.mimeType !== row.uploaded_mime ||
    source.uploaded_byte_size !== row.uploaded_byte_size ||
    source.detected_mime !== row.uploaded_mime ||
    source.uploaded_sha256 !== row.uploaded_sha256
  )
    throw tagged('manifest_mismatch');
}
async function stillEligibleForDeletion(
  database: SqlDatabase,
  fileObjectId: string,
  now: number,
): Promise<boolean> {
  const row = await database
    .prepare(
      `WITH associated(formal_order_id) AS (
    SELECT formal_order.id FROM file_entity_links link JOIN formal_orders formal_order
      ON formal_order.id=link.entity_id OR formal_order.order_evidence_version_id=link.entity_id
    WHERE link.file_object_id=? AND link.entity_type='ORDER' AND link.revoked_at IS NULL
    UNION SELECT review.formal_order_id FROM file_entity_links link JOIN review_cases review ON review.id=link.entity_id
      WHERE link.file_object_id=? AND link.entity_type='REVIEW' AND link.revoked_at IS NULL
    UNION SELECT refund.formal_order_id FROM file_entity_links link JOIN buyer_refund_obligations refund ON refund.id=link.entity_id
      WHERE link.file_object_id=? AND link.entity_type='BUYER_REFUND' AND link.revoked_at IS NULL
    UNION SELECT payable.formal_order_id FROM file_entity_links link
      JOIN seller_payment_allocations allocation ON allocation.payment_id=link.entity_id
      JOIN seller_payables payable ON payable.id=allocation.payable_id
      WHERE link.file_object_id=? AND link.entity_type='SELLER_SETTLEMENT' AND link.revoked_at IS NULL
  ) SELECT COUNT(*) AS total,SUM(CASE WHEN EXISTS(
    SELECT 1 FROM order_archive_closures closure WHERE closure.formal_order_id=associated.formal_order_id
      AND closure.status='CLOSED' AND closure.archive_due_at<=?
      AND ((closure.review_state='COMPLETED' AND EXISTS(SELECT 1 FROM review_cases review
        WHERE review.formal_order_id=associated.formal_order_id AND review.status='APPROVED'))
        OR (closure.review_state='NOT_APPLICABLE' AND NOT EXISTS(SELECT 1 FROM review_cases review
          WHERE review.formal_order_id=associated.formal_order_id)))
      AND ((closure.buyer_refund_state='COMPLETED' AND EXISTS(SELECT 1 FROM buyer_refund_ledger_balances refund
        WHERE refund.formal_order_id=associated.formal_order_id AND refund.status='PAID'))
        OR (closure.buyer_refund_state='NOT_APPLICABLE' AND NOT EXISTS(SELECT 1 FROM buyer_refund_obligations refund
          WHERE refund.formal_order_id=associated.formal_order_id)))
      AND ((closure.seller_principal_state='COMPLETED' AND EXISTS(SELECT 1 FROM seller_payable_balances payable
        WHERE payable.formal_order_id=associated.formal_order_id AND payable.payable_type='SELLER_PRINCIPAL'
          AND payable.derived_status='PAID')) OR (closure.seller_principal_state='NOT_APPLICABLE' AND NOT EXISTS(
        SELECT 1 FROM seller_payables payable WHERE payable.formal_order_id=associated.formal_order_id
          AND payable.payable_type='SELLER_PRINCIPAL')))
      AND ((closure.seller_service_fee_state='COMPLETED' AND EXISTS(SELECT 1 FROM seller_payable_balances payable
        WHERE payable.formal_order_id=associated.formal_order_id AND payable.payable_type='SELLER_SERVICE_FEE'
          AND payable.derived_status='PAID')) OR (closure.seller_service_fee_state='NOT_APPLICABLE' AND NOT EXISTS(
        SELECT 1 FROM seller_payables payable WHERE payable.formal_order_id=associated.formal_order_id
          AND payable.payable_type='SELLER_SERVICE_FEE')))
  ) THEN 1 ELSE 0 END) AS eligible FROM associated`,
    )
    .bind(fileObjectId, fileObjectId, fileObjectId, fileObjectId, now)
    .first<{ total: number; eligible: number | null }>();
  return Number(row?.total ?? 0) > 0 && Number(row?.eligible ?? 0) === Number(row?.total ?? 0);
}
async function release(
  database: SqlDatabase,
  fileId: string,
  token: string,
  now: number,
): Promise<void> {
  const result = await database
    .prepare(
      `UPDATE file_drive_archives SET lease_token=NULL,lease_expires_at=NULL,
    version=version+1,updated_at=MAX(?,updated_at+1) WHERE file_object_id=? AND lease_token=?`,
    )
    .bind(now, fileId, token)
    .run();
  if (!statementChangedOnce(result)) throw tagged('d1_conflict');
}
async function failArchive(
  database: SqlDatabase,
  fileId: string,
  token: string,
  category: string,
  now: number,
): Promise<void> {
  const current = await database
    .prepare(
      `SELECT status,version FROM file_drive_archives WHERE file_object_id=? AND lease_token=?`,
    )
    .bind(fileId, token)
    .first<{ status: FileDriveArchiveState; version: number }>();
  if (!current) throw tagged('d1_conflict');
  await atomicMutation(
    database,
    database
      .prepare(
        `UPDATE file_drive_archives SET lease_token=NULL,lease_expires_at=NULL,
    attempt_count=attempt_count+1,next_retry_at=?,last_failure_category=?,version=version+1,
    updated_at=MAX(?,updated_at+1) WHERE file_object_id=? AND lease_token=? AND version=?`,
      )
      .bind(now + retryDelay(category), category, now, fileId, token, current.version),
    archiveEventStatement(
      database,
      fileId,
      current.status === 'R2_DELETE_PENDING' ? 'R2_DELETE_FAILED' : 'COPY_FAILED',
      current.status,
      current.status,
      current.version + 1,
      category,
      now,
    ),
  );
}
async function verifyBytes(
  bytes: Uint8Array<ArrayBuffer>,
  mime: SupportedFileMime,
  size: number,
  hash: string,
): Promise<void> {
  if (
    bytes.byteLength !== size ||
    detectSupportedMime(bytes) !== mime ||
    (await sha256Hex(bytes)) !== hash
  )
    throw tagged('manifest_mismatch');
}
function archiveEventStatement(
  database: SqlDatabase,
  fileId: string,
  type: string,
  previous: string,
  next: string,
  version: number,
  failure: string | null,
  now: number,
) {
  return database
    .prepare(
      `INSERT INTO file_drive_archive_events(id,file_object_id,event_type,previous_status,next_status,
    archive_version,failure_category,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .bind(crypto.randomUUID(), fileId, type, previous, next, version, failure, '{}', now);
}
function changedOnceStatement(database: SqlDatabase) {
  return database.prepare(`INSERT INTO transaction_assertions(assertion_value)
  SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END`);
}
async function atomicMutation(
  database: SqlDatabase,
  mutation: ReturnType<SqlDatabase['prepare']>,
  audit: ReturnType<SqlDatabase['prepare']>,
): Promise<void> {
  await database.batch([mutation, changedOnceStatement(database), audit]);
}
async function atomicTransition(
  database: SqlDatabase,
  fileId: string,
  token: string,
  sql: string,
  binds: readonly unknown[],
  type: string,
  previous: string,
  next: string,
  version: number,
  failure: string | null,
  now: number,
): Promise<ArchiveRow> {
  let mutation = database.prepare(sql);
  mutation = mutation.bind(...binds);
  await atomicMutation(
    database,
    mutation,
    archiveEventStatement(database, fileId, type, previous, next, version, failure, now),
  );
  const updated = await database
    .prepare(
      `SELECT * FROM file_drive_archives WHERE file_object_id=? AND lease_token=? AND version=?`,
    )
    .bind(fileId, token, version)
    .first<ArchiveRow>();
  if (!updated) throw tagged('d1_conflict');
  return updated;
}
async function readControls(
  database: SqlDatabase,
): Promise<{ copy_enabled: number; proxy_read_enabled: number; r2_delete_enabled: number }> {
  const row = await database
    .prepare(
      'SELECT copy_enabled,proxy_read_enabled,r2_delete_enabled FROM drive_archive_controls WHERE singleton_id=1',
    )
    .first<{ copy_enabled: number; proxy_read_enabled: number; r2_delete_enabled: number }>();
  if (!row) throw new Error('drive_archive_controls_missing');
  return row;
}
async function countBacklog(database: SqlDatabase, now: number): Promise<number> {
  return (await eligibleCandidates(database, now, MAX_BATCH + 1)).length;
}
async function recordFailureSignal(
  database: SqlDatabase,
  fileId: string,
  now: number,
): Promise<void> {
  const id = await hashCanonicalJson({
    kind: 'DRIVE_ARCHIVE_FAILURE',
    file_object_id: fileId,
    observed_at: now,
  });
  await database
    .prepare(
      `INSERT OR IGNORE INTO scheduled_job_states(job_name,updated_at)
    VALUES('drive_archive',?)`,
    )
    .bind(now)
    .run();
  await ingestScheduledOperationalSignal(database, {
    observation_id: id,
    signal_type: 'file_failure',
    summary_code: 'FILE_PROCESSING_FAILURE',
    job_name: 'drive_archive',
    observation_state: 'BREACH',
    observed_at: now,
    count_value: 1,
  });
}
function classify(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'DriveAuthorizationError') return 'authorization_failed';
    if (error.message === 'manifest_mismatch') return 'manifest_mismatch';
    if (error.message.includes('missing')) return 'drive_missing';
    if (error.message.includes('read')) return 'read_back_failed';
    if (error.message.includes('drive')) return 'upload_failed';
  }
  return 'adapter_unavailable';
}
function classifyReconciliation(
  error: unknown,
): 'authorization_failed' | 'read_back_failed' | 'manifest_mismatch' | 'drive_missing' {
  if (error instanceof Error) {
    if (error.name === 'DriveAuthorizationError') return 'authorization_failed';
    if (error.message === 'manifest_mismatch') return 'manifest_mismatch';
    if (error.message.includes('missing')) return 'drive_missing';
  }
  return 'read_back_failed';
}
function retryDelay(category: string): number {
  return category === 'authorization_failed' || category === 'manifest_mismatch'
    ? 3_600_000
    : 60_000;
}
function tagged(message: string): Error {
  return new Error(message);
}
