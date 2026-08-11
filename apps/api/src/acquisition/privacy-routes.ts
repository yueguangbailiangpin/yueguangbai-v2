import { apiFailure, apiSuccess, type ApiErrorCode } from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { IdempotencyError } from '../foundation/idempotency';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { listAcquisitionVisibleChannels, updateAcquisitionChannelPrivacyProfile } from './channel-privacy';
import type { AcquisitionCommandContext } from './command';
import { AcquisitionError, validation } from './errors';

const BODY_LIMIT=16*1024;

export function registerAcquisitionPrivacyRoutes(app:Hono<AppEnv>):void{
  app.get('/api/staff/acquisition/channels',withErrors(async(context)=>{
    return context.json(apiSuccess({
      channels:await listAcquisitionVisibleChannels(context.env.DB,actor(context)),
    },requestIdFromContext(context)));
  }));

  app.post(
    '/api/staff/acquisition/channels/:id/privacy-profile',
    customerAuthOriginGuard(),
    withErrors(async(context)=>{
      const body=await readBody(context);
      const result=await updateAcquisitionChannelPrivacyProfile(context.env.DB,{
        channelId:required(context.req.param('id')),
        expectedVersion:integer(body['expected_version']),
        intakeWechatLabel:required(body['intake_wechat_label']),
      },command(context));
      return context.json(apiSuccess(result,requestIdFromContext(context)));
    }),
  );
}

function actor(context:Context<AppEnv>):AssignmentStaffAuthorization{
  const value=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
  if(!value||value.staffStatus!=='ACTIVE')throw new AcquisitionError('UNAUTHENTICATED',401);
  return value;
}
function command(context:Context<AppEnv>):AcquisitionCommandContext{
  let key:string|null=null;
  try{key=parseIdempotencyKey(context.req.header('Idempotency-Key'));}catch{validation();}
  if(!key)validation();
  return{actor:actor(context),idempotencyKey:key,requestId:requestIdFromContext(context)};
}
async function readBody(context:Context<AppEnv>):Promise<Record<string,unknown>>{
  const value=await readBoundedJson(context.req.raw,BODY_LIMIT);
  if(!value||typeof value!=='object'||Array.isArray(value))validation();
  const record=value as Record<string,unknown>;
  const allowed=new Set(['expected_version','intake_wechat_label']);
  if(Object.keys(record).some((key)=>!allowed.has(key))||Object.keys(record).length!==2)validation();
  return record;
}
function required(value:unknown):string{
  if(typeof value!=='string'||value.trim().length<1)validation();
  return value;
}
function integer(value:unknown):number{
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)validation();
  return value;
}
function withErrors(handler:(context:Context<AppEnv>)=>Promise<Response>){
  return async(context:Context<AppEnv>)=>{
    try{return await handler(context);}catch(error){
      const normalized=normalize(error);
      return context.json(apiFailure(normalized.code,message(normalized.code),requestIdFromContext(context)),normalized.status);
    }
  };
}
function normalize(error:unknown):{code:ApiErrorCode;status:400|401|403|404|409|429|503}{
  if(error instanceof AcquisitionError)return error;
  if(error instanceof IdempotencyError)return error;
  return{code:'DEPENDENCY_UNAVAILABLE',status:503};
}
function message(code:ApiErrorCode):string{
  if(code==='UNAUTHENTICATED')return'员工会话无效';
  if(code==='FORBIDDEN')return'当前岗位无权查看或修改渠道配置';
  if(code==='NOT_FOUND')return'渠道不存在';
  if(code==='CONFLICT')return'接待微信已被其他渠道使用';
  if(code==='VERSION_CONFLICT')return'渠道配置已更新，请刷新后重试';
  if(code==='VALIDATION_ERROR')return'渠道配置内容不正确';
  return'服务暂时不可用，请稍后重试';
}
