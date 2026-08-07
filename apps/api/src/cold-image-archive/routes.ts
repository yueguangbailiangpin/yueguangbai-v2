import { apiFailure,apiSuccess,isApiErrorCode,type ArchiveComponent } from '@ygb/contracts';
import { readBoundedJson } from '@ygb/domain';
import type { Context,Hono } from 'hono';
import type { AppEnv } from '../app';
import { requirePermission } from '../staff-assignment/permission-policy';
import { ColdArchiveCommandError,recordOrderBusinessClosure,reopenOrderBusinessClosure } from './business-closure';
import { rehydrateArchivedFile } from './rehydration';
import { driveArchiveRuntime } from './runtime';

const BODY_LIMIT=8192;
export function registerColdImageArchiveRoutes(app:Hono<AppEnv>):void{
  app.post('/api/staff/operations/archive/orders/:id/close',withErrors(closeOrder));
  app.post('/api/staff/operations/archive/orders/:id/reopen',withErrors(reopenOrder));
  app.post('/api/staff/operations/archive/files/:id/rehydrate',withErrors(rehydrate));
}
async function closeOrder(context:Context<AppEnv>):Promise<Response>{
  const actor=requireOwner(context);const body=record(await readBoundedJson(context.req.raw,BODY_LIMIT));
  const result=await recordOrderBusinessClosure(context.env.DB,{formalOrderId:context.req.param('id')??'',
    expectedVersion:integer(body['expected_version']),notApplicable:componentList(body['not_applicable']),
    reason:string(body['reason'])},{actor,idempotencyKey:idempotencyKey(context),requestId:context.get('requestId')});
  return context.json(apiSuccess({closure:result},context.get('requestId')));
}
async function reopenOrder(context:Context<AppEnv>):Promise<Response>{
  const actor=requireOwner(context);const body=record(await readBoundedJson(context.req.raw,BODY_LIMIT));
  const result=await reopenOrderBusinessClosure(context.env.DB,{formalOrderId:context.req.param('id')??'',
    expectedVersion:integer(body['expected_version']),reason:string(body['reason'])},
    {actor,idempotencyKey:idempotencyKey(context),requestId:context.get('requestId')});
  return context.json(apiSuccess({closure:result},context.get('requestId')));
}
async function rehydrate(context:Context<AppEnv>):Promise<Response>{
  const actor=requireOwner(context);const body=record(await readBoundedJson(context.req.raw,BODY_LIMIT));
  const runtime=driveArchiveRuntime(context.env);const storage=context.env.FILE_OBJECT_STORAGE;
  if(!runtime.adapter||!storage)throw new ColdArchiveCommandError('DEPENDENCY_UNAVAILABLE',503);
  const result=await rehydrateArchivedFile(context.env.DB,storage,runtime.adapter,{fileObjectId:context.req.param('id')??'',
    expectedArchiveVersion:integer(body['expected_archive_version'])},
    {actor,idempotencyKey:idempotencyKey(context),requestId:context.get('requestId')});
  return context.json(apiSuccess({rehydration:result},context.get('requestId')));
}
function requireOwner(context:Context<AppEnv>){const actor=context.get('staffAuthorization');
  if(!actor||actor.staffStatus!=='ACTIVE'||!actor.roles.has('owner'))throw new ColdArchiveCommandError('FORBIDDEN',403);
  requirePermission(actor,'SCHEDULED_OPERATIONS_RUN');return actor;}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))
  throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return value as Record<string,unknown>;}
function integer(value:unknown):number{if(!Number.isSafeInteger(value))throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return Number(value);}
function string(value:unknown):string{if(typeof value!=='string')throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return value;}
function componentList(value:unknown):ArchiveComponent[]{if(!Array.isArray(value)||value.some((item)=>typeof item!=='string'))
  throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return value as ArchiveComponent[];}
function idempotencyKey(context:Context<AppEnv>):string{const value=context.req.header('Idempotency-Key')?.trim()??'';
  if(value.length<8||value.length>128||/[\u0000-\u001f\u007f]/u.test(value))throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return value;}
function withErrors(handler:(context:Context<AppEnv>)=>Promise<Response>){return async(context:Context<AppEnv>)=>{
  try{return await handler(context);}catch(error){const codeValue=property(error,'code');const statusValue=property(error,'status');
    const code=isApiErrorCode(codeValue)?codeValue:'DEPENDENCY_UNAVAILABLE';return context.json(apiFailure(code,message(code),
      context.get('requestId')),status(statusValue));}};}
function property(value:unknown,key:string):unknown{return value!==null&&(typeof value==='object'||typeof value==='function')?Reflect.get(value,key):undefined;}
function status(value:unknown):400|403|404|409|503{switch(value){case 400:return 400;case 403:return 403;case 404:return 404;case 409:return 409;default:return 503;}}
function message(code:string):string{switch(code){case'FORBIDDEN':return'无权执行此操作';case'NOT_FOUND':return'归档事实不存在';
  case'VERSION_CONFLICT':return'归档事实版本已变化';case'IDEMPOTENCY_CONFLICT':return'幂等键已用于不同请求';
  case'REQUEST_IN_PROGRESS':return'请求正在处理中';case'STATE_CONFLICT':return'业务条件尚未满足或当前状态不允许执行';
  case'VALIDATION_ERROR':return'请求参数不正确';default:return'归档服务暂时不可用，请稍后重试';}}
