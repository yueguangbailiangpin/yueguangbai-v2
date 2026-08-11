import { apiFailure, apiSuccess } from '@ygb/contracts';
import { parseIdempotencyKey } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { consumeCustomerSecurityRateLimit } from '../customer-security/rate-limit';
import { writeCustomerSessionCookie } from '../http-auth/cookies';
import { CUSTOMER_SESSION_TTL_MS, requireCustomerSessionSecret } from '../http-auth/config';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  completeSellerRegistration,
  issueSellerRegistrationInvitation,
  readSellerInvitationContext,
  SellerRegistrationError,
} from './service';

const BODY_LIMIT=16*1024;

export function registerSellerRegistrationRoutes(app:Hono<any>):void{
  app.post('/api/staff/customer-security/seller-invitations',customerAuthOriginGuard(),withErrors(async(context)=>{
    const actor=requireStaff(context);
    const body=await exactBody(context,['lead_id','seller_organization_id','wechat_id','marketplace_code']);
    if(!(body['lead_id']===null||typeof body['lead_id']==='string')
      ||!(body['seller_organization_id']===null||typeof body['seller_organization_id']==='string')
      ||typeof body['wechat_id']!=='string'||typeof body['marketplace_code']!=='string')throw validation();
    const result=await issueSellerRegistrationInvitation(context.env.DB,{
      leadId:body['lead_id'],sellerOrganizationId:body['seller_organization_id'],wechatId:body['wechat_id'],marketplaceCode:body['marketplace_code'],
    },{actor,idempotencyKey:idempotencyKey(context),requestId:requestIdFromContext(context),tokenSecret:securitySecret(context)});
    return context.json(apiSuccess({invitation:{...result,registration_path:`/seller/register?token=${encodeURIComponent(result.registration_token)}`,status:'ACTIVE' as const}},requestIdFromContext(context)),201);
  }));

  app.get('/api/seller-auth/invitations/:token',withErrors(async(context)=>{
    const token=context.req.param('token')??'';const now=Date.now();
    const limited=await publicInvitationRate(context,token,now);
    if(limited)return limited;
    context.header('Cache-Control','no-store');
    return context.json(apiSuccess({invitation:await readSellerInvitationContext(context.env.DB,token,now)},requestIdFromContext(context)));
  }));

  app.post('/api/seller-auth/register',customerAuthOriginGuard(),withErrors(async(context)=>{
    const body=await exactBody(context,['invitation_token','wechat_id','password','password_confirmation']);
    if(typeof body['invitation_token']!=='string'||typeof body['wechat_id']!=='string'
      ||typeof body['password']!=='string'||typeof body['password_confirmation']!=='string')throw validation();
    const now=Date.now();const limited=await publicInvitationRate(context,body['invitation_token'],now);
    if(limited)return limited;
    const result=await completeSellerRegistration(context.env.DB,{
      token:body['invitation_token'],wechatId:body['wechat_id'],password:body['password'],passwordConfirmation:body['password_confirmation'],
    },{requestId:requestIdFromContext(context),idempotencyKey:idempotencyKey(context),now});
    const secret=requireCustomerSessionSecret(context.env.CUSTOMER_SESSION_SECRET);
    const token=await issueCustomerSession({
      accountId:result.account_id,identitySubjectId:result.identity_subject_id,accountType:'SELLER_MEMBER',
      availablePersonas:['SELLER_MEMBER'],sessionVersion:result.session_version,passwordChangeRequired:false,
    },secret,{now,ttlMs:CUSTOMER_SESSION_TTL_MS});
    writeCustomerSessionCookie(context,token);context.header('Cache-Control','no-store');
    return context.json(apiSuccess({session_established:true,must_change_password:false,next_path:'/seller',seller_organization_id:result.seller_organization_id,onboarding_kind:result.onboarding_kind},requestIdFromContext(context)),201);
  }));
}

async function publicInvitationRate(context:Context<any>,token:string,now:number):Promise<Response|null>{
  const rate=await consumeCustomerSecurityRateLimit(context.env.DB,{
    operation:'INVITATION',token,
    networkSource:context.req.header('CF-Connecting-IP')??null,
    deviceId:context.req.header('X-Device-ID')??null,
    secret:securitySecret(context),now,
  });
  if(!rate.limited)return null;
  context.header('Cache-Control','no-store');context.header('Retry-After',String(rate.retryAfterSeconds));
  return context.json(apiFailure('RATE_LIMITED','尝试次数过多，请稍后再试',requestIdFromContext(context)),429);
}
function requireStaff(context:Context<any>):AssignmentStaffAuthorization{
  const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
  if(!actor||actor.staffStatus!=='ACTIVE')throw new SellerRegistrationError('FORBIDDEN',403);return actor;
}
function securitySecret(context:Context<any>):string{const value=String(context.env.CUSTOMER_SECURITY_TOKEN_SECRET??'');if(new TextEncoder().encode(value).byteLength<32)throw new SellerRegistrationError('DEPENDENCY_UNAVAILABLE',503);return value;}
function idempotencyKey(context:Context<any>):string{try{const value=parseIdempotencyKey(context.req.header('Idempotency-Key'));if(!value)throw new Error('missing');return value;}catch{throw validation();}}
async function exactBody(context:Context<any>,keys:readonly string[]):Promise<Record<string,any>>{const type=context.req.header('Content-Type')??'';if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(type))throw validation();const raw=await context.req.text();if(new TextEncoder().encode(raw).byteLength>BODY_LIMIT)throw validation();let value:unknown;try{value=JSON.parse(raw);}catch{throw validation();}if(!value||typeof value!=='object'||Array.isArray(value))throw validation();const record=value as Record<string,any>;if(Object.keys(record).length!==keys.length||keys.some((key)=>!Object.hasOwn(record,key)))throw validation();return record;}
function validation(){return new SellerRegistrationError('VALIDATION_ERROR',400);}
function withErrors(handler:(context:Context<any>)=>Promise<Response>){return async(context:Context<any>)=>{try{return await handler(context);}catch(error){const normalized=error instanceof SellerRegistrationError?error:new SellerRegistrationError('DEPENDENCY_UNAVAILABLE',503);const message=normalized.code==='FORBIDDEN'?'当前岗位不允许操作卖家账号':normalized.code==='NOT_FOUND'?'没有找到对应卖家客户':normalized.code==='CONFLICT'?'该链接已失效、客户已开通账号，或现有身份信息不一致':normalized.code==='VALIDATION_ERROR'?'提交信息不正确':'服务暂时不可用';context.header('Cache-Control','no-store');return context.json(apiFailure(normalized.code,message,requestIdFromContext(context)),normalized.status);}};}
