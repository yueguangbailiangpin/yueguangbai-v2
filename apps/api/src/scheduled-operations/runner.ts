import { statementChangedOnce, type DriveArchiveAdapter, type FeishuWorkbenchAdapter, type ObjectStorageAdapter, type SqlDatabase, type StaffPermissionCode, type StaffRoleCode } from '@ygb/contracts';
import { reconcileDriveArchiveBatch, runDriveArchiveBatch } from '../cold-image-archive/job';
import { claimNextOutboxEvent, markOutboxFailed, markOutboxSent } from '../foundation/outbox';
import { reconcileInstructionAssetOrphans } from '../order-instructions/asset-reconciliation';
import { countOrderInstructionExpiryCandidates, runOrderInstructionExpiryScan } from '../order-instructions/expiry-scan';
import { cleanupExpiredStaffAuthEphemeralRecords } from '../staff-auth/cleanup';
import { expireReservation } from '../reservations/expire-reservation';
import { runFeishuWorkbenchSyncBatch } from '../feishu-workbench/sync';

export const SCHEDULED_JOB_NAMES = [
  'reservation_expiry', 'instruction_expiry', 'outbox_delivery', 'file_orphan_cleanup', 'staff_auth_cleanup',
  'drive_archive', 'feishu_sync',
] as const;
export type ScheduledJobName = typeof SCHEDULED_JOB_NAMES[number];
export type ScheduledTrigger = 'CRON' | 'MANUAL';
export interface SafeJobRun { job_name: ScheduledJobName; outcome: 'SUCCEEDED'|'PARTIAL'|'FAILED'|'SKIPPED'|'DISABLED'; processed_count: number; succeeded_count: number; failed_count: number; backlog_count: number; failure_category: string | null; }
export interface OutboxDeliveryAdapter { deliver(event: { id: string; eventType: string; payloadJson: string }): Promise<void>; }
const LEASE_MS = 90_000;
const BATCH = 50;
const MAX_OUTBOX_ATTEMPTS = 5;
const SYSTEM_SCHEDULER_ACTOR = Object.freeze({
  staffId: 'system-scheduler', displayName: 'System Scheduler',
  staffStatus: 'ACTIVE' as const, authorizationVersion: 1,
  memberTeamIds: Object.freeze([]), leaderTeamIds: Object.freeze([]),
  roles: new Set<StaffRoleCode>(['owner']),
  permissions: new Set<StaffPermissionCode>(['ORDER_INSTRUCTION_EXPIRY_RUN','ORDER_INSTRUCTION_MANAGE']),
});

export async function runScheduledOperations(database: SqlDatabase, input: { now?: number; enabled?: boolean; disabledJobs?: readonly string[]; storage?: ObjectStorageAdapter | null; driveAdapter?: DriveArchiveAdapter | null; driveArchiveEnabled?: boolean; driveArchiveCopyEnabled?: boolean; driveArchiveProxyReadEnabled?: boolean; driveArchiveR2DeleteEnabled?: boolean; outboxAdapter?: OutboxDeliveryAdapter | null; feishuAdapter?: FeishuWorkbenchAdapter | null; feishuWebOrigin?: string | null; trigger?: ScheduledTrigger; only?: ScheduledJobName; dryRun?: boolean; deadlineReached?: () => boolean; batchSize?: number; }): Promise<SafeJobRun[]> {
  const now = input.now ?? Date.now();
  const names = input.only ? [input.only] : SCHEDULED_JOB_NAMES;
  const output: SafeJobRun[] = [];
  for (const job of names) {
    if (input.deadlineReached?.()) {
      if (input.only) output.push(await record(database, job, input.trigger ?? 'CRON', 'SKIPPED', 0, 0, 0, 0, 'job_execution_failed', now));
      break;
    }
    output.push(await runOne(database, job, { ...input, now }));
  }
  return output;
}

async function runOne(database: SqlDatabase, job: ScheduledJobName, input: Required<Pick<Parameters<typeof runScheduledOperations>[1], 'now'>> & Parameters<typeof runScheduledOperations>[1]): Promise<SafeJobRun> {
  const driveHardDisabled=job==='drive_archive' && (input.driveArchiveEnabled!==true
    || input.driveArchiveCopyEnabled!==true || !input.storage || !input.driveAdapter);
  const feishuHardDisabled=job==='feishu_sync' && (!input.feishuAdapter || !input.feishuWebOrigin);
  if (input.enabled === false || input.disabledJobs?.includes(job) || driveHardDisabled || feishuHardDisabled) return {job_name:job,outcome:'DISABLED',processed_count:0,succeeded_count:0,failed_count:0,backlog_count:0,failure_category:null};
  const configured=await database.prepare('SELECT enabled FROM scheduled_job_states WHERE job_name=?').bind(job).first<{enabled:number}>();
  if (configured?.enabled===0) return {job_name:job,outcome:'DISABLED',processed_count:0,succeeded_count:0,failed_count:0,backlog_count:0,failure_category:null};
  const token = `scheduled:${crypto.randomUUID()}`;
  const acquired = await database.prepare(`
    INSERT INTO scheduled_job_states (job_name, lease_token, lease_expires_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(job_name) DO UPDATE SET lease_token=excluded.lease_token, lease_expires_at=excluded.lease_expires_at, version=scheduled_job_states.version+1, updated_at=excluded.updated_at
    WHERE scheduled_job_states.lease_expires_at IS NULL OR scheduled_job_states.lease_expires_at<=?
    RETURNING job_name
  `).bind(job, token, input.now + LEASE_MS, input.now, input.now).first<{job_name:string}>();
  if (!acquired) return record(database, job, input.trigger ?? 'CRON', 'SKIPPED', 0, 0, 0, 0, null, input.now);
  await database.prepare(`UPDATE scheduled_job_states SET last_started_at=?, updated_at=? WHERE job_name=? AND lease_token=?`).bind(input.now, input.now, job, token).run();
  try {
    const result = await execute(database, job, input);
    const outcome = result.failed === 0 ? 'SUCCEEDED' : result.succeeded > 0 ? 'PARTIAL' : 'FAILED';
    const category = result.failed === 0 ? null : result.failureCategory ?? 'job_item_failed';
    const completed=await database.prepare(`UPDATE scheduled_job_states SET lease_token=NULL, lease_expires_at=NULL, cursor_json=?, version=version+1, last_succeeded_at=CASE WHEN ?='SUCCEEDED' THEN ? ELSE last_succeeded_at END, last_failed_at=CASE WHEN ?='SUCCEEDED' THEN last_failed_at ELSE ? END, last_backlog_count=?, last_failure_category=?, updated_at=? WHERE job_name=? AND lease_token=?`).bind(result.cursorJson ?? null,outcome,input.now,outcome,input.now,result.backlog,category,input.now,job,token).run();
    if (!statementChangedOnce(completed)) return record(database, job, input.trigger ?? 'CRON', 'PARTIAL', result.processed, result.succeeded, result.failed, result.backlog, 'lease_lost', input.now);
    return record(database, job, input.trigger ?? 'CRON', outcome, result.processed, result.succeeded, result.failed, result.backlog, category, input.now);
  } catch (error) {
    const category = classify(error);
    const completed=await database.prepare(`UPDATE scheduled_job_states SET lease_token=NULL, lease_expires_at=NULL, last_failed_at=?, last_failure_category=?, updated_at=? WHERE job_name=? AND lease_token=?`).bind(input.now, category, input.now, job, token).run();
    if (!statementChangedOnce(completed)) return record(database, job, input.trigger ?? 'CRON', 'PARTIAL', 0, 0, 1, 0, 'lease_lost', input.now);
    return record(database, job, input.trigger ?? 'CRON', 'FAILED', 0, 0, 1, 0, category, input.now);
  }
}

async function execute(database: SqlDatabase, job: ScheduledJobName, input: Parameters<typeof runScheduledOperations>[1] & {now:number}): Promise<{processed:number;succeeded:number;failed:number;backlog:number;failureCategory?:string | undefined;cursorJson?:string | undefined}> {
  const actor = SYSTEM_SCHEDULER_ACTOR;
  const batchSize = Number.isSafeInteger(input.batchSize) && Number(input.batchSize) > 0 && Number(input.batchSize) <= BATCH ? Number(input.batchSize) : BATCH;
  if (job === 'reservation_expiry') {
    const state = await database.prepare('SELECT cursor_json FROM scheduled_job_states WHERE job_name=?').bind(job).first<{cursor_json:string|null}>();
    const cursor = parseCursor(state?.cursor_json);
    const rows = await database.prepare(`SELECT id,version,due_at FROM (SELECT id,version,CASE WHEN status='PENDING_REVIEW' THEN hold_expires_at ELSE order_deadline_snapshot END AS due_at FROM product_reservations WHERE status IN ('PENDING_REVIEW','APPROVED')) WHERE due_at<=? AND (? IS NULL OR due_at>? OR (due_at=? AND id>?)) ORDER BY due_at,id LIMIT ?`).bind(input.now,cursor?.due ?? null,cursor?.due ?? 0,cursor?.due ?? 0,cursor?.id ?? '',batchSize + 1).all<{id:string;version:number;due_at:number}>();
    let succeeded = 0; let failed = 0;
    if (input.dryRun) return { processed: 0, succeeded: 0, failed: 0, backlog: await countReservationExpiryCandidates(database,input.now), cursorJson: state?.cursor_json ?? undefined };
    let last: {id:string;due_at:number}|undefined;
    for (const row of rows.results.slice(0, batchSize)) { if(input.deadlineReached?.()) break; try { await expireReservation(database, { reservationId: row.id, expectedVersion: Number(row.version) }, { idempotencyKey: `scheduled:reservation-expiry:${row.id}:${row.due_at}`, now: input.now }); succeeded += 1; last=row; } catch { failed += 1; last=row; } }
    const processed=succeeded+failed;
    const more=processed<rows.results.length || rows.results.length>batchSize;
    const cursorJson=more ? last ? JSON.stringify({due:last.due_at,id:last.id}) : state?.cursor_json ?? undefined : undefined;
    return { processed, succeeded, failed, backlog: await countReservationExpiryCandidates(database,input.now), failureCategory: failed ? 'reservation_expiry_failed' : undefined, cursorJson };
  }
  if (job === 'instruction_expiry') {
    if (input.dryRun) return {processed:0,succeeded:0,failed:0,backlog:await countOrderInstructionExpiryCandidates(database,'JP',input.now)};
    const state=await database.prepare('SELECT version FROM scheduled_job_states WHERE job_name=?').bind(job).first<{version:number}>();
    const r = await runOrderInstructionExpiryScan(database, { marketplaceCode: 'JP', limit: batchSize, ...(input.deadlineReached ? {deadlineReached:input.deadlineReached} : {}) }, { actor, idempotencyKey: `scheduled:instruction-expiry:${state?.version ?? 0}`, now: input.now });
    if (r.completed) await database.prepare("UPDATE order_instruction_expiry_scan_cursors SET deadline_at=NULL,instruction_id=NULL,scanned_at=?,version=version+1,updated_at=? WHERE marketplace_code='JP'").bind(input.now,input.now).run();
    const backlog=await countOrderInstructionExpiryCandidates(database,'JP',input.now);
    return { processed:r.attempted, succeeded:r.expired + r.unchanged, failed:r.failed, backlog, cursorJson:r.completed ? undefined : JSON.stringify({marketplace_code:'JP',next_deadline_at:r.next_deadline_at,next_instruction_id:r.next_instruction_id}), failureCategory:r.failed ? 'job_item_failed' : undefined };
  }
  if (job === 'staff_auth_cleanup') { const r = await cleanupExpiredStaffAuthEphemeralRecords(database, input.now, {limit:batchSize,dryRun:input.dryRun === true}); return { processed:r.staffLoginStatesDeleted+r.staffAuthRateLimitsDeleted, succeeded:r.staffLoginStatesDeleted+r.staffAuthRateLimitsDeleted, failed:0, backlog:r.hasMore ? batchSize+1 : 0 }; }
  if (job === 'file_orphan_cleanup') { if (!input.storage) return {processed:0,succeeded:0,failed:1,backlog:await countFileOrphanCleanupCandidates(database,input.now),failureCategory:'adapter_unavailable'}; const state=await database.prepare('SELECT cursor_json FROM scheduled_job_states WHERE job_name=?').bind(job).first<{cursor_json:string|null}>(); const cursor=parseFileCursor(state?.cursor_json); const r = await reconcileInstructionAssetOrphans(database, input.storage, {limit:batchSize,cursor,dryRun:input.dryRun === true,...(input.deadlineReached ? {deadlineReached:input.deadlineReached} : {})}, {actor, idempotencyKey:`scheduled:file-orphan:${Math.floor(input.now/60_000)}`, now:input.now}); return {processed:r.scanned,succeeded:r.deleted,failed:r.deferred,backlog:r.backlog_count,failureCategory:r.deferred?'file_cleanup_deferred':undefined,cursorJson:r.next_cursor ? JSON.stringify(r.next_cursor) : undefined}; }
  if (job === 'drive_archive') {
    if (!input.storage || !input.driveAdapter) return {processed:0,succeeded:0,failed:1,backlog:0,failureCategory:'adapter_unavailable'};
    const result=await runDriveArchiveBatch(database,input.storage,input.driveAdapter,{
      now:input.now,limit:batchSize,copyEnabled:input.driveArchiveCopyEnabled===true,
      proxyReadEnabled:input.driveArchiveProxyReadEnabled===true,
      r2DeleteEnabled:input.driveArchiveR2DeleteEnabled===true,dryRun:input.dryRun===true,
      ...(input.deadlineReached?{deadlineReached:input.deadlineReached}:{}),
    });
    const reconciliation=input.dryRun===true||input.deadlineReached?.()?{processed:0,succeeded:0,failed:0}
      :await reconcileDriveArchiveBatch(database,input.driveAdapter,{now:input.now,limit:5,
        ...(input.deadlineReached?{deadlineReached:input.deadlineReached}:{})});
    return {processed:result.processed+reconciliation.processed,succeeded:result.succeeded+reconciliation.succeeded,
      failed:result.failed+reconciliation.failed,backlog:result.backlog,
      failureCategory:result.failed+reconciliation.failed>0?'job_item_failed':undefined};
  }
  if (job === 'feishu_sync') {
    const result=await runFeishuWorkbenchSyncBatch(database,input.feishuAdapter??null,{webOrigin:input.feishuWebOrigin??null,now:input.now,limit:batchSize,dryRun:input.dryRun===true});
    return {processed:result.processed,succeeded:result.succeeded,failed:result.failed,backlog:result.backlog,failureCategory:result.failureCategory??undefined};
  }
  if (input.dryRun) { const c=await database.prepare("SELECT COUNT(*) AS count FROM integration_outbox o WHERE status IN ('PENDING','FAILED') AND available_at<=? AND NOT EXISTS(SELECT 1 FROM scheduled_dead_letters d WHERE d.source_kind='OUTBOX' AND d.source_id=o.id AND d.replay_status IN ('QUARANTINED','PROCESSING'))").bind(input.now).first<{count:number}>(); return {processed:0,succeeded:0,failed:0,backlog:Number(c?.count??0)}; }
  let processed=0; let succeeded=0; let failed=0; let category: 'adapter_unavailable'|'delivery_failed'|undefined;
  for (; processed<batchSize && !input.deadlineReached?.(); processed += 1) {
  const event = await claimNextOutboxEvent(database, {now:input.now, leaseMs:LEASE_MS,excludeAggregateType:'STAFF_WORK_ITEM'});
  if (!event) break;
  const fail = async (kind: 'adapter_unavailable'|'delivery_failed') => { category=kind; failed += 1; if(event.attempt_count>=MAX_OUTBOX_ATTEMPTS) { await database.prepare("INSERT INTO scheduled_dead_letters(id,job_name,source_kind,source_id,failure_category,attempt_count,quarantined_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(job_name,source_kind,source_id) DO UPDATE SET failure_category=excluded.failure_category,attempt_count=excluded.attempt_count,quarantined_at=excluded.quarantined_at,replay_status='QUARANTINED',replay_lease_token=NULL,replay_lease_expires_at=NULL,replayed_at=NULL,replayed_by_staff_id=NULL,replay_request_id=NULL,replay_idempotency_key=NULL,replay_version=scheduled_dead_letters.replay_version+1 WHERE scheduled_dead_letters.replay_status='REPLAYED'").bind(crypto.randomUUID(),'outbox_delivery','OUTBOX',event.id,kind,event.attempt_count,input.now).run(); await markOutboxFailed(database,event,{error:'quarantined',nextAttemptAt:input.now+365*86400000,now:input.now}); } else await markOutboxFailed(database,event,{error:kind,nextAttemptAt:input.now+backoff(event.attempt_count),now:input.now}); };
  if (!input.outboxAdapter) await fail('adapter_unavailable');
  else try { await input.outboxAdapter.deliver({id:event.id,eventType:event.event_type,payloadJson:event.payload_json}); await markOutboxSent(database,event,input.now); succeeded += 1; } catch { await fail('delivery_failed'); }
  }
  const pending=await database.prepare("SELECT COUNT(*) AS count FROM integration_outbox o WHERE o.status IN ('PENDING','FAILED') AND NOT EXISTS(SELECT 1 FROM scheduled_dead_letters d WHERE d.source_kind='OUTBOX' AND d.source_id=o.id AND d.replay_status IN ('QUARANTINED','PROCESSING'))").first<{count:number}>();
  return {processed,succeeded,failed,backlog:Number(pending?.count??0),failureCategory:category};
}
function backoff(attempt: number): number { return Math.min(3_600_000, 30_000 * 2 ** Math.min(attempt, 7)); }
async function countReservationExpiryCandidates(database: SqlDatabase, now: number): Promise<number> { const row=await database.prepare("SELECT COUNT(*) AS count FROM product_reservations WHERE (status='PENDING_REVIEW' AND hold_expires_at<=?) OR (status='APPROVED' AND order_deadline_snapshot<=?)").bind(now,now).first<{count:number}>(); return Number(row?.count??0); }
async function countFileOrphanCleanupCandidates(database: SqlDatabase, now: number): Promise<number> { const row=await database.prepare("SELECT COUNT(*) AS count FROM order_instruction_asset_items item JOIN order_instruction_asset_batches batch ON batch.id=item.asset_batch_id JOIN file_objects object ON object.id=item.file_object_id WHERE item.status='ORPHANED' AND batch.status IN ('FAILED','CANCELLED') AND object.status='DELETION_PENDING' AND object.next_delete_at<=? AND NOT EXISTS (SELECT 1 FROM file_entity_links link WHERE link.file_object_id=object.id AND link.revoked_at IS NULL)").bind(now).first<{count:number}>(); return Number(row?.count??0); }
function classify(error: unknown): string { return error instanceof Error && error.name === 'StaffAuthError' ? 'dependency_unavailable' : 'job_execution_failed'; }
function parseCursor(value: string | null | undefined): {due:number;id:string} | null { try { const parsed=JSON.parse(value ?? 'null') as {due?:unknown;id?:unknown}|null; return parsed && Number.isSafeInteger(parsed.due) && typeof parsed.id==='string' ? {due:Number(parsed.due),id:parsed.id} : null; } catch { return null; } }
function parseFileCursor(value: string | null | undefined): {next_delete_at:number;updated_at:number;item_id:string} | null { try { const p=JSON.parse(value ?? 'null') as Record<string,unknown>|null; return p && Number.isSafeInteger(p['next_delete_at']) && Number.isSafeInteger(p['updated_at']) && typeof p['item_id']==='string' ? {next_delete_at:Number(p['next_delete_at']),updated_at:Number(p['updated_at']),item_id:p['item_id']} : null; } catch { return null; } }
async function record(database: SqlDatabase, job: ScheduledJobName, trigger: ScheduledTrigger, outcome: SafeJobRun['outcome'], processed: number, succeeded: number, failed: number, backlog: number, failure: string | null, now: number): Promise<SafeJobRun> { await database.prepare(`INSERT OR IGNORE INTO scheduled_job_states (job_name,updated_at) VALUES (?,?)`).bind(job,now).run(); await database.prepare(`INSERT INTO scheduled_job_runs (id,job_name,trigger_type,outcome,processed_count,succeeded_count,failed_count,backlog_count,failure_category,request_id,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),job,trigger,outcome,processed,succeeded,failed,backlog,failure,null,now,now).run(); return {job_name:job,outcome,processed_count:processed,succeeded_count:succeeded,failed_count:failed,backlog_count:backlog,failure_category:failure}; }
