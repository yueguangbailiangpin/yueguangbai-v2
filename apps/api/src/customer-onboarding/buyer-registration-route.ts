import {
  apiFailure,
  apiSuccess,
  isBuyerSupportedMarketplaceCode,
} from '@ygb/contracts';
import { parseIdempotencyKey } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { requireWechatIdentitySecret } from './wechat-identity-crypto';
import { issueBuyerInvitation } from '../customer-security/service';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';

const BODY_LIMIT=16*1024;


export function registerNewBuyerRegistrationInvitationRoute(app:Hono<AppEnv>):void{
  app.post(
    '/api/staff/customer-onboarding/buyer-registration-invitations',
    customerAuthOriginGuard(),
    async(context)=>{
      const requestId=requestIdFromContext(context);
      try{
        const actor=requireActor(context);
        const body=await exactBody(context,['buyer_customer_id','wechat_id','marketplace_code']);
        if(typeof body['wechat_id']!=='string'
          ||typeof body['buyer_customer_id']!=='string'
          ||!isBuyerSupportedMarketplaceCode(body['marketplace_code']))throw new Error('VALIDATION');
        const marketplaceCode=body['marketplace_code'];
        await requireMarket(context,actor,marketplaceCode);
        const secret=requireWechatIdentitySecret(context.env.CUSTOMER_SECURITY_TOKEN_SECRET);
        const key=idempotencyKey(context);
        const invitation=await issueBuyerInvitation(context.env.DB,{
          buyerCustomerId:body['buyer_customer_id'],
          wechatId:body['wechat_id'],marketplaceCode,
        },{
          actor,idempotencyKey:key,requestId,tokenSecret:secret,
        });
        context.header('Cache-Control','no-store');
        return context.json(apiSuccess({invitation:{
          ...invitation,
          registration_path:`/buyer/register?token=${encodeURIComponent(invitation.registration_token)}`,
          status:'ACTIVE' as const,
        }},requestId),201);
      }catch(error){
        const code=error instanceof Error?error.message:'';
        if(code==='FORBIDDEN')return context.json(apiFailure('FORBIDDEN','当前岗位或站点不能生成该买家注册链接',requestId),403);
        if(code==='NOT_FOUND')return context.json(apiFailure('NOT_FOUND','没有找到对应的新买家客户',requestId),404);
        if(code==='CONFLICT')return context.json(apiFailure('CONFLICT','买家线索、微信号或注册链接状态不一致',requestId),409);
        if(code==='VALIDATION')return context.json(apiFailure('VALIDATION_ERROR','提交信息不正确',requestId),400);
        return context.json(apiFailure('DEPENDENCY_UNAVAILABLE','买家注册链接暂时无法生成',requestId),503);
      }
    },
  );
}

function requireActor(context:Context<AppEnv>):AssignmentStaffAuthorization{
  const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
  if(!actor||actor.staffStatus!=='ACTIVE'||(!actor.roles.has('owner')&&!actor.roles.has('pre_sales')))throw new Error('FORBIDDEN');
  return actor;
}
async function requireMarket(context:Context<AppEnv>,actor:AssignmentStaffAuthorization,market:string){
  if(actor.roles.has('owner'))return;
  const markets=await resolveStaffMarketplaceCodes(context.env.DB,actor);
  if(!markets.includes(market))throw new Error('FORBIDDEN');
}
function idempotencyKey(context:Context<AppEnv>):string{
  try{const value=parseIdempotencyKey(context.req.header('Idempotency-Key'));if(!value)throw new Error('missing');return value;}
  catch{throw new Error('VALIDATION');}
}
async function exactBody(context:Context<AppEnv>,keys:readonly string[]):Promise<Record<string,unknown>>{
  const type=context.req.header('Content-Type')??'';
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(type))throw new Error('VALIDATION');
  const raw=await context.req.text();if(new TextEncoder().encode(raw).byteLength>BODY_LIMIT)throw new Error('VALIDATION');
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error('VALIDATION');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('VALIDATION');
  const record=value as Record<string,unknown>;
  if(Object.keys(record).length!==keys.length||keys.some((key)=>!Object.hasOwn(record,key)))throw new Error('VALIDATION');
  return record;
}
