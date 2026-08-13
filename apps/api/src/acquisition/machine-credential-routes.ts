import { apiFailure,apiSuccess } from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context,Hono } from 'hono';
import { IdempotencyError } from '../foundation/idempotency';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import type { AcquisitionCommandContext } from './command';
import { AcquisitionError } from './errors';
import { createMachineCredential,listMachineCredentials,revokeMachineCredential } from './machine-credentials';

export function registerAcquisitionMachineCredentialRoutes(app:Hono<any>):void{
  app.get('/api/staff/acquisition/machines',wrap(async(context)=>{
    owner(context);return ok(context,{machines:await listMachineCredentials(context.env.DB)});
  }));
  app.post('/api/staff/acquisition/machines',customerAuthOriginGuard(),wrap(async(context)=>{
    const actor=owner(context);const body=await exact(context,['machine_name','marketplace_codes','channel_ids','hourly_request_limit']);
    if(typeof body['machine_name']!=='string'||!Array.isArray(body['marketplace_codes'])||!Array.isArray(body['channel_ids'])
      ||body['marketplace_codes'].some((v)=>typeof v!=='string')||body['channel_ids'].some((v)=>typeof v!=='string')||!Number.isSafeInteger(body['hourly_request_limit']))throw new AcquisitionError('VALIDATION_ERROR',400);
    const result=await createMachineCredential(context.env.DB,{machineName:body['machine_name'],marketplaceCodes:body['marketplace_codes'] as string[],channelIds:body['channel_ids'] as string[],hourlyRequestLimit:Number(body['hourly_request_limit'])},command(context,actor));
    return ok(context,result,201);
  }));
  app.post('/api/staff/acquisition/machines/:id/revoke',customerAuthOriginGuard(),wrap(async(context)=>{
    const actor=owner(context);await exact(context,[]);return ok(context,await revokeMachineCredential(context.env.DB,context.req.param('id')??'',command(context,actor)));
  }));
}
function owner(context:Context<any>){const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;if(!actor||actor.staffStatus!=='ACTIVE'||!actor.roles.has('owner')||!actor.permissions.has('ACQUISITION_ADMIN'))throw new AcquisitionError('FORBIDDEN',403);return actor;}
function command(context:Context<any>,actor:AssignmentStaffAuthorization):AcquisitionCommandContext{let key;try{key=parseIdempotencyKey(context.req.header('Idempotency-Key'));}catch{throw new AcquisitionError('VALIDATION_ERROR',400);}if(!key)throw new AcquisitionError('VALIDATION_ERROR',400);return{actor,idempotencyKey:key,requestId:requestIdFromContext(context)};}
async function exact(context:Context<any>,keys:string[]){const value=await readBoundedJson(context.req.raw,32*1024);if(!value||typeof value!=='object'||Array.isArray(value))throw new AcquisitionError('VALIDATION_ERROR',400);const body=value as Record<string,unknown>;if(Object.keys(body).length!==keys.length||keys.some((key)=>!Object.hasOwn(body,key)))throw new AcquisitionError('VALIDATION_ERROR',400);return body;}
function ok(context:Context<any>,data:unknown,status=200){context.header('Cache-Control','no-store');return context.json(apiSuccess(data,requestIdFromContext(context)),status as 200|201);}
function wrap(handler:(context:Context<any>)=>Promise<Response>){return async(context:Context<any>)=>{try{return await handler(context);}catch(error){const e=error instanceof AcquisitionError||error instanceof IdempotencyError?error:new AcquisitionError('DEPENDENCY_UNAVAILABLE',503);return context.json(apiFailure(e.code,e.code==='FORBIDDEN'?'只有总管理员可以管理 Codex 机器密钥':e.code==='STATE_CONFLICT'?'该机器已经停用或状态已变化':e.code==='IDEMPOTENCY_CONFLICT'?'幂等键已用于其他请求':e.code==='REQUEST_IN_PROGRESS'?'相同请求正在处理中':e.code==='VALIDATION_ERROR'?'机器名称、站点、渠道或限流配置不正确':'机器密钥服务暂时不可用',requestIdFromContext(context)),e.status);}};}
