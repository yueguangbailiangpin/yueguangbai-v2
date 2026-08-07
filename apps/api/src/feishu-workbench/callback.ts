import { parseFeishuWorkbenchCallbackDto, parseFeishuWorkbenchCallbackResultDto, type FeishuWorkbenchCallbackResultDto, type SqlDatabase } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { resolveAssignmentStaffAuthorization } from '../staff-assignment/effective-authorization';
import { reassignWorkItem } from '../staff-assignment/reassignment-service';
import { StaffAssignmentError } from '../staff-assignment/errors';
import { prepareStaffAssignmentOutboxStatements } from '../staff-assignment/outbox';

const WINDOW_MS=5*60*1000;
const LEASE_MS=60_000;
export class FeishuWorkbenchCallbackError extends Error { constructor(public readonly code:'VALIDATION_ERROR'|'UNAUTHENTICATED'|'FORBIDDEN'|'NOT_FOUND'|'VERSION_CONFLICT'|'DEPENDENCY_UNAVAILABLE',public readonly status:400|401|403|404|409|503){super(code);this.name='FeishuWorkbenchCallbackError';} }

export async function verifyFeishuWorkbenchSignature(input:{secret:string|null;signature:string|null;timestamp:string|null;nonce:string|null;body:string;now:number}):Promise<{timestamp:number;nonceHash:string;payloadHash:string}> {
  if(!input.secret) throw new FeishuWorkbenchCallbackError('DEPENDENCY_UNAVAILABLE',503);
  if(!/^[0-9a-f]{64}$/u.test(input.signature??'')||!/^\d{1,16}$/u.test(input.timestamp??'')||!safe(input.nonce??'',200)) throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED',401);
  const timestamp=Number(input.timestamp);
  if(!Number.isSafeInteger(timestamp)||timestamp<0||Math.abs(input.now-timestamp)>WINDOW_MS) throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED',401);
  const payloadHash=await sha256(input.body);
  const expected=await hmac(input.secret,`${input.timestamp}.${input.nonce}.${payloadHash}`);
  if(!constantTimeEqual(expected,input.signature!)) throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED',401);
  return {timestamp,nonceHash:await sha256(input.nonce!),payloadHash};
}

export async function handleFeishuWorkbenchCallback(database:SqlDatabase,input:{body:unknown;nonceHash:string;payloadHash:string;now:number;requestId?:string|null}):Promise<FeishuWorkbenchCallbackResultDto>{
  let callback;try{callback=parseFeishuWorkbenchCallbackDto(input.body);}catch{throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR',400);}
  if(callback.event_id.length<8) throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR',400);
  const claim=await claimReceipt(database,{eventId:callback.event_id,nonceHash:input.nonceHash,payloadHash:input.payloadHash,now:input.now});
  if(claim.kind==='MISMATCH') throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED',401);
  if(claim.kind==='DUPLICATE') return claim.result;
  if(claim.kind==='IN_PROGRESS') return {outcome:'IN_PROGRESS',work_item_id:null,version:null};
  try{
    const identity=await database.prepare(`SELECT identity.staff_id FROM feishu_staff_identities identity JOIN staff_users staff ON staff.id=identity.staff_id WHERE identity.tenant_key=? AND identity.open_id=? AND identity.status='ACTIVE' AND staff.status='ACTIVE'`).bind(callback.tenant_key,callback.open_id).first<{staff_id:string}>();
    if(!identity) throw new FeishuWorkbenchCallbackError('FORBIDDEN',403);
    const actor=await resolveAssignmentStaffAuthorization(database,identity.staff_id);
    if(!actor) throw new FeishuWorkbenchCallbackError('FORBIDDEN',403);
    const result=await reassignWorkItem(database,{workItemId:callback.work_item_id,targetStaffId:callback.target_staff_id,expectedVersion:callback.expected_version,reason:callback.reason},{actor,idempotencyKey:`feishu:${callback.event_id}`,requestId:input.requestId??null,now:input.now});
    const response=parseFeishuWorkbenchCallbackResultDto({outcome:'SUCCEEDED',work_item_id:result.work_item_id,version:result.version});
    await finishReceipt(database,claim,{status:'SUCCEEDED',response,now:input.now});
    return response;
  }catch(error){
    const normalized=normalize(error);
    if (normalized.code==='VERSION_CONFLICT') await enqueueReconciliation(database,callback.work_item_id,input.now);
    const failureCode=normalized.code==='FORBIDDEN'||normalized.code==='NOT_FOUND'||normalized.code==='VERSION_CONFLICT'
      ? normalized.code : 'DEPENDENCY_UNAVAILABLE';
    await finishReceipt(database,claim,{status:'REJECTED',failureCode,now:input.now}).catch(()=>undefined);
    if(normalized.code==='FORBIDDEN'||normalized.code==='NOT_FOUND'||normalized.code==='VERSION_CONFLICT') return {outcome:'REJECTED',work_item_id:null,version:null};
    throw normalized;
  }
}

type Claim={kind:'OWNED';leaseToken:string}|{kind:'DUPLICATE';result:FeishuWorkbenchCallbackResultDto}|{kind:'IN_PROGRESS'}|{kind:'MISMATCH'};
async function claimReceipt(database:SqlDatabase,input:{eventId:string;nonceHash:string;payloadHash:string;now:number}):Promise<Claim>{
  const leaseToken=`feishu-callback:${crypto.randomUUID()}`;
  try{const inserted=await database.prepare(`INSERT INTO feishu_workbench_callback_receipts(event_id,nonce_hash,payload_hash,status,response_json,failure_code,lease_token,lease_expires_at,version,created_at,updated_at,completed_at) VALUES(?,?,?,'PROCESSING',NULL,NULL,?,?,1,?,?,NULL) ON CONFLICT(event_id) DO UPDATE SET lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,version=feishu_workbench_callback_receipts.version+1,updated_at=MAX(excluded.updated_at,feishu_workbench_callback_receipts.updated_at+1) WHERE feishu_workbench_callback_receipts.status='PROCESSING' AND feishu_workbench_callback_receipts.payload_hash=excluded.payload_hash AND feishu_workbench_callback_receipts.nonce_hash=excluded.nonce_hash AND feishu_workbench_callback_receipts.lease_expires_at<=? RETURNING lease_token`).bind(input.eventId,input.nonceHash,input.payloadHash,leaseToken,input.now+LEASE_MS,input.now,input.now,input.now).first<{lease_token:string}>();if(inserted?.lease_token===leaseToken)return{kind:'OWNED',leaseToken};}catch(error){if(!String(error).includes('UNIQUE constraint failed: feishu_workbench_callback_receipts.nonce_hash'))throw error;const nonceOwner=await database.prepare('SELECT event_id FROM feishu_workbench_callback_receipts WHERE nonce_hash=?').bind(input.nonceHash).first<{event_id:string}>();if(nonceOwner?.event_id!==input.eventId)return{kind:'MISMATCH'};}
  const row=await database.prepare('SELECT nonce_hash,payload_hash,status,response_json,lease_expires_at FROM feishu_workbench_callback_receipts WHERE event_id=?').bind(input.eventId).first<{nonce_hash:string;payload_hash:string;status:'PROCESSING'|'SUCCEEDED'|'REJECTED';response_json:string|null;lease_expires_at:number|null}>();
  if(!row||row.nonce_hash!==input.nonceHash||row.payload_hash!==input.payloadHash)return{kind:'MISMATCH'};
  if(row.status==='PROCESSING'&&Number(row.lease_expires_at)>input.now)return{kind:'IN_PROGRESS'};
  if(row.status==='SUCCEEDED'&&row.response_json){try{return{kind:'DUPLICATE',result:parseFeishuWorkbenchCallbackResultDto(JSON.parse(row.response_json))};}catch{throw new FeishuWorkbenchCallbackError('DEPENDENCY_UNAVAILABLE',503);}}
  return{kind:'DUPLICATE',result:{outcome:'REJECTED',work_item_id:null,version:null}};
}
async function enqueueReconciliation(database:SqlDatabase,workItemId:string,now:number):Promise<void>{
  const item=await database.prepare('SELECT id,version FROM staff_work_items WHERE id=?').bind(workItemId).first<{id:string;version:number}>();
  if(!item)return;
  const statements=await prepareStaffAssignmentOutboxStatements(database,{dedupKey:`staff-work-item:${item.id}:feishu-reconcile:v${item.version}`,eventType:'FEISHU_WORKBENCH_RECONCILE',aggregateType:'STAFF_WORK_ITEM',aggregateId:item.id,payload:{work_item_id:item.id,reconciliation:'VERSION_CONFLICT'},now});
  await database.batch(statements);
}
async function finishReceipt(database:SqlDatabase,claim:Extract<Claim,{kind:'OWNED'}>,input:{status:'SUCCEEDED';response:FeishuWorkbenchCallbackResultDto;now:number}|{status:'REJECTED';failureCode:'FORBIDDEN'|'NOT_FOUND'|'VERSION_CONFLICT'|'DEPENDENCY_UNAVAILABLE';now:number}){const result=await database.prepare(`UPDATE feishu_workbench_callback_receipts SET status=?,response_json=?,failure_code=?,lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=MAX(?,updated_at+1),completed_at=MAX(?,updated_at+1) WHERE event_id=(SELECT event_id FROM feishu_workbench_callback_receipts WHERE lease_token=? LIMIT 1) AND status='PROCESSING' AND lease_token=?`).bind(input.status,input.status==='SUCCEEDED'?JSON.stringify(input.response):null,input.status==='REJECTED'?input.failureCode:null,input.now,input.now,claim.leaseToken,claim.leaseToken).run();if((result as {meta?:{changes?:number}}).meta?.changes!==1)throw new FeishuWorkbenchCallbackError('DEPENDENCY_UNAVAILABLE',503);}
function normalize(error:unknown):FeishuWorkbenchCallbackError{if(error instanceof FeishuWorkbenchCallbackError)return error;if(error instanceof StaffAssignmentError){if(error.code==='FORBIDDEN')return new FeishuWorkbenchCallbackError('FORBIDDEN',403);if(error.code==='NOT_FOUND')return new FeishuWorkbenchCallbackError('NOT_FOUND',404);if(error.code==='VERSION_CONFLICT'||error.code==='IDEMPOTENCY_CONFLICT'||error.code==='REQUEST_IN_PROGRESS')return new FeishuWorkbenchCallbackError('VERSION_CONFLICT',409);}return new FeishuWorkbenchCallbackError('DEPENDENCY_UNAVAILABLE',503);}
async function sha256(value:string){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(hash)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');}
async function hmac(secret:string,value:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value));return [...new Uint8Array(signature)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');}
function constantTimeEqual(left:string,right:string){if(left.length!==right.length)return false;let difference=0;for(let index=0;index<left.length;index+=1)difference|=left.charCodeAt(index)^right.charCodeAt(index);return difference===0;}
function safe(value:string,max:number){return value.length>=1&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);}
