import type { Hono } from 'hono';
import { hashOneTimeToken } from '@ygb/domain';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { writeCustomerSessionCookie } from '../http-auth/cookies';
import { CUSTOMER_SESSION_TTL_MS,requireCustomerSessionSecret } from '../http-auth/config';

type RegistrationPath='/api/buyer-auth/register'|'/api/seller-auth/register'|'/api/seller-auth/member-register';

/**
 * Migration 0062 bumps customer_login_accounts.session_version atomically when
 * a second persona is inserted on an existing login. These middlewares never
 * mutate privilege state; they only replace the current response cookie with a
 * token signed against the post-transaction session_version. Thus every older
 * device is invalid immediately, while the device that completed the invite can
 * continue with the newly selected persona.
 */
export function installSellerMemberPrivilegeSessionRotation(app:Hono<any>):void{
  install(app,'/api/buyer-auth/register');
  install(app,'/api/seller-auth/register');
  install(app,'/api/seller-auth/member-register');
}

function install(app:Hono<any>,path:RegistrationPath):void{
  app.use(path,async(context,next)=>{
    let invitationToken:string|null=null;
    try{
      const value=await context.req.raw.clone().json() as Record<string,unknown>;
      invitationToken=typeof value['invitation_token']==='string'?value['invitation_token']:null;
    }catch{/* canonical route owns request validation */}
    await next();
    if(context.res.status!==201||!invitationToken)return;

    const tokenHash=await hashOneTimeToken(invitationToken).catch(()=>null);if(!tokenHash)return;
    const accountId=await consumedAccountId(context.env.DB,path,tokenHash);if(!accountId)return;
    const account=await context.env.DB.prepare(`SELECT id,identity_subject_id,session_version,password_change_required,status
      FROM customer_login_accounts WHERE id=?`).bind(accountId)
      .first<{id:string;identity_subject_id:string;session_version:number;password_change_required:number;status:string}>();
    if(!account||account.status!=='ACTIVE'||!Number.isSafeInteger(Number(account.session_version)))return;

    const accountType=path==='/api/buyer-auth/register'?'BUYER' as const:'SELLER_MEMBER' as const;
    const secret=requireCustomerSessionSecret(context.env.CUSTOMER_SESSION_SECRET);const now=Date.now();
    const token=await issueCustomerSession({
      accountId:account.id,identitySubjectId:account.identity_subject_id,accountType,
      sessionVersion:Number(account.session_version),passwordChangeRequired:Number(account.password_change_required)===1,
    },secret,{now,ttlMs:CUSTOMER_SESSION_TTL_MS});
    writeCustomerSessionCookie(context,token);
  });
}

async function consumedAccountId(database:any,path:RegistrationPath,tokenHash:string):Promise<string|null>{
  if(path==='/api/buyer-auth/register'){
    const row=await database.prepare(`SELECT consumed_by_account_id AS account_id FROM customer_buyer_invitations
      WHERE token_hash=? AND status='CONSUMED' AND consumed_by_account_id IS NOT NULL`).bind(tokenHash).first<{account_id:string}>();
    return row?.account_id??null;
  }
  if(path==='/api/seller-auth/register'){
    const row=await database.prepare(`SELECT consumed_by_account_id AS account_id FROM customer_seller_invitations
      WHERE token_hash=? AND status='CONSUMED' AND consumed_by_account_id IS NOT NULL`).bind(tokenHash).first<{account_id:string}>();
    return row?.account_id??null;
  }
  const row=await database.prepare(`SELECT consumed_account_id AS account_id FROM seller_member_invitations
    WHERE token_hash=? AND status='CONSUMED' AND consumed_account_id IS NOT NULL`).bind(tokenHash).first<{account_id:string}>();
  return row?.account_id??null;
}
