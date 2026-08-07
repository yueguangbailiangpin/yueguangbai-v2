import { parseFeishuWorkbenchTaskSummaryDto, type FeishuWorkbenchAdapter, type FeishuWorkbenchSyncFailureCategory, type SqlDatabase, type StaffWorkItemStatus, type StaffWorkItemType } from '@ygb/contracts';
import { claimNextOutboxEvent, markOutboxFailed, markOutboxSent } from '../foundation/outbox';
import { FeishuWorkbenchAdapterError } from './mock-adapter';

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 30_000;

interface WorkItemRow { id:string; work_type:StaffWorkItemType; status:StaffWorkItemStatus; assigned_staff_id:string; version:number; updated_at:number; }
interface MirrorRow { mirror_key:string; mirrored_work_item_version:number; }

export async function runFeishuWorkbenchSyncBatch(database: SqlDatabase, adapter: FeishuWorkbenchAdapter | null, input: {webOrigin:string|null;now:number;limit:number;dryRun?:boolean}): Promise<{processed:number;succeeded:number;failed:number;backlog:number;failureCategory:FeishuWorkbenchSyncFailureCategory|null}> {
  const backlog=()=>countBacklog(database,input.now);
  if (!adapter || !input.webOrigin) return {processed:0,succeeded:0,failed:0,backlog:await backlog(),failureCategory:'adapter_unavailable'};
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
      const summary=parseFeishuWorkbenchTaskSummaryDto({work_item_id:item.id,work_type:item.work_type,status:item.status,assigned_staff_id:item.assigned_staff_id,updated_at:Number(item.updated_at),safe_title:title(item.work_type),deep_link:`${input.webOrigin}/staff/work-items/${encodeURIComponent(item.id)}`,time_basis:'UTC_MS',display_timezone:'Asia/Shanghai'});
      const result=await adapter.upsertTask(summary,mirror?.mirror_key??null);
      if(!safe(result.mirror_key,200)||!Number.isSafeInteger(result.adapter_version)||result.adapter_version<1||(mirror&&result.mirror_key!==mirror.mirror_key)) throw new FeishuWorkbenchAdapterError('CONTRACT');
      await database.batch([
        database.prepare(`INSERT INTO feishu_workbench_mirrors(work_item_id,mirror_key,mirrored_work_item_version,adapter_version,last_outbox_event_id,last_synced_at,version,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(work_item_id) DO UPDATE SET mirrored_work_item_version=excluded.mirrored_work_item_version,adapter_version=excluded.adapter_version,last_outbox_event_id=excluded.last_outbox_event_id,last_synced_at=excluded.last_synced_at,version=feishu_workbench_mirrors.version+1,updated_at=excluded.updated_at`).bind(item.id,result.mirror_key,item.version,result.adapter_version,event.id,input.now,input.now,input.now),
        database.prepare(`UPDATE integration_outbox SET status='SENT',lease_token=NULL,lease_expires_at=NULL,last_error=NULL,sent_at=?,updated_at=? WHERE aggregate_type='STAFF_WORK_ITEM' AND aggregate_id=? AND status IN ('PENDING','FAILED') AND created_at<?`).bind(input.now,input.now,item.id,item.updated_at),
      ]);
      await markOutboxSent(database,event,input.now); succeeded+=1;
    } catch(error) {
      const category=classify(error); failureCategory=category; failed+=1;
      const next=input.now+Math.min(3_600_000,BACKOFF_BASE_MS*2**Math.min(event.attempt_count,7));
      await markOutboxFailed(database,event,{error:category,nextAttemptAt:next,now:input.now});
    }
  }
  return {processed,succeeded,failed,backlog:await backlog(),failureCategory};
}

async function countBacklog(database:SqlDatabase,now:number){const row=await database.prepare("SELECT COUNT(*) AS count FROM integration_outbox WHERE aggregate_type='STAFF_WORK_ITEM' AND status IN ('PENDING','FAILED') AND available_at<=?").bind(now).first<{count:number}>();return Number(row?.count??0);}
function title(type:StaffWorkItemType){return ({PRODUCT_APPLICATION_REVIEW:'待处理商品申请',DEMAND_REVIEW:'待处理需求审核',RESERVATION_DECISION:'待处理预约决策',ORDER_INSTRUCTION_PUBLISH:'待处理下单指引',ORDER_EVIDENCE_REVIEW:'待处理订单凭证',REVIEW_DECISION:'待处理评价审核',BUYER_REFUND_PROCESSING:'待处理返款流程'} as const)[type];}
function safe(value:string,maximum:number){return value.length>=1&&value.length<=maximum&&!/[\u0000-\u001f\u007f]/u.test(value);}
function classify(error:unknown):FeishuWorkbenchSyncFailureCategory{if(error instanceof FeishuWorkbenchAdapterError){return error.code==='RATE_LIMITED'?'provider_rate_limited':error.code==='UNAVAILABLE'?'provider_unavailable':'contract_rejected';}return 'provider_unavailable';}
