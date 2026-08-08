import type { StaffWorkItemStatus, StaffWorkItemType } from './staff-assignment';

export const FEISHU_WORKBENCH_CALLBACK_ACTIONS = ['REASSIGN_WORK_ITEM'] as const;
export type FeishuWorkbenchCallbackAction = typeof FEISHU_WORKBENCH_CALLBACK_ACTIONS[number];
export const FEISHU_WORKBENCH_SYNC_FAILURE_CATEGORIES = [
  'adapter_unavailable', 'provider_rate_limited', 'provider_unavailable', 'contract_rejected',
] as const;
export type FeishuWorkbenchSyncFailureCategory = typeof FEISHU_WORKBENCH_SYNC_FAILURE_CATEGORIES[number];

export interface FeishuWorkbenchTaskSummaryDto {
  work_type: StaffWorkItemType;
  status: StaffWorkItemStatus;
  work_item_version: number;
  assignee_open_id: string;
  updated_at: number;
  safe_title: string;
  deep_link: string;
  time_basis: 'UTC_MS';
  display_timezone: 'Asia/Shanghai';
}

export interface FeishuWorkbenchCallbackDto {
  event_id: string;
  tenant_key: string;
  open_id: string;
  action: FeishuWorkbenchCallbackAction;
  task_guid: string;
  expected_version: number;
  target_open_id: string;
  reason: string;
}

export interface FeishuWorkbenchCallbackResultDto {
  outcome: 'SUCCEEDED' | 'REJECTED' | 'DUPLICATE' | 'IN_PROGRESS';
  work_item_id: string | null;
  version: number | null;
}

export interface FeishuWorkbenchAdapter {
  /**
   * `external_idempotency_key` is a one-way hash derived from the immutable
   * D1 work-item id. The raw internal id is never a standalone provider field.
   * A provider success followed by a D1 mirror-write failure is therefore
   * retried as an upsert of the same provider object, never as a new task.
   */
  upsertTask(input: FeishuWorkbenchTaskSummaryDto, previousMirrorKey: string | null, external_idempotency_key: string): Promise<{
    mirror_key: string;
    adapter_version: number;
  }>;
}

export function parseFeishuWorkbenchTaskSummaryDto(value: unknown): FeishuWorkbenchTaskSummaryDto {
  const record = exact(value, ['work_type','status','work_item_version','assignee_open_id','updated_at','safe_title','deep_link','time_basis','display_timezone']);
  if (!workType(record['work_type']) || !workStatus(record['status']) || !positive(record['work_item_version'])
    || !providerIdentifier(record['assignee_open_id']) || !timestamp(record['updated_at']) || !safeTitle(record['safe_title'])
    || !safeDeepLink(record['deep_link']) || record['time_basis'] !== 'UTC_MS' || record['display_timezone'] !== 'Asia/Shanghai') throw new Error('invalid_feishu_workbench_summary');
  return record as unknown as FeishuWorkbenchTaskSummaryDto;
}

export function parseFeishuWorkbenchCallbackDto(value: unknown): FeishuWorkbenchCallbackDto {
  const record = exact(value, ['event_id','tenant_key','open_id','action','task_guid','expected_version','target_open_id','reason']);
  if (!identifier(record['event_id']) || !short(record['tenant_key'],200) || !short(record['open_id'],200)
    || record['action'] !== 'REASSIGN_WORK_ITEM' || !providerIdentifier(record['task_guid'])
    || !positive(record['expected_version']) || !providerIdentifier(record['target_open_id']) || !short(record['reason'],1000)) throw new Error('invalid_feishu_workbench_callback');
  return record as unknown as FeishuWorkbenchCallbackDto;
}

export function parseFeishuWorkbenchCallbackResultDto(value: unknown): FeishuWorkbenchCallbackResultDto {
  const record=exact(value,['outcome','work_item_id','version']);
  if (!['SUCCEEDED','REJECTED','DUPLICATE','IN_PROGRESS'].includes(String(record['outcome']))
    || !(record['work_item_id']===null || identifier(record['work_item_id']))
    || !(record['version']===null || positive(record['version']))) throw new Error('invalid_feishu_workbench_callback_result');
  return record as unknown as FeishuWorkbenchCallbackResultDto;
}

function exact(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_feishu_workbench_contract');const r=value as Record<string,unknown>;if(Object.keys(r).length!==keys.length||Object.keys(r).some((key)=>!keys.includes(key)))throw new Error('invalid_feishu_workbench_contract');return r;}
function identifier(value:unknown){return short(value,200);}
function providerIdentifier(value:unknown){return short(value,200)&&/^(?:ou_|on_|[a-z0-9])[A-Za-z0-9_-]+$/u.test(String(value));}
function short(value:unknown,max:number){return typeof value==='string'&&value.length>=1&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);}
function timestamp(value:unknown){return Number.isSafeInteger(value)&&Number(value)>=0;}
function positive(value:unknown){return Number.isSafeInteger(value)&&Number(value)>=1;}
function safeTitle(value:unknown){return short(value,120);}
function safeDeepLink(value:unknown){if(typeof value!=='string'||value.length>500)return false;try{const url=new URL(value);return url.protocol==='https:'&&url.username===''&&url.password===''&&url.hash===''&&url.search===''&&/^\/staff\/work-items\/[^/]+$/u.test(url.pathname);}catch{return false;}}
function workType(value:unknown):value is StaffWorkItemType{return typeof value==='string'&&['PRODUCT_APPLICATION_REVIEW','DEMAND_REVIEW','RESERVATION_DECISION','ORDER_INSTRUCTION_PUBLISH','ORDER_EVIDENCE_REVIEW','REVIEW_DECISION','BUYER_REFUND_PROCESSING'].includes(value);}
function workStatus(value:unknown):value is StaffWorkItemStatus{return value==='OPEN'||value==='COMPLETED'||value==='CANCELLED';}
