import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import {
  deriveOneTimeToken,
  hashCanonicalJson,
  hashCustomerPassword,
  hashOneTimeToken,
  normalizeWechatId,
  validateCustomerPassword,
} from '@ygb/domain';
import { hashNormalizedWechat } from '../acquisition/privacy';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';

const INVITATION_TTL_MS=7*24*60*60*1000;
const SYSTEM_SELLER_CHANNEL='seller-channel-portal-onboarding';

export class SellerRegistrationError extends Error {
  constructor(
    public readonly code:'VALIDATION_ERROR'|'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'DEPENDENCY_UNAVAILABLE',
    public readonly status:400|403|404|409|503,
  ){super(code);}
}

type Kind='NEW_CUSTOMER'|'HISTORICAL_ACCOUNT_ONLY';
interface InvitationRow{
  id:string;token_hash:string;normalized_wechat:string;wechat_display:string;marketplace_code:string;
  acquisition_lead_id:string|null;seller_organization_id:string;seller_member_id:string;onboarding_kind:Kind;
  status:'ACTIVE'|'CONSUMED'|'REVOKED'|'EXPIRED';version:number;issued_at:number;expires_at:number;
}
interface OrgRow{id:string;seller_code:string;organization_name:string;marketplace_code:string;status:string;next_member_number:number}
interface MemberRow{id:string;identity_subject_id:string;display_name:string;member_number:number}

export async function issueSellerRegistrationInvitation(
  database:SqlDatabase,
  input:{leadId:string|null;sellerOrganizationId:string|null;wechatId:string;marketplaceCode:string},
  command:{actor:AssignmentStaffAuthorization;idempotencyKey:string;requestId:string;tokenSecret:string;now?:number},
){
  requireSellerDuty(command.actor);
  if(input.marketplaceCode!=='AMAZON_JP')throw new SellerRegistrationError('VALIDATION_ERROR',400);
  await requireStaffMarket(database,command.actor,input.marketplaceCode);
  const hasLead=input.leadId!==null&&input.leadId.trim()!=='';
  const hasOrg=input.sellerOrganizationId!==null&&input.sellerOrganizationId.trim()!=='';
  if(hasLead===hasOrg)throw new SellerRegistrationError('VALIDATION_ERROR',400);
  const now=command.now??Date.now();
  const wechat=normalizeWechatId(input.wechatId);
  const target=hasLead
    ?await ensureNewSellerTarget(database,input.leadId!,wechat.display,wechat.normalized,command.tokenSecret,now)
    :await ensureHistoricalSellerTarget(database,input.sellerOrganizationId!,wechat.display,wechat.normalized,now);
  const existingAccount=await database.prepare(`SELECT account.id FROM customer_login_accounts account
    JOIN seller_organization_members member ON member.identity_subject_id=account.identity_subject_id
    WHERE member.id=? AND account.status='ACTIVE' LIMIT 1`).bind(target.memberId).first<{id:string}>();
  if(existingAccount)throw new SellerRegistrationError('CONFLICT',409);
  await expireOldInvitation(database,target.organizationId,now);
  const requestHash=await hashCanonicalJson({action:'ISSUE_SELLER_REGISTRATION_INVITATION',kind:target.kind,
    seller_organization_id:target.organizationId,seller_member_id:target.memberId,normalized_wechat:wechat.normalized});
  const token=await deriveOneTimeToken(command.tokenSecret,'SELLER_INVITATION',command.actor.staffId,command.idempotencyKey,requestHash);
  const tokenHash=await hashOneTimeToken(token);
  const acquired=await acquireIdempotency<any>(database,{actorType:'STAFF',actorId:command.actor.staffId,
    action:'ISSUE_SELLER_REGISTRATION_INVITATION',targetType:'SELLER_ORGANIZATION',targetId:target.organizationId,
    idempotencyKey:command.idempotencyKey,requestHash},{now});
  if(acquired.kind==='REPLAY')return{...acquired.response,registration_token:token,replayed:true};
  const invitationId=crypto.randomUUID();const expiresAt=now+INVITATION_TTL_MS;
  const safe={invitation_id:invitationId,seller_organization_id:target.organizationId,seller_name:target.organizationName,
    marketplace_code:input.marketplaceCode,onboarding_kind:target.kind,wechat_id:wechat.display,version:1,expires_at:expiresAt};
  try{
    await database.batch([
      database.prepare(`INSERT INTO customer_seller_invitations(
        id,token_hash,normalized_wechat,wechat_display,marketplace_code,acquisition_lead_id,
        seller_organization_id,seller_member_id,onboarding_kind,issued_by_staff_id,status,version,
        issued_at,expires_at,consumed_at,consumed_by_account_id,revoked_at,revoked_by_staff_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,'ACTIVE',1,?,?,NULL,NULL,NULL,NULL,?,?)`).bind(
        invitationId,tokenHash,wechat.normalized,wechat.display,input.marketplaceCode,target.leadId,
        target.organizationId,target.memberId,target.kind,command.actor.staffId,now,expiresAt,now,now),
      event(database,invitationId,'ISSUED','STAFF',command.actor.staffId,command.requestId,command.idempotencyKey,now),
      createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType:'CUSTOMER_SELLER_INVITATION',aggregateId:invitationId,
        eventType:'SELLER_INVITATION_ISSUED',actor:{type:'STAFF',id:command.actor.staffId,roles:[...command.actor.roles]},
        requestId:command.requestId,idempotencyKey:command.idempotencyKey,nextState:{...safe,status:'ACTIVE'},createdAt:now}),
      completeIdempotencyStatement(database,acquired.claim,safe,{resultReferences:{invitation_id:invitationId,seller_organization_id:target.organizationId},now}),
      assertIdempotencyCompletionStatement(database,acquired.claim),
    ]);
  }catch(error){await markIdempotencyFailed(database,acquired.claim,'SELLER_INVITATION_ISSUE_FAILED',now);throw error;}
  return{...safe,registration_token:token,replayed:false};
}

export async function readSellerInvitationContext(database:SqlDatabase,token:string,now=Date.now()){
  const hash=await hashOneTimeToken(token);
  const row=await database.prepare(`SELECT invitation.id,invitation.wechat_display,invitation.marketplace_code,
      invitation.onboarding_kind,invitation.expires_at,organization.organization_name
    FROM customer_seller_invitations invitation
    JOIN seller_organizations organization ON organization.id=invitation.seller_organization_id
    WHERE invitation.token_hash=? AND invitation.status='ACTIVE' AND invitation.expires_at>?
      AND organization.status='ACTIVE'`).bind(hash,now).first<any>();
  if(!row)throw new SellerRegistrationError('CONFLICT',409);
  return{invitation_valid:true as const,seller_name:String(row.organization_name),marketplace_code:String(row.marketplace_code),
    wechat_hint:maskWechat(String(row.wechat_display)),onboarding_kind:row.onboarding_kind as Kind,expires_at:Number(row.expires_at)};
}

export async function completeSellerRegistration(
  database:SqlDatabase,
  input:{token:string;wechatId:string;password:string;passwordConfirmation:string},
  command:{requestId:string;idempotencyKey:string;now?:number},
){
  if(input.password!==input.passwordConfirmation)throw new SellerRegistrationError('VALIDATION_ERROR',400);
  try{validateCustomerPassword(input.password);}catch{throw new SellerRegistrationError('VALIDATION_ERROR',400);}
  const now=command.now??Date.now();const wechat=normalizeWechatId(input.wechatId);const tokenHash=await hashOneTimeToken(input.token);
  const invitation=await database.prepare(`SELECT id,token_hash,normalized_wechat,wechat_display,marketplace_code,
      acquisition_lead_id,seller_organization_id,seller_member_id,onboarding_kind,status,version,issued_at,expires_at
    FROM customer_seller_invitations WHERE token_hash=?`).bind(tokenHash).first<InvitationRow>();
  if(!invitation||invitation.status!=='ACTIVE'||invitation.expires_at<=now||invitation.normalized_wechat!==wechat.normalized)
    throw new SellerRegistrationError('CONFLICT',409);
  const member=await database.prepare(`SELECT id,identity_subject_id,display_name,member_number
    FROM seller_organization_members WHERE id=? AND organization_id=? AND status='ACTIVE'`).bind(
      invitation.seller_member_id,invitation.seller_organization_id).first<MemberRow>();
  if(!member)throw new SellerRegistrationError('CONFLICT',409);
  const existing=await database.prepare(`SELECT id,status FROM customer_login_accounts WHERE identity_subject_id=? LIMIT 1`)
    .bind(member.identity_subject_id).first<{id:string;status:string}>();
  if(existing)throw new SellerRegistrationError('CONFLICT',409);
  const requestHash=await hashCanonicalJson({action:'COMPLETE_SELLER_REGISTRATION',invitation_id:invitation.id,
    normalized_wechat:wechat.normalized,password_hash:await hashCanonicalJson(input.password)});
  const acquired=await acquireIdempotency<any>(database,{actorType:'CUSTOMER_INVITATION',actorId:invitation.id,
    action:'COMPLETE_SELLER_REGISTRATION',targetType:'SELLER_INVITATION',targetId:invitation.id,
    idempotencyKey:command.idempotencyKey,requestHash},{now});
  if(acquired.kind==='REPLAY')return{...acquired.response,replayed:true};
  const accountId=crypto.randomUUID();const credential=await hashCustomerPassword(input.password);
  const safe={account_id:accountId,identity_subject_id:member.identity_subject_id,seller_organization_id:invitation.seller_organization_id,
    session_version:1,onboarding_kind:invitation.onboarding_kind};
  try{
    await database.batch([
      database.prepare(`INSERT INTO customer_login_accounts(
        id,identity_subject_id,account_type,login_identifier_display,login_identifier_normalized,
        status,session_version,password_change_required,version,created_at,updated_at,activated_at,disabled_at
      ) VALUES(?,?,'SELLER_MEMBER',?,?,'ACTIVE',1,0,1,?,?,?,NULL)`).bind(
        accountId,member.identity_subject_id,wechat.display,wechat.normalized,now,now,now),
      database.prepare(`INSERT INTO customer_password_credentials(
        account_id,algorithm,iterations,salt_base64url,hash_base64url,password_version,created_at,updated_at
      ) VALUES(?,?,?,?,?,1,?,?)`).bind(accountId,credential.algorithm,credential.iterations,credential.saltBase64Url,credential.hashBase64Url,now,now),
      database.prepare(`UPDATE customer_seller_invitations SET status='CONSUMED',version=version+1,
        consumed_at=?,consumed_by_account_id=?,updated_at=?
        WHERE id=? AND status='ACTIVE' AND expires_at>? AND version=?`).bind(
        now,accountId,now,invitation.id,now,invitation.version),
      event(database,invitation.id,'CONSUMED','CUSTOMER',accountId,command.requestId,command.idempotencyKey,now),
      createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType:'SELLER_ORGANIZATION',aggregateId:invitation.seller_organization_id,
        eventType:'SELLER_PORTAL_ACCOUNT_ACTIVATED',actor:{type:'CUSTOMER_INVITATION',id:invitation.id,roles:[]},
        requestId:command.requestId,idempotencyKey:command.idempotencyKey,nextState:{account_id:accountId,
          seller_member_id:member.id,onboarding_kind:invitation.onboarding_kind},createdAt:now}),
      completeIdempotencyStatement(database,acquired.claim,safe,{resultReferences:{account_id:accountId,seller_organization_id:invitation.seller_organization_id},now}),
      assertIdempotencyCompletionStatement(database,acquired.claim),
      database.prepare(`INSERT INTO transaction_assertions(assertion_value)
        SELECT CASE WHEN EXISTS(SELECT 1 FROM customer_login_accounts WHERE id=? AND status='ACTIVE')
          AND EXISTS(SELECT 1 FROM seller_organization_members WHERE id=? AND organization_id=? AND status='ACTIVE')
        THEN 1 ELSE 0 END`).bind(accountId,member.id,invitation.seller_organization_id),
    ]);
  }catch(error){await markIdempotencyFailed(database,acquired.claim,'SELLER_REGISTRATION_FAILED',now);throw error;}
  return{...safe,replayed:false};
}

async function ensureNewSellerTarget(
  database:SqlDatabase,
  leadId:string,
  wechatDisplay:string,
  normalizedWechat:string,
  identitySecret:string,
  now:number,
){
  const lead=await database.prepare(`SELECT id,marketplace_code,display_name,status,identity_hash FROM acquisition_leads
    WHERE id=? AND lead_type='SELLER'`).bind(cleanId(leadId)).first<{
      id:string;marketplace_code:string;display_name:string|null;status:string;identity_hash:string|null;
    }>();
  if(!lead||lead.status!=='ACTIVE'||lead.marketplace_code!=='AMAZON_JP')throw new SellerRegistrationError('NOT_FOUND',404);
  const expectedHash=await hashNormalizedWechat(normalizedWechat,identitySecret);
  if(lead.identity_hash===null||lead.identity_hash!==expectedHash)throw new SellerRegistrationError('CONFLICT',409);
  const existingLink=await database.prepare(`SELECT target_id FROM acquisition_lead_links
    WHERE lead_id=? AND link_type='SELLER_ORGANIZATION' LIMIT 1`).bind(lead.id).first<{target_id:string}>();
  if(existingLink)return ensureHistoricalSellerTarget(database,existingLink.target_id,wechatDisplay,normalizedWechat,now,{leadId:lead.id,kind:'NEW_CUSTOMER'});
  const channel=await database.prepare(`SELECT prefix,next_sequence FROM seller_channels WHERE id=? AND status='ACTIVE'`)
    .bind(SYSTEM_SELLER_CHANNEL).first<{prefix:string;next_sequence:number}>();
  if(!channel)throw new SellerRegistrationError('DEPENDENCY_UNAVAILABLE',503);
  const sequence=Number(channel.next_sequence);if(!Number.isSafeInteger(sequence)||sequence<1)throw new SellerRegistrationError('DEPENDENCY_UNAVAILABLE',503);
  const organizationId=crypto.randomUUID(),subjectId=crypto.randomUUID(),memberId=crypto.randomUUID();
  const sellerCode=`${channel.prefix}-${String(sequence).padStart(6,'0')}`;
  const organizationName=(lead.display_name?.trim()||wechatDisplay).slice(0,200);
  const claimId=crypto.randomUUID();
  const statements:SqlStatement[]=[
    database.prepare(`UPDATE seller_channels SET next_sequence=next_sequence+1,version=version+1,updated_at=?
      WHERE id=? AND status='ACTIVE' AND next_sequence=?`).bind(now,SYSTEM_SELLER_CHANNEL,sequence),
    database.prepare(`INSERT INTO customer_identity_subjects(id,subject_type,created_at) VALUES(?,'SELLER_ORG_MEMBER',?)`).bind(subjectId,now),
    database.prepare(`INSERT INTO wechat_identity_claims(
      id,identity_subject_id,display_wechat,normalized_wechat,status,version,acquired_at,reserved_at,released_at,
      created_at,updated_at,identity_subject_type
    ) VALUES(?,?,?,?,'ACTIVE',1,?,NULL,NULL,?,?,'SELLER_ORG_MEMBER')`).bind(claimId,subjectId,wechatDisplay,normalizedWechat,now,now,now),
    database.prepare(`INSERT INTO seller_organizations(
      id,marketplace_code,seller_code,origin_channel_id,current_channel_id,seller_sequence,
      organization_name,status,version,created_at,updated_at,activated_at,disabled_at,next_member_number
    ) VALUES(?,'JP',?,?,?,?,?,'ACTIVE',1,?,?,?,NULL,2)`).bind(
      organizationId,sellerCode,SYSTEM_SELLER_CHANNEL,SYSTEM_SELLER_CHANNEL,sequence,organizationName,now,now,now),
    database.prepare(`INSERT INTO seller_organization_members(
      id,identity_subject_id,organization_id,member_number,username_fallback,display_name,
      role,primary_owner,status,version,created_at,updated_at,activated_at,disabled_at
    ) VALUES(?,?,?,1,?,?,'OWNER',1,'ACTIVE',1,?,?,?,NULL)`).bind(
      memberId,subjectId,organizationId,`${sellerCode}-owner`,organizationName.slice(0,100),now,now,now),
    database.prepare(`INSERT INTO acquisition_lead_links(id,lead_id,link_type,target_id,linked_at)
      VALUES(?,?,'SELLER_ORGANIZATION',?,?)`).bind(crypto.randomUUID(),lead.id,organizationId,now),
  ];
  try{await database.batch(statements);}catch{throw new SellerRegistrationError('CONFLICT',409);}
  return{organizationId,memberId,organizationName,leadId:lead.id,kind:'NEW_CUSTOMER' as const};
}

async function ensureHistoricalSellerTarget(
  database:SqlDatabase,
  organizationIdRaw:string,
  wechatDisplay:string,
  normalizedWechat:string,
  now:number,
  override?:{leadId:string;kind:Kind},
){
  const organizationId=cleanId(organizationIdRaw);
  const org=await database.prepare(`SELECT id,seller_code,organization_name,marketplace_code,status,next_member_number
    FROM seller_organizations WHERE id=?`).bind(organizationId).first<OrgRow>();
  if(!org||org.status!=='ACTIVE'||org.marketplace_code!=='JP')throw new SellerRegistrationError('NOT_FOUND',404);
  let member=await database.prepare(`SELECT id,identity_subject_id,display_name,member_number FROM seller_organization_members
    WHERE organization_id=? AND primary_owner=1 AND status='ACTIVE' ORDER BY member_number,id LIMIT 1`).bind(organizationId).first<MemberRow>();
  if(member){
    const claim=await database.prepare(`SELECT normalized_wechat FROM wechat_identity_claims
      WHERE identity_subject_id=? AND status='ACTIVE' ORDER BY created_at LIMIT 1`).bind(member.identity_subject_id).first<{normalized_wechat:string}>();
    if(claim&&claim.normalized_wechat!==normalizedWechat)throw new SellerRegistrationError('CONFLICT',409);
    if(!claim){await database.prepare(`INSERT INTO wechat_identity_claims(
      id,identity_subject_id,display_wechat,normalized_wechat,status,version,acquired_at,reserved_at,released_at,created_at,updated_at,identity_subject_type
    ) VALUES(?,?,?,?,'ACTIVE',1,?,NULL,NULL,?,?,'SELLER_ORG_MEMBER')`).bind(
      crypto.randomUUID(),member.identity_subject_id,wechatDisplay,normalizedWechat,now,now,now).run();}
  }else{
    const subjectId=crypto.randomUUID(),memberId=crypto.randomUUID(),number=Number(org.next_member_number);
    if(!Number.isSafeInteger(number)||number<1)throw new SellerRegistrationError('DEPENDENCY_UNAVAILABLE',503);
    await database.batch([
      database.prepare(`INSERT INTO customer_identity_subjects(id,subject_type,created_at) VALUES(?,'SELLER_ORG_MEMBER',?)`).bind(subjectId,now),
      database.prepare(`INSERT INTO wechat_identity_claims(id,identity_subject_id,display_wechat,normalized_wechat,status,version,
        acquired_at,reserved_at,released_at,created_at,updated_at,identity_subject_type)
        VALUES(?,?,?,?,'ACTIVE',1,?,NULL,NULL,?,?,'SELLER_ORG_MEMBER')`).bind(
          crypto.randomUUID(),subjectId,wechatDisplay,normalizedWechat,now,now,now),
      database.prepare(`INSERT INTO seller_organization_members(
        id,identity_subject_id,organization_id,member_number,username_fallback,display_name,role,primary_owner,status,version,
        created_at,updated_at,activated_at,disabled_at
      ) VALUES(?,?,?,?,?,?,'OWNER',1,'ACTIVE',1,?,?,?,NULL)`).bind(
        memberId,subjectId,organizationId,number,`${org.seller_code}-owner-${number}`,org.organization_name.slice(0,100),now,now,now),
      database.prepare(`UPDATE seller_organizations SET next_member_number=next_member_number+1,version=version+1,updated_at=?
        WHERE id=? AND next_member_number=?`).bind(now,organizationId,number),
    ]);
    member={id:memberId,identity_subject_id:subjectId,display_name:org.organization_name,member_number:number};
  }
  return{organizationId,memberId:member.id,organizationName:org.organization_name,leadId:override?.leadId??null,
    kind:override?.kind??'HISTORICAL_ACCOUNT_ONLY' as Kind};
}

async function expireOldInvitation(database:SqlDatabase,organizationId:string,now:number){
  const rows=await database.prepare(`SELECT id FROM customer_seller_invitations
    WHERE seller_organization_id=? AND status='ACTIVE' AND expires_at<=?`).bind(organizationId,now).all<{id:string}>();
  for(const row of rows.results){await database.batch([
    database.prepare(`UPDATE customer_seller_invitations SET status='EXPIRED',version=version+1,updated_at=? WHERE id=? AND status='ACTIVE'`).bind(now,row.id),
    event(database,row.id,'EXPIRED','SYSTEM',null,null,null,now),
  ]);}
  const active=await database.prepare(`SELECT id FROM customer_seller_invitations WHERE seller_organization_id=? AND status='ACTIVE' LIMIT 1`)
    .bind(organizationId).first();
  if(active)throw new SellerRegistrationError('CONFLICT',409);
}

function event(
  database:SqlDatabase,
  id:string,
  type:'ISSUED'|'CONSUMED'|'REVOKED'|'EXPIRED',
  actorType:'STAFF'|'CUSTOMER'|'SYSTEM',
  actorId:string|null,
  requestId:string|null,
  key:string|null,
  now:number,
){
  return database.prepare(`INSERT INTO customer_seller_invitation_events(
    id,invitation_id,event_type,actor_type,actor_id,request_id,idempotency_key,created_at
  ) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),id,type,actorType,actorId,requestId,key,now);
}
function requireSellerDuty(actor:AssignmentStaffAuthorization){if(!actor.roles.has('owner')&&!actor.roles.has('seller_ops'))throw new SellerRegistrationError('FORBIDDEN',403);}
async function requireStaffMarket(database:SqlDatabase,actor:AssignmentStaffAuthorization,market:string){if(actor.roles.has('owner'))return;const markets=await resolveStaffMarketplaceCodes(database,actor);if(!markets.includes(market))throw new SellerRegistrationError('FORBIDDEN',403);}
function cleanId(value:string){const normalized=value.normalize('NFKC').trim();if(normalized.length<1||normalized.length>200||/[\u0000-\u001f\u007f]/u.test(normalized))throw new SellerRegistrationError('VALIDATION_ERROR',400);return normalized;}
function maskWechat(value:string){if(value.length<=4)return'***';return`${value.slice(0,2)}***${value.slice(-2)}`;}
