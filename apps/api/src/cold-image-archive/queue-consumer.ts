import type {
  ArchiveFailureCategory,
  ArchiveQueueMessage,
  DriveArchiveClient,
  ObjectStorageAdapter,
  SqlDatabase,
} from '@ygb/contracts';
import { parseArchiveQueueMessage } from '@ygb/contracts';
import { statementChangedOnce } from '@ygb/contracts';
import { isRetryableArchiveFailure } from '@ygb/contracts';
import {
  ArchiveJobExecutionError,
  runArchiveBundleJob,
  type ArchivePipelineControls,
} from './archive-pipeline';
import { runRestoreBundleJob, runRestoreCleanupScan } from './restore';

/** Per-attempt lease: recovered automatically once expired. */
export const ARCHIVE_JOB_LEASE_MS = 90_000;
export const DEFAULT_MAX_ATTEMPTS = 8;
const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_MAX_SECONDS = 3600;
const JITTER_MAX_SECONDS = 30;

export interface ArchiveQueueDisposition {
  action: 'ACK' | 'RETRY' | 'DEAD_LETTER_ACK';
  delaySeconds?: number;
  dedupeKey: string;
}

export interface ArchiveConsumerDeps {
  storage: ObjectStorageAdapter;
  drive: DriveArchiveClient;
}

export interface ArchiveConsumerControls extends ArchivePipelineControls {
  restoreWorkerEnabled: boolean;
}

export function retryDelaySeconds(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  const raw = Math.min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** exponent);
  const jitter = Math.floor(Math.random() * JITTER_MAX_SECONDS);
  return Math.min(BACKOFF_MAX_SECONDS, raw + jitter);
}

/**
 * Processes one queue batch message-by-message (no unbounded Promise.all):
 * each message maps to a deduped archive_jobs row guarded by a D1 lease, so
 * duplicate delivery is a no-op and a crashed consumer's lease expires for the
 * next delivery. Poison bodies are dead-lettered in D1 and acked.
 */
export async function processArchiveQueueMessage(
  database: SqlDatabase,
  rawMessage: unknown,
  input: { now: number; queueMessageId?: string },
  deps: ArchiveConsumerDeps,
  controls: ArchiveConsumerControls,
): Promise<ArchiveQueueDisposition> {
  const message = parseArchiveQueueMessage(rawMessage);
  if (!message) {
    const dedupeKey = `POISON:${input.queueMessageId ?? 'unknown'}:${input.now}`;
    await database
      .prepare(
        `INSERT OR IGNORE INTO archive_jobs(id,dedupe_key,job_type,state,attempt_count,max_attempts,
       error_category,error_summary,finished_at,created_at,updated_at)
       VALUES(?,?,'ARCHIVE_BUNDLE','DEAD_LETTERED',1,1,'job_poison_message','unparseable queue message',?,?,?)`,
      )
      .bind(
        `archive-job-${crypto.randomUUID()}`,
        dedupeKey,
        input.now,
        input.now,
        input.now,
      )
      .run();
    return { action: 'DEAD_LETTER_ACK', dedupeKey };
  }
  const dedupeKey = message.job_type === 'RESTORE_BUNDLE'
    ? `RESTORE_BUNDLE:${message.bundle_id}:${message.bundle_version}`
    : `ARCHIVE_BUNDLE:${message.bundle_id}:${message.bundle_version}`;
  const job = await database
    .prepare(`SELECT id,state,attempt_count,max_attempts,next_retry_at FROM archive_jobs WHERE dedupe_key=?`)
    .bind(dedupeKey)
    .first<{ id: string; state: string; attempt_count: number; max_attempts: number; next_retry_at: number | null }>();
  if (!job) {
    // Message for a job that was never created (or pruned): dead-letter the
    // message so it cannot loop forever.
    await database
      .prepare(
        `INSERT OR IGNORE INTO archive_jobs(id,dedupe_key,job_type,bundle_id,bundle_version,state,
       attempt_count,max_attempts,error_category,error_summary,finished_at,created_at,updated_at)
       VALUES(?,?,'ARCHIVE_BUNDLE',?,?, 'DEAD_LETTERED',1,1,'job_poison_message','job row missing',?,?,?)`,
      )
      .bind(
        `archive-job-${crypto.randomUUID()}`,
        `${dedupeKey}:missing:${input.now}`,
        message.bundle_id,
        message.bundle_version,
        input.now,
        input.now,
        input.now,
      )
      .run();
    return { action: 'DEAD_LETTER_ACK', dedupeKey };
  }
  if (job.state === 'SUCCEEDED' || job.state === 'DEAD_LETTERED' || job.state === 'CANCELLED') {
    return { action: 'ACK', dedupeKey };
  }
  if (job.state === 'PENDING' && job.next_retry_at !== null && job.next_retry_at > input.now) {
    return { action: 'ACK', dedupeKey };
  }
  const leaseToken = `archive-job-lease:${crypto.randomUUID()}`;
  const leased = await database
    .prepare(
      `UPDATE archive_jobs SET state='LEASED',lease_token=?,lease_expires_at=?,
     attempt_count=attempt_count+1,phase=phase,updated_at=?
     WHERE id=? AND (
       (state='PENDING' AND (next_retry_at IS NULL OR next_retry_at<=?))
       OR (state='FAILED_RETRYABLE' AND next_retry_at<=?)
       OR (state='LEASED' AND lease_expires_at<=?)
     )
     RETURNING id,attempt_count,max_attempts`,
    )
    .bind(leaseToken, input.now + ARCHIVE_JOB_LEASE_MS, input.now, job.id, input.now, input.now, input.now)
    .first<{ id: string; attempt_count: number; max_attempts: number }>();
  if (!leased) return { action: 'ACK', dedupeKey };
  try {
    if (message.job_type === 'RESTORE_BUNDLE') {
      if (!controls.restoreWorkerEnabled) {
        await releaseLease(database, job.id, leaseToken, input.now);
        return { action: 'ACK', dedupeKey };
      }
      await runRestoreBundleJob(database, { bundleId: message.bundle_id, now: input.now }, deps);
    } else {
      if (!controls.driveUploadEnabled) {
        // Upload switch off: leave the D1 job PENDING (source of truth) and
        // drop this delivery; dispatching resumes once the switch is on.
        await releaseLease(database, job.id, leaseToken, input.now);
        return { action: 'ACK', dedupeKey };
      }
      await runArchiveBundleJob(
        database,
        { bundleId: message.bundle_id, now: input.now },
        deps,
        { driveUploadEnabled: controls.driveUploadEnabled, hotDeleteEnabled: controls.hotDeleteEnabled, shadowCopyOnly: controls.shadowCopyOnly },
      );
    }
    // The pipeline finalizes its own job row on success; if it did not (for
    // example the bundle was already terminal), mark success here.
    await database
      .prepare(
        `UPDATE archive_jobs SET state='SUCCEEDED',finished_at=?,updated_at=?,
       lease_token=NULL,lease_expires_at=NULL,next_retry_at=NULL
       WHERE id=? AND state='LEASED' AND lease_token=?`,
      )
      .bind(input.now, input.now, job.id, leaseToken)
      .run();
    return { action: 'ACK', dedupeKey };
  } catch (error) {
    const category = error instanceof ArchiveJobExecutionError
      ? error.category
      : 'dependency_unavailable' as ArchiveFailureCategory;
    const retryable = error instanceof ArchiveJobExecutionError
      ? error.retryable && isRetryableArchiveFailure(error.category)
      : true;
    const attemptsExhausted = leased.attempt_count >= leased.max_attempts;
    if (!retryable || attemptsExhausted) {
      await database.batch([
        database
          .prepare(
            `UPDATE archive_jobs SET state='DEAD_LETTERED',error_category=?,error_summary=?,
         finished_at=?,updated_at=?,lease_token=NULL,lease_expires_at=NULL,next_retry_at=NULL
         WHERE id=? AND state='LEASED' AND lease_token=?`,
          )
          .bind(category, safeSummary(category), input.now, input.now, job.id, leaseToken),
        database
          .prepare(
            `UPDATE archive_bundles SET last_failure_category=?,next_retry_at=?,
         attempt_count=attempt_count+1,version=version+1,updated_at=MAX(?,updated_at+1)
         WHERE id=? AND state='ONLINE'`,
          )
          .bind(category, null, input.now, message.bundle_id),
      ]).catch(() => undefined);
      return { action: 'DEAD_LETTER_ACK', dedupeKey };
    }
    const delaySeconds = retryDelaySeconds(leased.attempt_count);
    await database
      .prepare(
        `UPDATE archive_jobs SET state='FAILED_RETRYABLE',error_category=?,error_summary=?,
       next_retry_at=?,updated_at=?,lease_token=NULL,lease_expires_at=NULL
       WHERE id=? AND state='LEASED' AND lease_token=?`,
      )
      .bind(category, safeSummary(category), input.now + delaySeconds * 1000, input.now, job.id, leaseToken)
      .run()
      .catch(() => undefined);
    await database
      .prepare(
        `UPDATE archive_bundles SET last_failure_category=?,next_retry_at=?,
       attempt_count=attempt_count+1,version=version+1,updated_at=MAX(?,updated_at+1)
       WHERE id=? AND state='ONLINE'`,
      )
      .bind(category, input.now + delaySeconds * 1000, input.now, message.bundle_id)
      .run()
      .catch(() => undefined);
    return { action: 'RETRY', delaySeconds, dedupeKey };
  }
}

async function releaseLease(
  database: SqlDatabase,
  jobId: string,
  leaseToken: string,
  now: number,
): Promise<void> {
  await database
    .prepare(
      `UPDATE archive_jobs SET state='PENDING',lease_token=NULL,lease_expires_at=NULL,updated_at=?
     WHERE id=? AND state='LEASED' AND lease_token=?`,
    )
    .bind(now, jobId, leaseToken)
    .run()
    .catch(() => undefined);
}

/** No PII, no tokens, no object keys — category-derived summaries only. */
function safeSummary(category: ArchiveFailureCategory): string {
  return `archive_failure_${category}`;
}

/**
 * Local drain for environments without a bound Queue producer: executes ready
 * jobs (bounded by the configured batch size) directly. The scheduled runner
 * calls this as the "equivalent retriable async consumer" fallback.
 */
export async function drainArchiveJobs(
  database: SqlDatabase,
  input: { now: number; limit?: number },
  deps: ArchiveConsumerDeps,
  controls: ArchiveConsumerControls,
): Promise<{ processed: number; succeeded: number; retried: number; deadLettered: number }> {
  const controlsRow = await database
    .prepare('SELECT queue_batch_size FROM archive_runtime_controls WHERE singleton_id=1')
    .first<{ queue_batch_size: number }>();
  const configured = controlsRow?.queue_batch_size ?? 5;
  const limit = Number.isSafeInteger(input.limit) && Number(input.limit)! > 0
    ? Math.min(Number(input.limit), 25) : Math.min(Math.max(1, configured), 25);
  const ready = (await database
    .prepare(
      `SELECT dedupe_key,job_type,bundle_id,bundle_version,trace_id FROM archive_jobs
     WHERE (state='PENDING' AND (next_retry_at IS NULL OR next_retry_at<=?))
        OR (state='FAILED_RETRYABLE' AND next_retry_at<=?)
        OR (state='LEASED' AND lease_expires_at<=?)
     ORDER BY created_at,id LIMIT ?`,
    )
    .bind(input.now, input.now, input.now, limit)
    .all<{
      dedupe_key: string; job_type: 'ARCHIVE_BUNDLE' | 'RESTORE_BUNDLE' | 'CLEANUP_EXPIRED_RESTORE';
      bundle_id: string | null; bundle_version: number | null; trace_id: string | null;
    }>()).results;
  let succeeded = 0;
  let retried = 0;
  let deadLettered = 0;
  let processed = 0;
  for (const job of ready) {
    if (job.job_type === 'CLEANUP_EXPIRED_RESTORE') {
      processed += 1;
      const result = await runRestoreCleanupScan(database, { now: input.now, limit: 25 }, deps);
      succeeded += result.failed === 0 ? 1 : 0;
      deadLettered += result.failed > 0 ? 1 : 0;
      continue;
    }
    if (job.job_type === 'ARCHIVE_BUNDLE' && !controls.driveUploadEnabled) continue;
    if (job.job_type === 'RESTORE_BUNDLE' && !controls.restoreWorkerEnabled) continue;
    if (!job.bundle_id || !job.bundle_version || !job.trace_id) continue;
    const disposition = await processArchiveQueueMessage(
      database,
      {
        bundle_id: job.bundle_id,
        bundle_version: job.bundle_version,
        job_type: job.job_type,
        trace_id: job.trace_id,
      },
      { now: input.now },
      deps,
      controls,
    );
    processed += 1;
    if (disposition.action === 'ACK') succeeded += 1;
    else if (disposition.action === 'RETRY') retried += 1;
    else deadLettered += 1;
  }
  return { processed, succeeded, retried, deadLettered };
}

/**
 * Sends queue messages for ready archive jobs that have not been dispatched
 * yet, recording queue_message_id so a job is sent at most once per delivery
 * cycle (duplicate deliveries remain harmless via the D1 lease/dedupe).
 */
export async function dispatchPendingArchiveJobs(
  database: SqlDatabase,
  producer: { send(message: ArchiveQueueMessage): Promise<void> },
  input: { now: number; limit: number },
): Promise<number> {
  const ready = (await database
    .prepare(
      `SELECT id,dedupe_key,job_type,bundle_id,bundle_version,trace_id FROM archive_jobs
     WHERE queue_message_id IS NULL
       AND (state='PENDING' OR state='FAILED_RETRYABLE')
       AND (next_retry_at IS NULL OR next_retry_at<=?)
     ORDER BY created_at,id LIMIT ?`,
    )
    .bind(input.now, Math.min(input.limit, 50))
    .all<{
      id: string; dedupe_key: string; job_type: 'ARCHIVE_BUNDLE' | 'RESTORE_BUNDLE' | 'CLEANUP_EXPIRED_RESTORE';
      bundle_id: string | null; bundle_version: number | null; trace_id: string | null;
    }>()).results;
  let dispatched = 0;
  for (const job of ready) {
    if (job.job_type === 'CLEANUP_EXPIRED_RESTORE' || !job.bundle_id || !job.bundle_version || !job.trace_id) {
      continue;
    }
    await producer.send({
      bundle_id: job.bundle_id,
      bundle_version: job.bundle_version,
      job_type: job.job_type,
      trace_id: job.trace_id,
    });
    await database
      .prepare(`UPDATE archive_jobs SET queue_message_id=?,updated_at=? WHERE id=? AND queue_message_id IS NULL`)
      .bind(`queue:${crypto.randomUUID()}`, input.now, job.id)
      .run();
    dispatched += 1;
  }
  return dispatched;
}

export { statementChangedOnce };
