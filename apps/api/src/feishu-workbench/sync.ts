import { parseFeishuWorkbenchTaskSummaryDto, type FeishuWorkbenchAdapter, type FeishuWorkbenchSyncFailureCategory, type SqlDatabase, type StaffWorkItemStatus, type StaffWorkItemType } from '@ygb/contracts';
import { claimNextOutboxEvent, markOutboxFailed, markOutboxSent } from '../foundation/outbox';
import { FeishuWorkbenchAdapterError } from './mock-adapter';
import { hashCanonicalJson } from '@ygb/domain';

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 30_000;

interface WorkItemRow { id:string; work_type:StaffWorkItemType; status:StaffWorkItemStatus; assigned_staff_id:string; version:number; updated_at:number; }
interface MirrorRow { mirror_key:string; mirrored_work_item_version:number; }

export async function runFeishuWorkbenchSyncBatch(database: SqlDatabase, adapter: FeishuWorkbenchAdapter | null, input: {webOrigin:string|null;tenantKey:string|null;now:number;limit:number;dryRun?:boolean}): Promise<{processed:number;succeeded:number;failed:number;backlog:number;failureCategory:FeishuWorkbenchSyncFailureCategory|null}> {
  const backlog=()=>countBacklog(database,input.now);
  if (!adapter || !input.webOrigin || !input.tenantKey) return {processed:0,succeeded:0,failed:0,backlog:await backlog(),failureCategory:'adapter_unavailable'};
  if (input.dryRun) return {processed:0,succeeded:0,failed:0,backlog:await backlog(),failureCategory:null};
  let processed=0; let succeeded=0; let failed=0; let failureCategory:FeishuWorkbenchSyncFailureCategory|null=null;
  while(processed<input.limit){
    const event=await claimNextOutboxEvent(database,{now:input.now,aggregateType:'STAFF_WORK_ITEM'});
    if(!event) break;
    processed+=1;
    try {
      const item=await database.prepare('SELECT id,work_type,status,assigned_staff_id,version,updated_at FROM staff_work_items WHERE id=?').bind(event.aggregate_id).first<WorkItemRow>();
      if(!item){ await markOutboxSent(database,event,input.now); succeeded+=1; continue; }
      const mirror=await database.prepare('SELECT mirror_key,mirrored_work_item_version FROM feishu_workbench_mirrors WHERE work_item_id=?').bind(item.id).first<MirrorRow>();
      // Terminal items without an existing mirror have nothing to close.  The
      // event is safely consumed; a pre-existing mirror still receives the
      // terminal snapshot below so the local card can close.
      if (!mirror && (item.status==='COMPLETED'||item.status==='CANCELLED')) { await markOutboxSent(database,event,input.now); succeeded+=1; continue; }
      const identities=await database.prepare("SELECT open_id FROM feishu_staff_identities WHERE staff_id=? AND tenant_key=? AND status='ACTIVE' ORDER BY open_id LIMIT 2").bind(item.assigned_staff_id,input.tenantKey).all<{open_id:string}>();
      if(identities.results.length!==1) throw new FeishuWorkbenchAdapterError('CONTRACT');
      const summary=parseFeishuWorkbenchTaskSummaryDto({work_type:item.work_type,status:item.status,work_item_version:item.version,assignee_open_id:identities.results[0]!.open_id,updated_at:Number(item.updated_at),safe_title:title(item.work_type),deep_link:`${input.webOrigin}/staff/work-items/${encodeURIComponent(item.id)}`,time_basis:'UTC_MS',display_timezone:'Asia/Shanghai'});
      const providerKey=(await hashCanonicalJson({namespace:'YGB_FEISHU_WORK_ITEM_V1',work_item_id:item.id})).slice(0,40);
      const result=await adapter.upsertTask(summary,mirror?.mirror_key??null,providerKey);
      if(!safe(result.mirror_key,200)||!Number.isSafeInteger(result.adapter_version)||result.adapter_version<1||(mirror&&result.mirror_key!==mirror.mirror_key)) throw new FeishuWorkbenchAdapterError('CONTRACT');
      await database.batch([
        database.prepare(`INSERT INTO feishu_workbench_mirrors(work_item_id,mirror_key,mirrored_work_item_version,adapter_version,last_outbox_event_id,last_synced_at,version,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(work_item_id) DO UPDATE SET mirrored_work_item_version=excluded.mirrored_work_item_version,adapter_version=excluded.adapter_version,last_outbox_event_id=excluded.last_outbox_event_id,last_synced_at=excluded.last_synced_at,version=feishu_workbench_mirrors.version+1,updated_at=excluded.updated_at`).bind(item.id,result.mirror_key,item.version,result.adapter_version,event.id,input.now,input.now,input.now),
        database.prepare(`UPDATE integration_outbox SET status='SENT',lease_token=NULL,lease_expires_at=NULL,last_error=NULL,sent_at=?,updated_at=? WHERE aggregate_type='STAFF_WORK_ITEM' AND aggregate_id=? AND status IN ('PENDING','FAILED') AND created_at<?`).bind(input.now,input.now,item.id,item.updated_at),
      ]);
      await markOutboxSent(database,event,input.now); succeeded+=1;
    } catch(error) {
      const category=classify(error); failureCategory=category; failed+=1;
      if (event.attempt_count>=MAX_ATTEMPTS) {
        await database.batch([
          database.prepare("INSERT OR IGNORE INTO scheduled_job_states(job_name,updated_at) VALUES('feishu_sync',?)").bind(input.now),
          database.prepare("INSERT INTO scheduled_dead_letters(id,job_name,source_kind,source_id,failure_category,attempt_count,quarantined_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(job_name,source_kind,source_id) DO UPDATE SET failure_category=excluded.failure_category,attempt_count=excluded.attempt_count,quarantined_at=excluded.quarantined_at,replay_status='QUARANTINED',replay_lease_token=NULL,replay_lease_expires_at=NULL,replayed_at=NULL,replayed_by_staff_id=NULL,replay_request_id=NULL,replay_idempotency_key=NULL,replay_version=scheduled_dead_letters.replay_version+1 WHERE scheduled_dead_letters.replay_status='REPLAYED'").bind(crypto.randomUUID(),'feishu_sync','OUTBOX',event.id,category,event.attempt_count,input.now),
          database.prepare("UPDATE integration_outbox SET status='FAILED',lease_token=NULL,lease_expires_at=NULL,last_error='quarantined',available_at=?,updated_at=? WHERE id=? AND status='PROCESSING' AND lease_token=?").bind(input.now+365*86400000,input.now,event.id,event.lease_token),
          database.prepare('INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),
        ]);
      } else {
        const next=input.now+Math.min(3_600_000,BACKOFF_BASE_MS*2**Math.min(event.attempt_count,7));
        await markOutboxFailed(database,event,{error:category,nextAttemptAt:next,now:input.now});
      }
    }
  }
  return {processed,succeeded,failed,backlog:await backlog(),failureCategory};
}

async function countBacklog(database:SqlDatabase,now:number){const row=await database.prepare("SELECT COUNT(*) AS count FROM integration_outbox event WHERE aggregate_type='STAFF_WORK_ITEM' AND status IN ('PENDING','FAILED') AND available_at<=? AND NOT EXISTS(SELECT 1 FROM scheduled_dead_letters dead WHERE dead.job_name='feishu_sync' AND dead.source_kind='OUTBOX' AND dead.source_id=event.id AND dead.replay_status IN ('QUARANTINED','PROCESSING'))").bind(now).first<{count:number}>();return Number(row?.count??0);}
function title(type:StaffWorkItemType){return ({PRODUCT_APPLICATION_REVIEW:'待处理商品申请',DEMAND_REVIEW:'待处理需求审核',RESERVATION_DECISION:'待处理预约决策',ORDER_INSTRUCTION_PUBLISH:'待处理下单指引',ORDER_EVIDENCE_REVIEW:'待处理订单凭证',REVIEW_DECISION:'待处理评价审核',BUYER_REFUND_PROCESSING:'待处理返款流程'} as const)[type];}
function safe(value:string,maximum:number){return value.length>=1&&value.length<=maximum&&!/[\u0000-\u001f\u007f]/u.test(value);}
function classify(error:unknown):FeishuWorkbenchSyncFailureCategory{if(error instanceof FeishuWorkbenchAdapterError){return error.code==='RATE_LIMITED'?'provider_rate_limited':error.code==='UNAVAILABLE'?'provider_unavailable':'contract_rejected';}return 'provider_unavailable';}
