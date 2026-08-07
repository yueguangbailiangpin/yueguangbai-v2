import type {
  ArchiveComponent,
  ArchiveComponentState,
  OrderArchiveClosureResultDto,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { ARCHIVE_COMPONENTS } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  IdempotencyError,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { archiveDueAt } from './time';

type ClosureErrorCode = 'VALIDATION_ERROR'|'FORBIDDEN'|'NOT_FOUND'|'VERSION_CONFLICT'|'STATE_CONFLICT'|'IDEMPOTENCY_CONFLICT'|'REQUEST_IN_PROGRESS'|'DEPENDENCY_UNAVAILABLE';
type ComponentCompletion = {state:ArchiveComponentState;completedAt:number};
interface ClosureRow extends Omit<OrderArchiveClosureResultDto,'replayed'> {
  closed_by_staff_id:string;
  close_reason:string;
}

export class ColdArchiveCommandError extends Error {
  constructor(public readonly code:ClosureErrorCode,public readonly status:400|403|404|409|503){super(code);this.name='ColdArchiveCommandError';}
}

export async function recordOrderBusinessClosure(
  database:SqlDatabase,
  input:{formalOrderId:string;expectedVersion:number;notApplicable:readonly ArchiveComponent[];reason:string},
  command:{actor:AssignmentStaffAuthorization;idempotencyKey:string;requestId?:string|null;now?:number;afterClaimed?:()=>Promise<void>},
):Promise<OrderArchiveClosureResultDto>{
  requireOwner(command.actor);
  const formalOrderId=safeId(input.formalOrderId);
  const expectedVersion=version(input.expectedVersion,true);
  const notApplicable=components(input.notApplicable);
  const reason=safeReason(input.reason);
  const now=safeNow(command.now??Date.now());
  const requestHash=await hashCanonicalJson({action:'CLOSE_ORDER_ARCHIVE',formal_order_id:formalOrderId,
    expected_version:expectedVersion,not_applicable:notApplicable,reason});
  const acquired=await acquireIdempotency<OrderArchiveClosureResultDto>(database,{actorType:'STAFF',actorId:command.actor.staffId,
    action:'CLOSE_ORDER_ARCHIVE',targetType:'FORMAL_ORDER',targetId:formalOrderId,
    idempotencyKey:command.idempotencyKey,requestHash},{now}).catch(translateIdempotency);
  if(acquired.kind==='REPLAY') return {...acquired.response,replayed:true};
  try{
    await command.afterClaimed?.();
    const existing=await database.prepare(`SELECT formal_order_id,status,version,business_closed_at,archive_due_at,
      review_state,buyer_refund_state,seller_principal_state,seller_service_fee_state,
      closed_by_staff_id,close_reason FROM order_archive_closures WHERE formal_order_id=?`)
      .bind(formalOrderId).first<ClosureRow>();
    if((existing?.version??0)!==expectedVersion) throw new ColdArchiveCommandError('VERSION_CONFLICT',409);
    if(existing?.status==='CLOSED') throw new ColdArchiveCommandError('STATE_CONFLICT',409);
    const order=await database.prepare(`SELECT confirmed_at FROM formal_orders WHERE id=? AND status='CONFIRMED'`)
      .bind(formalOrderId).first<{confirmed_at:number}>();
    if(!order) throw new ColdArchiveCommandError('NOT_FOUND',404);
    const explicit=new Set(notApplicable);
    const review=await reviewCompletion(database,formalOrderId,explicit.has('review'),order.confirmed_at);
    const refund=await refundCompletion(database,formalOrderId,explicit.has('buyer_refund'),order.confirmed_at);
    const principal=await payableCompletion(database,formalOrderId,'SELLER_PRINCIPAL',explicit.has('seller_principal'),order.confirmed_at);
    const fee=await payableCompletion(database,formalOrderId,'SELLER_SERVICE_FEE',explicit.has('seller_service_fee'),order.confirmed_at);
    const businessClosedAt=Math.max(order.confirmed_at,review.completedAt,refund.completedAt,principal.completedAt,fee.completedAt);
    const response:OrderArchiveClosureResultDto={formal_order_id:formalOrderId,status:'CLOSED',version:expectedVersion+1,
      business_closed_at:businessClosedAt,archive_due_at:archiveDueAt(businessClosedAt),review_state:review.state,
      buyer_refund_state:refund.state,seller_principal_state:principal.state,seller_service_fee_state:fee.state,replayed:false};
    const mutation=existing
      ?database.prepare(`UPDATE order_archive_closures SET review_state=?,buyer_refund_state=?,seller_principal_state=?,
        seller_service_fee_state=?,status='CLOSED',business_closed_at=?,archive_due_at=?,closed_by_staff_id=?,
        close_reason=?,close_idempotency_key=?,reopened_at=NULL,reopened_by_staff_id=NULL,reopen_reason=NULL,
        reopen_idempotency_key=NULL,version=version+1,updated_at=MAX(?,updated_at+1)
        WHERE formal_order_id=? AND status='REOPENED' AND version=?`).bind(review.state,refund.state,principal.state,
          fee.state,businessClosedAt,response.archive_due_at,command.actor.staffId,reason,acquired.claim.idempotencyKey,
          now,formalOrderId,expectedVersion)
      :database.prepare(`INSERT INTO order_archive_closures(formal_order_id,review_state,buyer_refund_state,
        seller_principal_state,seller_service_fee_state,status,business_closed_at,archive_due_at,closed_by_staff_id,
        close_reason,close_idempotency_key,reopened_at,reopened_by_staff_id,reopen_reason,reopen_idempotency_key,
        version,created_at,updated_at) VALUES(?,?,?,?,?,'CLOSED',?,?,?,?,?,NULL,NULL,NULL,NULL,1,?,?)`)
        .bind(formalOrderId,review.state,refund.state,principal.state,fee.state,businessClosedAt,response.archive_due_at,
          command.actor.staffId,reason,acquired.claim.idempotencyKey,now,now);
    await database.batch(completion(database,{mutation,response,existing,reason,command,claim:acquired.claim,now}));
    return response;
  }catch(error){
    const normalized=normalize(error);
    await markIdempotencyFailed(database,acquired.claim,normalized.code,now).catch(()=>false);
    throw normalized;
  }
}

export async function reopenOrderBusinessClosure(
  database:SqlDatabase,
  input:{formalOrderId:string;expectedVersion:number;reason:string},
  command:{actor:AssignmentStaffAuthorization;idempotencyKey:string;requestId?:string|null;now?:number;afterClaimed?:()=>Promise<void>},
):Promise<OrderArchiveClosureResultDto>{
  requireOwner(command.actor);
  const formalOrderId=safeId(input.formalOrderId);const expectedVersion=version(input.expectedVersion,false);
  const reason=safeReason(input.reason);const now=safeNow(command.now??Date.now());
  const requestHash=await hashCanonicalJson({action:'REOPEN_ORDER_ARCHIVE',formal_order_id:formalOrderId,
    expected_version:expectedVersion,reason});
  const acquired=await acquireIdempotency<OrderArchiveClosureResultDto>(database,{actorType:'STAFF',actorId:command.actor.staffId,
    action:'REOPEN_ORDER_ARCHIVE',targetType:'FORMAL_ORDER',targetId:formalOrderId,
    idempotencyKey:command.idempotencyKey,requestHash},{now}).catch(translateIdempotency);
  if(acquired.kind==='REPLAY') return {...acquired.response,replayed:true};
  try{
    await command.afterClaimed?.();
    const source=await database.prepare(`SELECT formal_order_id,status,version,business_closed_at,archive_due_at,
      review_state,buyer_refund_state,seller_principal_state,seller_service_fee_state,
      closed_by_staff_id,close_reason FROM order_archive_closures WHERE formal_order_id=?`)
      .bind(formalOrderId).first<ClosureRow>();
    if(!source) throw new ColdArchiveCommandError('NOT_FOUND',404);
    if(source.version!==expectedVersion) throw new ColdArchiveCommandError('VERSION_CONFLICT',409);
    if(source.status!=='CLOSED') throw new ColdArchiveCommandError('STATE_CONFLICT',409);
    if(now<source.business_closed_at)throw new ColdArchiveCommandError('VALIDATION_ERROR',400);
    const permanentlyArchived=await database.prepare(`SELECT 1 AS found
      FROM file_drive_archives archive JOIN file_entity_links link ON link.file_object_id=archive.file_object_id
      WHERE archive.status='DRIVE_ARCHIVED' AND (
        (link.entity_type='ORDER' AND (link.entity_id=? OR EXISTS(SELECT 1 FROM formal_orders formal_order
          WHERE formal_order.id=? AND formal_order.order_evidence_version_id=link.entity_id)))
        OR (link.entity_type='REVIEW' AND EXISTS (SELECT 1 FROM review_cases review
          WHERE review.id=link.entity_id AND review.formal_order_id=?))
        OR (link.entity_type='BUYER_REFUND' AND EXISTS (SELECT 1 FROM buyer_refund_obligations refund
          WHERE refund.id=link.entity_id AND refund.formal_order_id=?))
        OR (link.entity_type='SELLER_SETTLEMENT' AND EXISTS (
          SELECT 1 FROM seller_payment_allocations allocation JOIN seller_payables payable ON payable.id=allocation.payable_id
          WHERE allocation.payment_id=link.entity_id AND payable.formal_order_id=?))
      ) LIMIT 1`).bind(formalOrderId,formalOrderId,formalOrderId,formalOrderId,formalOrderId).first<{found:number}>();
    if(permanentlyArchived)throw new ColdArchiveCommandError('STATE_CONFLICT',409);
    const response:OrderArchiveClosureResultDto={formal_order_id:formalOrderId,status:'REOPENED',version:expectedVersion+1,
      business_closed_at:source.business_closed_at,archive_due_at:source.archive_due_at,review_state:source.review_state,
      buyer_refund_state:source.buyer_refund_state,seller_principal_state:source.seller_principal_state,
      seller_service_fee_state:source.seller_service_fee_state,replayed:false};
    const mutation=database.prepare(`UPDATE order_archive_closures SET status='REOPENED',reopened_at=?,
      reopened_by_staff_id=?,reopen_reason=?,reopen_idempotency_key=?,version=version+1,updated_at=MAX(?,updated_at+1)
      WHERE formal_order_id=? AND status='CLOSED' AND version=? AND NOT EXISTS (
        SELECT 1 FROM file_drive_archives archive JOIN file_entity_links link ON link.file_object_id=archive.file_object_id
        WHERE archive.status='DRIVE_ARCHIVED' AND (
          (link.entity_type='ORDER' AND (link.entity_id=? OR EXISTS(SELECT 1 FROM formal_orders formal_order
            WHERE formal_order.id=? AND formal_order.order_evidence_version_id=link.entity_id)))
          OR (link.entity_type='REVIEW' AND EXISTS (SELECT 1 FROM review_cases review
            WHERE review.id=link.entity_id AND review.formal_order_id=?))
          OR (link.entity_type='BUYER_REFUND' AND EXISTS (SELECT 1 FROM buyer_refund_obligations refund
            WHERE refund.id=link.entity_id AND refund.formal_order_id=?))
          OR (link.entity_type='SELLER_SETTLEMENT' AND EXISTS (
            SELECT 1 FROM seller_payment_allocations allocation JOIN seller_payables payable ON payable.id=allocation.payable_id
            WHERE allocation.payment_id=link.entity_id AND payable.formal_order_id=?))
        ))`).bind(now,command.actor.staffId,reason,acquired.claim.idempotencyKey,now,formalOrderId,expectedVersion,
          formalOrderId,formalOrderId,formalOrderId,formalOrderId,formalOrderId);
    await database.batch(completion(database,{mutation,response,existing:source,reason,command,claim:acquired.claim,now}));
    return response;
  }catch(error){const normalized=normalize(error);await markIdempotencyFailed(database,acquired.claim,normalized.code,now).catch(()=>false);throw normalized;}
}

function completion(database:SqlDatabase,input:{mutation:SqlStatement;response:OrderArchiveClosureResultDto;existing:ClosureRow|null;
  reason:string;command:{actor:AssignmentStaffAuthorization;idempotencyKey:string;requestId?:string|null};
  claim:Parameters<typeof completeIdempotencyStatement>[1];now:number}):SqlStatement[]{
  return [input.mutation,changedOnce(database),createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType:'ORDER_ARCHIVE_CLOSURE',
    aggregateId:input.response.formal_order_id,eventType:input.response.status==='CLOSED'?'ORDER_ARCHIVE_CLOSED':'ORDER_ARCHIVE_REOPENED',
    actor:{type:'STAFF',id:input.command.actor.staffId,roles:[...input.command.actor.roles]},requestId:input.command.requestId??null,
    idempotencyKey:input.claim.idempotencyKey,previousState:input.existing,nextState:input.response,reason:input.reason,createdAt:input.now}),
    completeIdempotencyStatement(database,input.claim,input.response,{resultReferences:{formal_order_id:input.response.formal_order_id,
      closure_version:input.response.version},now:input.now}),assertClosure(database,input.response),
    assertIdempotencyCompletionStatement(database,input.claim)];
}
function assertClosure(database:SqlDatabase,response:OrderArchiveClosureResultDto):SqlStatement{return database.prepare(`
  INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN EXISTS(
    SELECT 1 FROM order_archive_closures WHERE formal_order_id=? AND status=? AND version=?
      AND business_closed_at=? AND archive_due_at=?
  ) THEN 1 ELSE 0 END`).bind(response.formal_order_id,response.status,response.version,response.business_closed_at,response.archive_due_at);}
function changedOnce(database:SqlDatabase):SqlStatement{return database.prepare(`INSERT INTO transaction_assertions(assertion_value)
  SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END`);}
async function reviewCompletion(database:SqlDatabase,orderId:string,notApplicable:boolean,baseline:number):Promise<ComponentCompletion>{
  const row=await database.prepare(`SELECT status,decided_at FROM review_cases WHERE formal_order_id=?`).bind(orderId)
    .first<{status:string;decided_at:number|null}>();
  if(!row)return explicitNotApplicable(notApplicable,baseline);if(notApplicable||row.status!=='APPROVED'||row.decided_at===null)incomplete();
  return {state:'COMPLETED',completedAt:row.decided_at};
}
async function refundCompletion(database:SqlDatabase,orderId:string,notApplicable:boolean,baseline:number):Promise<ComponentCompletion>{
  const row=await database.prepare(`SELECT balance.status,COALESCE((SELECT MAX(entry.created_at) FROM buyer_refund_payment_entries entry
    WHERE entry.obligation_id=balance.obligation_id),balance.created_at) AS completed_at
    FROM buyer_refund_ledger_balances balance WHERE balance.formal_order_id=?`).bind(orderId).first<{status:string;completed_at:number}>();
  if(!row)return explicitNotApplicable(notApplicable,baseline);if(notApplicable||row.status!=='PAID')incomplete();return {state:'COMPLETED',completedAt:row.completed_at};
}
async function payableCompletion(database:SqlDatabase,orderId:string,type:'SELLER_PRINCIPAL'|'SELLER_SERVICE_FEE',notApplicable:boolean,baseline:number):Promise<ComponentCompletion>{
  const row=await database.prepare(`SELECT balance.derived_status,COALESCE((SELECT MAX(allocation.created_at)
    FROM seller_payment_allocations allocation WHERE allocation.payable_id=balance.payable_id),balance.created_at) AS completed_at
    FROM seller_payable_balances balance WHERE balance.formal_order_id=? AND balance.payable_type=?`).bind(orderId,type)
    .first<{derived_status:string;completed_at:number}>();
  if(!row)return explicitNotApplicable(notApplicable,baseline);if(notApplicable||row.derived_status!=='PAID')incomplete();return {state:'COMPLETED',completedAt:row.completed_at};
}
function explicitNotApplicable(explicit:boolean,baseline:number):ComponentCompletion{if(!explicit)incomplete();return {state:'NOT_APPLICABLE',completedAt:baseline};}
function incomplete():never{throw new ColdArchiveCommandError('STATE_CONFLICT',409);}
function requireOwner(actor:AssignmentStaffAuthorization):void{if(actor.staffStatus!=='ACTIVE'||!actor.roles.has('owner')||!actor.permissions.has('SCHEDULED_OPERATIONS_RUN'))throw new ColdArchiveCommandError('FORBIDDEN',403);}
function components(values:readonly ArchiveComponent[]):ArchiveComponent[]{if(!Array.isArray(values)||new Set(values).size!==values.length||values.some((value)=>!ARCHIVE_COMPONENTS.includes(value)))throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return [...values].sort() as ArchiveComponent[];}
function safeId(value:string):string{if(typeof value!=='string'||value.length<1||value.length>200||/[\u0000-\u001f\u007f]/u.test(value))throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return value;}
function safeReason(value:string):string{const normalized=typeof value==='string'?value.trim():'';if(normalized.length<1||normalized.length>2000||/[\u0000-\u001f\u007f]/u.test(normalized))throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return normalized;}
function version(value:number,allowZero:boolean):number{if(!Number.isSafeInteger(value)||value<(allowZero?0:1))throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return value;}
function safeNow(value:number):number{if(!Number.isSafeInteger(value)||value<0)throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return value;}
function translateIdempotency(error:unknown):never{throw normalize(error);}
function normalize(error:unknown):ColdArchiveCommandError{if(error instanceof ColdArchiveCommandError)return error;if(error instanceof IdempotencyError){if(error.code==='IDEMPOTENCY_CONFLICT')return new ColdArchiveCommandError('IDEMPOTENCY_CONFLICT',409);if(error.code==='REQUEST_IN_PROGRESS')return new ColdArchiveCommandError('REQUEST_IN_PROGRESS',409);if(error.code==='VALIDATION_ERROR')return new ColdArchiveCommandError('VALIDATION_ERROR',400);}return new ColdArchiveCommandError('DEPENDENCY_UNAVAILABLE',503);}
