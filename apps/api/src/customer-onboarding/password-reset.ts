import type { SqlDatabase } from '@ygb/contracts';
import {
  deriveOneTimeToken,
  hashCanonicalJson,
  hashOneTimeToken,
} from '@ygb/domain';
import { registrationPrivacyHash } from '../buyer-self-registration/privacy-hash';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import { CustomerSecurityError } from '../customer-security/errors';

const PASSWORD_RESET_TTL_MS=30*60*1000;
type CustomerType='BUYER'|'SELLER';

interface AccountTarget{
  account_id:string;
  identity_subject_id:string;
  marketplace_code:string;
  login_identifier_normalized:string;
}

export async function issueCustomerPasswordResetForSubject(
  database:SqlDatabase,
  actor:AssignmentStaffAuthorization,
  input:{customerType:CustomerType;subjectId:string;verificationNote:string},
  command:{idempotencyKey:string;requestId:string;tokenSecret:string;now?:number},
){
  requireDuty(actor,input.customerType);
  const verificationNote=input.verificationNote.normalize('NFKC').trim();
  if(verificationNote.length<8||verificationNote.length>1000)throw new CustomerSecurityError('VALIDATION_ERROR',400);
  const target=await resolveAccountTarget(database,input.customerType,clean(input.subjectId));
  await requireMarket(database,actor,target.marketplace_code);
  const personas=await database.prepare(`SELECT persona_type FROM customer_account_personas
    WHERE account_id=? ORDER BY persona_type`).bind(target.account_id).all<{persona_type:'BUYER'|'SELLER_MEMBER'}>();
  if(personas.results.length<1)throw new CustomerSecurityError('CONFLICT',409);
  const now=command.now??Date.now();
  const requestHash=await hashCanonicalJson({
    action:'ISSUE_SCOPED_CUSTOMER_PASSWORD_RESET',customer_type:input.customerType,
    subject_id:input.subjectId,account_id:target.account_id,verification_note:verificationNote,
  });
  const token=await deriveOneTimeToken(command.tokenSecret,'PASSWORD_RESET',actor.staffId,command.idempotencyKey,requestHash);
  const tokenHash=await hashOneTimeToken(token);
  const acquired=await acquireIdempotency<{reset_id:string;expires_at:number;affected_personas:readonly string[]}>(database,{
    actorType:'STAFF',actorId:actor.staffId,action:'ISSUE_SCOPED_CUSTOMER_PASSWORD_RESET',
    targetType:'CUSTOMER_LOGIN_ACCOUNT',targetId:target.account_id,idempotencyKey:command.idempotencyKey,requestHash,
  },{now});
  if(acquired.kind==='REPLAY')return{...acquired.response,reset_token:token,replayed:true};
  const resetId=crypto.randomUUID();const expiresAt=now+PASSWORD_RESET_TTL_MS;
  const affectedPersonas=Object.freeze(personas.results.map((row)=>row.persona_type));
  const safe={reset_id:resetId,expires_at:expiresAt,affected_personas:affectedPersonas};
  const wechatHash=await registrationPrivacyHash(command.tokenSecret,'WECHAT_ID',target.login_identifier_normalized);
  try{
    await database.batch([
      database.prepare(`INSERT INTO customer_password_reset_events(
        id,reset_token_id,account_id,event_type,outcome,actor_type,actor_id,reason_code,
        request_id,idempotency_key,metadata_json,created_at
      ) SELECT ?,id,account_id,'REVOKED','SUCCESS','STAFF',?,'SUPERSEDED',?,?,?,?
        FROM customer_password_reset_tokens WHERE account_id=? AND status='ACTIVE'`)
        .bind(crypto.randomUUID(),actor.staffId,command.requestId,command.idempotencyKey,
          JSON.stringify({customer_type:input.customerType,subject_id:input.subjectId}),now,target.account_id),
      database.prepare(`UPDATE customer_password_reset_tokens
        SET status='REVOKED',version=version+1,revoked_at=?,revoked_by_staff_id=?,updated_at=?
        WHERE account_id=? AND status='ACTIVE'`).bind(now,actor.staffId,now,target.account_id),
      database.prepare(`INSERT INTO customer_password_reset_tokens(
        id,token_hash,account_id,identity_subject_id,wechat_hash,issued_by_staff_id,verification_note,
        status,version,issued_at,expires_at,consumed_at,revoked_at,revoked_by_staff_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,'ACTIVE',1,?,?,NULL,NULL,NULL,?,?)`).bind(
        resetId,tokenHash,target.account_id,target.identity_subject_id,wechatHash,actor.staffId,
        verificationNote,now,expiresAt,now,now),
      database.prepare(`INSERT INTO customer_password_reset_events(
        id,reset_token_id,account_id,event_type,outcome,actor_type,actor_id,reason_code,
        request_id,idempotency_key,metadata_json,created_at
      ) VALUES(?,?,?,'ISSUED','SUCCESS','STAFF',?,NULL,?,?,?,?)`).bind(
        crypto.randomUUID(),resetId,target.account_id,actor.staffId,command.requestId,command.idempotencyKey,
        JSON.stringify({customer_type:input.customerType,subject_id:input.subjectId,affected_personas:affectedPersonas}),now),
      createAuditEventStatement(database,{
        id:crypto.randomUUID(),aggregateType:'CUSTOMER_PASSWORD_RESET',aggregateId:resetId,
        eventType:'SCOPED_CUSTOMER_PASSWORD_RESET_ISSUED',actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},
        requestId:command.requestId,idempotencyKey:command.idempotencyKey,
        nextState:{status:'ACTIVE',account_id:target.account_id,customer_type:input.customerType,
          subject_id:input.subjectId,marketplace_code:target.marketplace_code,affected_personas:affectedPersonas,expires_at:expiresAt},
        createdAt:now,
      }),
      completeIdempotencyStatement(database,acquired.claim,safe,{resultReferences:{reset_id:resetId,account_id:target.account_id},now}),
      assertIdempotencyCompletionStatement(database,acquired.claim),
    ]);
  }catch(error){await markIdempotencyFailed(database,acquired.claim,'SCOPED_RESET_ISSUE_FAILED',now);throw error;}
  return{...safe,reset_token:token,replayed:false};
}

async function resolveAccountTarget(database:SqlDatabase,type:CustomerType,subjectId:string):Promise<AccountTarget>{
  if(type==='BUYER'){
    const row=await database.prepare(`SELECT account.id AS account_id,account.identity_subject_id,
        COALESCE(assignment.marketplace_code,'AMAZON_JP') AS marketplace_code,
        account.login_identifier_normalized
      FROM buyer_customers buyer
      JOIN customer_account_personas persona ON persona.buyer_customer_id=buyer.id AND persona.persona_type='BUYER'
      JOIN customer_login_accounts account ON account.id=persona.account_id AND account.status='ACTIVE'
      LEFT JOIN buyer_marketplace_assignments assignment ON assignment.buyer_customer_id=buyer.id
      WHERE buyer.id=? AND buyer.access_status='ACTIVE'`).bind(subjectId).first<AccountTarget>();
    if(!row)throw new CustomerSecurityError('NOT_FOUND',404);return row;
  }
  const rows=await database.prepare(`SELECT account.id AS account_id,account.identity_subject_id,
      CASE organization.marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE organization.marketplace_code END AS marketplace_code,
      account.login_identifier_normalized
    FROM seller_organizations organization
    JOIN seller_organization_members member ON member.organization_id=organization.id
      AND member.status='ACTIVE' AND member.primary_owner=1
    JOIN customer_account_personas persona ON persona.seller_member_id=member.id AND persona.persona_type='SELLER_MEMBER'
    JOIN customer_login_accounts account ON account.id=persona.account_id AND account.status='ACTIVE'
    WHERE organization.id=? AND organization.status='ACTIVE'
    ORDER BY member.member_number,member.id`).bind(subjectId).all<AccountTarget>();
  if(rows.results.length!==1)throw new CustomerSecurityError(rows.results.length===0?'NOT_FOUND':'CONFLICT',rows.results.length===0?404:409);
  return rows.results[0]!;
}
function requireDuty(actor:AssignmentStaffAuthorization,type:CustomerType){
  const allowed=actor.roles.has('owner')||(type==='BUYER'&&actor.roles.has('pre_sales'))||(type==='SELLER'&&actor.roles.has('seller_ops'));
  if(!allowed)throw new CustomerSecurityError('FORBIDDEN',403);
}
async function requireMarket(database:SqlDatabase,actor:AssignmentStaffAuthorization,market:string){
  if(actor.roles.has('owner'))return;const markets=await resolveStaffMarketplaceCodes(database,actor);
  if(!markets.includes(market))throw new CustomerSecurityError('FORBIDDEN',403);
}
function clean(value:string){const result=value.normalize('NFKC').trim();if(result.length<1||result.length>200||/[\u0000-\u001f\u007f]/u.test(result))throw new CustomerSecurityError('VALIDATION_ERROR',400);return result;}
