import { apiFailure,apiSuccess,type SqlDatabase } from '@ygb/contracts';
import { canonicalMarketplaceCode,normalizeWechatId } from '@ygb/domain';
import type { Context,Hono } from 'hono';
import { createAuditEventStatement } from '../foundation/audit';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

class IdentifierChangeError extends Error{constructor(public code:'VALIDATION_ERROR'|'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'DEPENDENCY_UNAVAILABLE',public status:400|403|404|409|503){super(code)}}
interface Target{subjectId:string;accountId:string;display:string;normalized:string;claimId:string;claimVersion:number;identitySubjectType:string;marketplaceCode:string}

export function registerCustomerLoginIdentifierChangeRoutes(app:Hono<any>):void{
  app.post('/api/staff/customer-onboarding/:customerType/:subjectId/change-wechat',customerAuthOriginGuard(),wrap(changeWechat));
}

async function changeWechat(context:Context<any>){
  const actor=owner(context);const customerType=String(context.req.param('customerType')??'').toUpperCase();
  if(customerType!=='BUYER'&&customerType!=='SELLER')validation();
  const subjectId=clean(context.req.param('subjectId')??'');const body=await bodyExact(context,['new_wechat_id','verification_note']);
  if(typeof body['new_wechat_id']!=='string'||typeof body['verification_note']!=='string')validation();
  const note=body['verification_note'].normalize('NFKC').trim();if(note.length<8||note.length>2000)validation();
  const next=normalizeWechatId(body['new_wechat_id']);const target=await resolveTarget(context.env.DB,customerType,subjectId);
  if(next.normalized===target.normalized)throw new IdentifierChangeError('CONFLICT',409);
  const occupied=await context.env.DB.prepare(`SELECT identity_subject_id,status FROM wechat_identity_claims
    WHERE normalized_wechat=? AND status IN('ACTIVE','RESERVED') LIMIT 2`).bind(next.normalized).all<{identity_subject_id:string;status:string}>();
  if(occupied.results.length>0&&occupied.results.some((row)=>row.identity_subject_id!==target.subjectId))throw new IdentifierChangeError('CONFLICT',409);
  if(occupied.results.some((row)=>row.identity_subject_id===target.subjectId))throw new IdentifierChangeError('CONFLICT',409);
  const now=Date.now();const eventId=crypto.randomUUID(),newClaimId=crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE wechat_identity_claims
      SET status='RELEASED',version=version+1,released_at=?,updated_at=?
      WHERE id=? AND identity_subject_id=? AND status='ACTIVE' AND version=?`)
      .bind(now,now,target.claimId,target.subjectId,target.claimVersion),
    context.env.DB.prepare(`INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END`),
    context.env.DB.prepare(`INSERT INTO wechat_identity_claims(
      id,identity_subject_id,display_wechat,normalized_wechat,status,version,acquired_at,reserved_at,released_at,
      created_at,updated_at,identity_subject_type
    ) VALUES(?,?,?,?,'ACTIVE',1,?,NULL,NULL,?,?,?)`)
      .bind(newClaimId,target.subjectId,next.display,next.normalized,now,now,now,target.identitySubjectType),
    context.env.DB.prepare(`UPDATE customer_login_accounts
      SET login_identifier_display=?,login_identifier_normalized=?,session_version=session_version+1,version=version+1,updated_at=?
      WHERE id=? AND identity_subject_id=? AND status='ACTIVE'`)
      .bind(next.display,next.normalized,now,target.accountId,target.subjectId),
    context.env.DB.prepare(`INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END`),
    context.env.DB.prepare(`INSERT INTO customer_login_identifier_change_events(
      id,account_id,identity_subject_id,previous_wechat_normalized,next_wechat_normalized,
      previous_wechat_display,next_wechat_display,verification_note,actor_staff_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(eventId,target.accountId,target.subjectId,target.normalized,next.normalized,target.display,next.display,note,actor.staffId,now),
    createAuditEventStatement(context.env.DB,{id:crypto.randomUUID(),aggregateType:'CUSTOMER_LOGIN_ACCOUNT',aggregateId:target.accountId,
      eventType:'CUSTOMER_LOGIN_IDENTIFIER_CHANGED',actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:requestIdFromContext(context),
      previousState:{login_identifier:target.display,marketplace_code:target.marketplaceCode},nextState:{login_identifier:next.display,marketplace_code:target.marketplaceCode,all_sessions_revoked:true},reason:note,createdAt:now}),
  ]);
  return context.json(apiSuccess({changed:true,customer_type:customerType,subject_id:subjectId,marketplace_code:target.marketplaceCode,new_wechat_id:next.display,all_previous_sessions_revoked:true,changed_at:now},requestIdFromContext(context)));
}

async function resolveTarget(database:SqlDatabase,type:'BUYER'|'SELLER',businessId:string):Promise<Target>{
  if(type==='BUYER'){
    const row=await database.prepare(`SELECT buyer.identity_subject_id AS subject_id,account.id AS account_id,
        claim.id AS claim_id,claim.display_wechat,claim.normalized_wechat,claim.version AS claim_version,
        claim.identity_subject_type,COALESCE(assignment.marketplace_code,'AMAZON_JP') AS marketplace_code
      FROM buyer_customers buyer
      JOIN customer_login_accounts account ON account.identity_subject_id=buyer.identity_subject_id AND account.status='ACTIVE'
      JOIN wechat_identity_claims claim ON claim.identity_subject_id=buyer.identity_subject_id AND claim.status='ACTIVE'
      LEFT JOIN buyer_marketplace_assignments assignment ON assignment.buyer_customer_id=buyer.id
      WHERE buyer.id=? AND buyer.access_status='ACTIVE' LIMIT 2`).bind(businessId).all<any>();
    if(row.results.length!==1)throw new IdentifierChangeError(row.results.length===0?'NOT_FOUND':'CONFLICT',row.results.length===0?404:409);
    return project(row.results[0]);
  }
  const rows=await database.prepare(`SELECT member.identity_subject_id AS subject_id,account.id AS account_id,
      claim.id AS claim_id,claim.display_wechat,claim.normalized_wechat,claim.version AS claim_version,
      claim.identity_subject_type,organization.marketplace_code
    FROM seller_organizations organization
    JOIN seller_organization_members member ON member.organization_id=organization.id AND member.primary_owner=1 AND member.status='ACTIVE'
    JOIN customer_login_accounts account ON account.identity_subject_id=member.identity_subject_id AND account.status='ACTIVE'
    JOIN wechat_identity_claims claim ON claim.identity_subject_id=member.identity_subject_id AND claim.status='ACTIVE'
    WHERE organization.id=? AND organization.status='ACTIVE' LIMIT 2`).bind(businessId).all<any>();
  if(rows.results.length!==1)throw new IdentifierChangeError(rows.results.length===0?'NOT_FOUND':'CONFLICT',rows.results.length===0?404:409);
  const value=rows.results[0];
  return{...project(value),marketplaceCode:canonicalMarketplaceCode(String(value.marketplace_code))};
}
function project(row:any):Target{return{subjectId:String(row.subject_id),accountId:String(row.account_id),claimId:String(row.claim_id),display:String(row.display_wechat),normalized:String(row.normalized_wechat),claimVersion:Number(row.claim_version),identitySubjectType:String(row.identity_subject_type),marketplaceCode:canonicalMarketplaceCode(String(row.marketplace_code))};}
function owner(context:Context<any>){const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;if(!actor||actor.staffStatus!=='ACTIVE'||!actor.roles.has('owner'))throw new IdentifierChangeError('FORBIDDEN',403);return actor;}
async function bodyExact(context:Context<any>,keys:string[]){let value:unknown;try{value=await context.req.json();}catch{validation();}if(!value||typeof value!=='object'||Array.isArray(value))validation();const record=value as Record<string,unknown>;if(Object.keys(record).length!==keys.length||keys.some((key)=>!Object.hasOwn(record,key)))validation();return record;}
function clean(value:string){const v=value.normalize('NFKC').trim();if(v.length<1||v.length>200||/[\u0000-\u001f\u007f]/u.test(v))validation();return v;}
function validation():never{throw new IdentifierChangeError('VALIDATION_ERROR',400)}
function wrap(handler:(context:Context<any>)=>Promise<Response>){return async(context:Context<any>)=>{try{return await handler(context);}catch(error){const e=error instanceof IdentifierChangeError?error:new IdentifierChangeError('DEPENDENCY_UNAVAILABLE',503);return context.json(apiFailure(e.code,e.code==='FORBIDDEN'?'只有总管理员可以更换客户登录微信':e.code==='NOT_FOUND'?'没有找到已开通的网站账号':e.code==='CONFLICT'?'新微信已被占用、客户身份不唯一或当前状态不允许换绑':e.code==='VALIDATION_ERROR'?'提交内容不正确':'账号服务暂时不可用',requestIdFromContext(context)),e.status);}};}
