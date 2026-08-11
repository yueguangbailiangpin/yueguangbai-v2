import type { SqlDatabase } from '@ygb/contracts';
import { normalizeWechatId } from '@ygb/domain';
import { hashNormalizedWechat } from '../acquisition/privacy';
import { createAuditEventStatement } from '../foundation/audit';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';

export class IdentityResolutionError extends Error{
  constructor(public readonly code:'VALIDATION_ERROR'|'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'DEPENDENCY_UNAVAILABLE',public readonly status:400|403|404|409|503){super(code);}
}

type CustomerType='BUYER'|'SELLER';

export async function reportIdentityResolutionCase(
  database:SqlDatabase,
  actor:AssignmentStaffAuthorization,
  secret:string,
  input:{customerType:CustomerType;marketplaceCode:string;wechatId:string;reasonCode:'AMBIGUOUS_HISTORY'|'IDENTITY_CONFLICT'|'LEGACY_MISSING_IDENTITY'|'STAFF_REPORTED';note:string|null},
){
  requireDuty(actor,input.customerType);await requireMarket(database,actor,input.marketplaceCode);
  const wechat=normalizeWechatId(input.wechatId);const identityHash=await hashNormalizedWechat(wechat.normalized,secret);
  const existing=await database.prepare(`SELECT id,status FROM customer_identity_resolution_cases
    WHERE identity_hash=? AND customer_type=? AND marketplace_code=? AND status='OPEN' LIMIT 1`)
    .bind(identityHash,input.customerType,input.marketplaceCode).first<{id:string;status:string}>();
  if(existing)return readCase(database,existing.id);
  const note=optional(input.note,1000);const now=Date.now();const id=crypto.randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO customer_identity_resolution_cases(
      id,identity_hash,identity_masked,customer_type,marketplace_code,reason_code,staff_note,status,
      reported_by_staff_id,resolved_subject_id,resolution_note,resolved_by_staff_id,created_at,resolved_at
    ) VALUES(?,?,?,?,?,?,?,'OPEN',?,NULL,NULL,NULL,?,NULL)`).bind(
      id,identityHash,mask(wechat.display),input.customerType,input.marketplaceCode,input.reasonCode,note,actor.staffId,now),
    database.prepare(`INSERT INTO customer_identity_resolution_events(id,case_id,event_type,actor_staff_id,subject_id,reason,created_at)
      VALUES(?,?,'REPORTED',?,NULL,?,?)`).bind(crypto.randomUUID(),id,actor.staffId,note,now),
    createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType:'CUSTOMER_IDENTITY_RESOLUTION',aggregateId:id,
      eventType:'CUSTOMER_IDENTITY_CONFLICT_REPORTED',actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:null,idempotencyKey:null,
      nextState:{customer_type:input.customerType,marketplace_code:input.marketplaceCode,reason_code:input.reasonCode,status:'OPEN'},reason:note,createdAt:now}),
  ]);
  return readCase(database,id);
}

export async function listIdentityResolutionCases(database:SqlDatabase,actor:AssignmentStaffAuthorization){
  requireOwner(actor);
  const rows=await database.prepare(`SELECT id,identity_masked,customer_type,marketplace_code,reason_code,staff_note,status,
      reported_by_staff_id,resolved_subject_id,resolution_note,resolved_by_staff_id,created_at,resolved_at
    FROM customer_identity_resolution_cases WHERE status='OPEN'
    ORDER BY created_at,id LIMIT 200`).all<any>();
  return Object.freeze(rows.results.map(project));
}

export async function searchIdentityResolutionCandidates(
  database:SqlDatabase,actor:AssignmentStaffAuthorization,input:{customerType:CustomerType;query:string},
){
  requireOwner(actor);const query=input.query.normalize('NFKC').trim();if(query.length<2||query.length>120)validation();
  const like=`%${query.replaceAll('%','').replaceAll('_','')}%`;
  if(input.customerType==='BUYER'){
    const rows=await database.prepare(`SELECT buyer.id AS subject_id,buyer.display_name,
        COALESCE(assignment.marketplace_code,'AMAZON_JP') AS marketplace_code,buyer.buyer_customer_no AS reference_code,
        (SELECT COUNT(*) FROM formal_orders formal_order WHERE formal_order.buyer_customer_id=buyer.id) AS order_count
      FROM buyer_customers buyer
      LEFT JOIN buyer_marketplace_assignments assignment ON assignment.buyer_customer_id=buyer.id
      WHERE buyer.id=? OR buyer.display_name LIKE ? OR COALESCE(buyer.buyer_customer_no,'') LIKE ?
      ORDER BY buyer.updated_at DESC,buyer.id LIMIT 30`).bind(query,like,like).all<any>();
    return Object.freeze(rows.results.map((row)=>Object.freeze({customer_type:'BUYER' as const,subject_id:String(row.subject_id),
      display_name:String(row.display_name),marketplace_code:String(row.marketplace_code),reference_code:row.reference_code===null?null:String(row.reference_code),order_count:Number(row.order_count)})));
  }
  const rows=await database.prepare(`SELECT DISTINCT organization.id AS subject_id,organization.organization_name AS display_name,
      CASE organization.marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE organization.marketplace_code END AS marketplace_code,
      organization.seller_code AS reference_code,
      (SELECT COUNT(*) FROM formal_orders formal_order WHERE formal_order.seller_organization_id=organization.id) AS order_count
    FROM seller_organizations organization
    LEFT JOIN seller_stores store ON store.organization_id=organization.id
    WHERE organization.id=? OR organization.organization_name LIKE ? OR organization.seller_code LIKE ? OR store.display_name LIKE ?
    ORDER BY organization.updated_at DESC,organization.id LIMIT 30`).bind(query,like,like,like).all<any>();
  return Object.freeze(rows.results.map((row)=>Object.freeze({customer_type:'SELLER' as const,subject_id:String(row.subject_id),
    display_name:String(row.display_name),marketplace_code:String(row.marketplace_code),reference_code:String(row.reference_code),order_count:Number(row.order_count)})));
}

export async function resolveIdentityResolutionCase(
  database:SqlDatabase,actor:AssignmentStaffAuthorization,input:{caseId:string;subjectId:string;reason:string},
){
  requireOwner(actor);const reason=required(input.reason,1000);const current=await readCase(database,input.caseId);
  if(current.status!=='OPEN')conflict();
  await assertSubject(database,current.customer_type,current.marketplace_code,input.subjectId);
  const row=await database.prepare(`SELECT identity_hash FROM customer_identity_resolution_cases WHERE id=?`).bind(input.caseId).first<{identity_hash:string}>();
  if(!row)notFound();const now=Date.now();const bindingId=crypto.randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO customer_identity_manual_bindings(
      id,identity_hash,customer_type,marketplace_code,subject_id,status,reason,resolved_by_staff_id,created_at,revoked_at
    ) VALUES(?,?,?,?,?,'ACTIVE',?,?,?,NULL)`).bind(
      bindingId,row.identity_hash,current.customer_type,current.marketplace_code,input.subjectId,reason,actor.staffId,now),
    database.prepare(`UPDATE customer_identity_resolution_cases SET status='RESOLVED',resolved_subject_id=?,resolution_note=?,
      resolved_by_staff_id=?,resolved_at=? WHERE id=? AND status='OPEN'`).bind(input.subjectId,reason,actor.staffId,now,input.caseId),
    database.prepare(`INSERT INTO customer_identity_resolution_events(id,case_id,event_type,actor_staff_id,subject_id,reason,created_at)
      VALUES(?,?,'RESOLVED',?,?,?,?)`).bind(crypto.randomUUID(),input.caseId,actor.staffId,input.subjectId,reason,now),
    createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType:'CUSTOMER_IDENTITY_RESOLUTION',aggregateId:input.caseId,
      eventType:'CUSTOMER_IDENTITY_CONFLICT_RESOLVED',actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:null,idempotencyKey:null,
      previousState:{status:'OPEN'},nextState:{status:'RESOLVED',subject_id:input.subjectId,binding_id:bindingId},reason,createdAt:now}),
  ]);
  return readCase(database,input.caseId);
}

export async function manualIdentityBinding(
  database:SqlDatabase,secret:string,input:{customerType:CustomerType;marketplaceCode:string;wechatId:string},
):Promise<string|null>{
  const normalized=normalizeWechatId(input.wechatId);const hash=await hashNormalizedWechat(normalized.normalized,secret);
  const row=await database.prepare(`SELECT subject_id FROM customer_identity_manual_bindings
    WHERE identity_hash=? AND customer_type=? AND marketplace_code=? AND status='ACTIVE' LIMIT 1`)
    .bind(hash,input.customerType,input.marketplaceCode).first<{subject_id:string}>();
  return row?.subject_id??null;
}

async function readCase(database:SqlDatabase,id:string):Promise<any>{
  const row=await database.prepare(`SELECT id,identity_masked,customer_type,marketplace_code,reason_code,staff_note,status,
    reported_by_staff_id,resolved_subject_id,resolution_note,resolved_by_staff_id,created_at,resolved_at
    FROM customer_identity_resolution_cases WHERE id=?`).bind(clean(id)).first<any>();
  if(!row)notFound();return project(row);
}
function project(row:any){return Object.freeze({id:String(row.id),identity_masked:String(row.identity_masked),customer_type:row.customer_type as CustomerType,
  marketplace_code:String(row.marketplace_code),reason_code:String(row.reason_code),staff_note:row.staff_note===null?null:String(row.staff_note),
  status:row.status as 'OPEN'|'RESOLVED'|'CANCELLED',reported_by_staff_id:String(row.reported_by_staff_id),
  resolved_subject_id:row.resolved_subject_id===null?null:String(row.resolved_subject_id),resolution_note:row.resolution_note===null?null:String(row.resolution_note),
  resolved_by_staff_id:row.resolved_by_staff_id===null?null:String(row.resolved_by_staff_id),created_at:Number(row.created_at),resolved_at:row.resolved_at===null?null:Number(row.resolved_at)});}
async function assertSubject(database:SqlDatabase,type:CustomerType,market:string,id:string){
  const row=type==='BUYER'
    ?await database.prepare(`SELECT buyer.id,COALESCE(assignment.marketplace_code,'AMAZON_JP') AS market FROM buyer_customers buyer
      LEFT JOIN buyer_marketplace_assignments assignment ON assignment.buyer_customer_id=buyer.id WHERE buyer.id=?`).bind(clean(id)).first<any>()
    :await database.prepare(`SELECT id,CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END AS market
      FROM seller_organizations WHERE id=?`).bind(clean(id)).first<any>();
  if(!row||String(row.market)!==market)throw new IdentityResolutionError('VALIDATION_ERROR',400);
}
function requireDuty(actor:AssignmentStaffAuthorization,type:CustomerType){const okay=actor.roles.has('owner')||(type==='BUYER'&&actor.roles.has('pre_sales'))||(type==='SELLER'&&actor.roles.has('seller_ops'));if(!okay)forbidden();}
async function requireMarket(database:SqlDatabase,actor:AssignmentStaffAuthorization,market:string){if(actor.roles.has('owner'))return;const markets=await resolveStaffMarketplaceCodes(database,actor);if(!markets.includes(market))forbidden();}
function requireOwner(actor:AssignmentStaffAuthorization){if(!actor.roles.has('owner')||!actor.permissions.has('STAFF_MANAGE'))forbidden();}
function optional(value:string|null,max:number){if(value===null)return null;const v=value.normalize('NFKC').trim();if(!v)return null;if(v.length>max)validation();return v;}
function required(value:string,max:number){const v=optional(value,max);if(v===null||v.length<3)validation();return v;}
function clean(value:string){const v=value.normalize('NFKC').trim();if(v.length<1||v.length>200||/[\u0000-\u001f\u007f]/u.test(v))validation();return v;}
function mask(value:string){const chars=[...value];if(chars.length<=4)return`${chars[0]??'*'}***`;return`${chars.slice(0,2).join('')}***${chars.slice(-2).join('')}`;}
function validation():never{throw new IdentityResolutionError('VALIDATION_ERROR',400)}
function forbidden():never{throw new IdentityResolutionError('FORBIDDEN',403)}
function notFound():never{throw new IdentityResolutionError('NOT_FOUND',404)}
function conflict():never{throw new IdentityResolutionError('CONFLICT',409)}
