import type { Hono } from 'hono';
import { hashOneTimeToken } from '@ygb/domain';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { writeCustomerSessionCookie } from '../http-auth/cookies';
import { CUSTOMER_SESSION_TTL_MS, requireCustomerSessionSecret } from '../http-auth/config';
import { createAuditEventStatement } from '../foundation/audit';

/**
 * Adding SELLER_MEMBER to a Moonwhite login is a privilege change. The legacy
 * member-registration handler establishes the membership atomically; this
 * middleware then rotates the shared account session version and replaces the
 * current response cookie. Therefore no pre-existing Buyer/Seller session can
 * silently inherit the newly granted Seller persona.
 */
export function installSellerMemberPrivilegeSessionRotation(app:Hono<any>):void{
  app.use('/api/seller-auth/member-register',async(context,next)=>{
    let invitationToken:string|null=null;
    try{
      const clone=context.req.raw.clone();
      const value=await clone.json() as Record<string,unknown>;
      invitationToken=typeof value['invitation_token']==='string'?value['invitation_token']:null;
    }catch{/* canonical route owns validation */}
    await next();
    if(context.res.status!==201||!invitationToken)return;
    const hash=await hashOneTimeToken(invitationToken).catch(()=>null);
    if(!hash)return;
    const invitation=await context.env.DB.prepare(`SELECT consumed_account_id,consumed_member_id,organization_id
      FROM seller_member_invitations
      WHERE token_hash=? AND status='CONSUMED' AND consumed_account_id IS NOT NULL AND consumed_member_id IS NOT NULL`)
      .bind(hash).first<{consumed_account_id:string;consumed_member_id:string;organization_id:string}>();
    if(!invitation)return;
    const account=await context.env.DB.prepare(`SELECT id,identity_subject_id,session_version,status
      FROM customer_login_accounts WHERE id=?`).bind(invitation.consumed_account_id)
      .first<{id:string;identity_subject_id:string;session_version:number;status:string}>();
    if(!account||account.status!=='ACTIVE')return;
    const now=Date.now(),nextVersion=Number(account.session_version)+1;
    if(!Number.isSafeInteger(nextVersion)||nextVersion<2)return;
    const result=await context.env.DB.batch([
      context.env.DB.prepare(`UPDATE customer_login_accounts
        SET session_version=session_version+1,version=version+1,updated_at=?
        WHERE id=? AND identity_subject_id=? AND status='ACTIVE' AND session_version=?`)
        .bind(now,account.id,account.identity_subject_id,account.session_version),
      createAuditEventStatement(context.env.DB,{
        id:crypto.randomUUID(),aggregateType:'CUSTOMER_LOGIN_ACCOUNT',aggregateId:account.id,
        eventType:'SELLER_MEMBER_PRIVILEGE_SESSION_ROTATED',
        actor:{type:'CUSTOMER',id:account.id,roles:[]},requestId:String(context.get('requestId')??crypto.randomUUID()),
        previousState:{session_version:Number(account.session_version)},
        nextState:{session_version:nextVersion,seller_member_id:invitation.consumed_member_id,seller_organization_id:invitation.organization_id,all_previous_sessions_revoked:true},
        reason:'SELLER_MEMBER_PERSONA_ACTIVATED',createdAt:now,
      }),
      context.env.DB.prepare(`INSERT INTO transaction_assertions(assertion_value)
        SELECT CASE WHEN EXISTS(
          SELECT 1 FROM customer_login_accounts WHERE id=? AND session_version=? AND status='ACTIVE'
        ) THEN 1 ELSE 0 END`).bind(account.id,nextVersion),
    ]);
    if(Number(result[0]?.meta.changes??0)!==1)return;
    const secret=requireCustomerSessionSecret(context.env.CUSTOMER_SESSION_SECRET);
    const token=await issueCustomerSession({
      accountId:account.id,identitySubjectId:account.identity_subject_id,accountType:'SELLER_MEMBER',
      availablePersonas:['SELLER_MEMBER'],sessionVersion:nextVersion,passwordChangeRequired:false,
    },secret,{now,ttlMs:CUSTOMER_SESSION_TTL_MS});
    writeCustomerSessionCookie(context,token);
  });
}
