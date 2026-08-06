import type { ObjectStorageAdapter, SqlDatabase } from '@ygb/contracts';
import { claimNextOutboxEvent, markOutboxFailed, markOutboxSent } from '../foundation/outbox';
import { reconcileInstructionAssetOrphans } from '../order-instructions/asset-reconciliation';
import { runOrderInstructionExpiryScan } from '../order-instructions/expiry-scan';
import { cleanupExpiredStaffAuthEphemeralRecords } from '../staff-auth/cleanup';
import { expireReservation } from '../reservations/expire-reservation';

export const SCHEDULED_JOB_NAMES = [
  'reservation_expiry', 'instruction_expiry', 'outbox_delivery', 'file_orphan_cleanup', 'staff_auth_cleanup',
  'drive_archive', 'feishu_sync',
] as const;
export type ScheduledJobName = typeof SCHEDULED_JOB_NAMES[number];
export type ScheduledTrigger = 'CRON' | 'MANUAL';
export interface SafeJobRun { job_name: ScheduledJobName; outcome: 'SUCCEEDED'|'FAILED'|'SKIPPED'|'DISABLED'; processed_count: number; succeeded_count: number; failed_count: number; backlog_count: number; failure_category: string | null; }
export interface OutboxDeliveryAdapter { deliver(event: { id: string; eventType: string; payloadJson: string }): Promise<void>; }
const LEASE_MS = 90_000;
const BATCH = 50;

export async function runScheduledOperations(database: SqlDatabase, input: { now?: number; enabled?: boolean; disabledJobs?: readonly string[]; storage?: ObjectStorageAdapter | null; outboxAdapter?: OutboxDeliveryAdapter | null; trigger?: ScheduledTrigger; only?: ScheduledJobName; }): Promise<SafeJobRun[]> {
  const now = input.now ?? Date.now();
  const names = input.only ? [input.only] : SCHEDULED_JOB_NAMES;
  const output: SafeJobRun[] = [];
  for (const job of names) output.push(await runOne(database, job, { ...input, now }));
  return output;
}

async function runOne(database: SqlDatabase, job: ScheduledJobName, input: Required<Pick<Parameters<typeof runScheduledOperations>[1], 'now'>> & Parameters<typeof runScheduledOperations>[1]): Promise<SafeJobRun> {
  if (input.enabled === false || input.disabledJobs?.includes(job) || job === 'drive_archive' || job === 'feishu_sync') return record(database, job, input.trigger ?? 'CRON', 'DISABLED', 0, 0, 0, 0, null, input.now);
  const token = `scheduled:${crypto.randomUUID()}`;
  const acquired = await database.prepare(`
    INSERT INTO scheduled_job_states (job_name, lease_token, lease_expires_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(job_name) DO UPDATE SET lease_token=excluded.lease_token, lease_expires_at=excluded.lease_expires_at, version=scheduled_job_states.version+1, updated_at=excluded.updated_at
    WHERE scheduled_job_states.lease_expires_at IS NULL OR scheduled_job_states.lease_expires_at<=?
    RETURNING job_name
  `).bind(job, token, input.now + LEASE_MS, input.now, input.now).first<{job_name:string}>();
  if (!acquired) return record(database, job, input.trigger ?? 'CRON', 'SKIPPED', 0, 0, 0, 0, null, input.now);
  try {
    const result = await execute(database, job, input);
    await database.prepare(`UPDATE scheduled_job_states SET lease_token=NULL, lease_expires_at=NULL, last_started_at=?, last_succeeded_at=?, last_backlog_count=?, last_failure_category=NULL, updated_at=? WHERE job_name=? AND lease_token=?`).bind(input.now, input.now, result.backlog, input.now, job, token).run();
    return record(database, job, input.trigger ?? 'CRON', 'SUCCEEDED', result.processed, result.succeeded, result.failed, result.backlog, null, input.now);
  } catch (error) {
    const category = classify(error);
    await database.prepare(`UPDATE scheduled_job_states SET lease_token=NULL, lease_expires_at=NULL, last_failed_at=?, last_failure_category=?, updated_at=? WHERE job_name=? AND lease_token=?`).bind(input.now, category, input.now, job, token).run();
    return record(database, job, input.trigger ?? 'CRON', 'FAILED', 0, 0, 1, 0, category, input.now);
  }
}

async function execute(database: SqlDatabase, job: ScheduledJobName, input: Parameters<typeof runScheduledOperations>[1] & {now:number}): Promise<{processed:number;succeeded:number;failed:number;backlog:number}> {
  const actor = { staffId: 'system-scheduler', roles: new Set(['owner'] as const), permissions: new Set(['ORDER_INSTRUCTION_EXPIRY_RUN','ORDER_INSTRUCTION_MANAGE'] as const) } as any;
  if (job === 'reservation_expiry') {
    const rows = await database.prepare(`SELECT id,version,hold_expires_at FROM product_reservations WHERE status IN ('PENDING_REVIEW','APPROVED') AND hold_expires_at<=? ORDER BY hold_expires_at,id LIMIT ?`).bind(input.now, BATCH + 1).all<{id:string;version:number;hold_expires_at:number}>();
    let succeeded = 0; let failed = 0;
    for (const row of rows.results.slice(0, BATCH)) { try { await expireReservation(database, { reservationId: row.id, expectedVersion: Number(row.version) }, { idempotencyKey: `scheduled:reservation-expiry:${row.id}:${row.hold_expires_at}`, now: input.now }); succeeded += 1; } catch { failed += 1; } }
    return { processed: Math.min(rows.results.length, BATCH), succeeded, failed, backlog: rows.results.length > BATCH ? 1 : 0 };
  }
  if (job === 'instruction_expiry') { const r = await runOrderInstructionExpiryScan(database, { marketplaceCode: 'JP', limit: BATCH }, { actor, idempotencyKey: `scheduled:instruction-expiry:${Math.floor(input.now / 60_000)}`, now: input.now }); return { processed:r.attempted, succeeded:r.expired + r.unchanged, failed:r.failed, backlog:r.completed ? 0 : 1 }; }
  if (job === 'staff_auth_cleanup') { const r = await cleanupExpiredStaffAuthEphemeralRecords(database, input.now); return { processed:r.staffLoginStatesDeleted+r.staffAuthRateLimitsDeleted, succeeded:r.staffLoginStatesDeleted+r.staffAuthRateLimitsDeleted, failed:0, backlog:0 }; }
  if (job === 'file_orphan_cleanup') { if (!input.storage) return {processed:0,succeeded:0,failed:0,backlog:0}; const r = await reconcileInstructionAssetOrphans(database, input.storage, {limit:BATCH}, {actor, idempotencyKey:`scheduled:file-orphan:${Math.floor(input.now/60_000)}`, now:input.now}); return {processed:r.scanned,succeeded:r.deleted,failed:r.deferred,backlog:r.has_more?1:0}; }
  const event = await claimNextOutboxEvent(database, {now:input.now, leaseMs:LEASE_MS});
  if (!event) return {processed:0,succeeded:0,failed:0,backlog:0};
  if (!input.outboxAdapter) { await markOutboxFailed(database,event,{error:'adapter_unavailable',nextAttemptAt:input.now+backoff(event.attempt_count),now:input.now}); return {processed:1,succeeded:0,failed:1,backlog:1}; }
  try { await input.outboxAdapter.deliver({id:event.id,eventType:event.event_type,payloadJson:event.payload_json}); await markOutboxSent(database,event,input.now); return {processed:1,succeeded:1,failed:0,backlog:0}; } catch { await markOutboxFailed(database,event,{error:'delivery_failed',nextAttemptAt:input.now+backoff(event.attempt_count),now:input.now}); return {processed:1,succeeded:0,failed:1,backlog:1}; }
}
function backoff(attempt: number): number { return Math.min(3_600_000, 30_000 * 2 ** Math.min(attempt, 7)); }
function classify(error: unknown): string { return error instanceof Error && error.name === 'StaffAuthError' ? 'dependency_unavailable' : 'job_execution_failed'; }
async function record(database: SqlDatabase, job: ScheduledJobName, trigger: ScheduledTrigger, outcome: SafeJobRun['outcome'], processed: number, succeeded: number, failed: number, backlog: number, failure: string | null, now: number): Promise<SafeJobRun> { await database.prepare(`INSERT OR IGNORE INTO scheduled_job_states (job_name,updated_at) VALUES (?,?)`).bind(job,now).run(); await database.prepare(`INSERT INTO scheduled_job_runs (id,job_name,trigger_type,outcome,processed_count,succeeded_count,failed_count,backlog_count,failure_category,request_id,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),job,trigger,outcome,processed,succeeded,failed,backlog,failure,null,now,now).run(); return {job_name:job,outcome,processed_count:processed,succeeded_count:succeeded,failed_count:failed,backlog_count:backlog,failure_category:failure}; }
