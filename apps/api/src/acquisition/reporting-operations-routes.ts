import { apiFailure, apiSuccess } from '@ygb/contracts';
import { readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { AcquisitionError } from './errors';
import {
  activateReportingPrecisionBoundary,
  correctLeadSource,
  listSourceCorrectionCandidates,
  readReportingPrecisionConfig,
} from './reporting-operations';

const BODY_LIMIT=16*1024;

export function registerAcquisitionReportingOperationRoutes(app:Hono<any>):void{
  app.get('/api/staff/acquisition/reporting-config',withErrors(async(context)=>
    context.json(apiSuccess({config:await readReportingPrecisionConfig(context.env.DB,actor(context))},requestIdFromContext(context)))));

  app.post('/api/staff/acquisition/reporting-config/activate',customerAuthOriginGuard(),withErrors(async(context)=>{
    const body=await exactBody(context,['business_date','expected_version']);
    if(typeof body['business_date']!=='string'||!Number.isSafeInteger(body['expected_version']))throw validation();
    const config=await activateReportingPrecisionBoundary(context.env.DB,actor(context),{
      businessDate:body['business_date'],expectedVersion:Number(body['expected_version']),
    });
    return context.json(apiSuccess({config},requestIdFromContext(context)));
  }));

  app.get('/api/staff/acquisition/source-corrections/candidates',withErrors(async(context)=>{
    const url=new URL(context.req.url);if([...url.searchParams.keys()].some((key)=>key!=='limit'))throw validation();
    const raw=url.searchParams.get('limit');const limit=raw===null?100:Number(raw);
    const items=await listSourceCorrectionCandidates(context.env.DB,actor(context),limit);
    return context.json(apiSuccess({items},requestIdFromContext(context)));
  }));

  app.post('/api/staff/acquisition/source-corrections',customerAuthOriginGuard(),withErrors(async(context)=>{
    const body=await exactBody(context,['lead_id','new_channel_id','reason']);
    if(typeof body['lead_id']!=='string'||typeof body['new_channel_id']!=='string'||typeof body['reason']!=='string')throw validation();
    const correction=await correctLeadSource(context.env.DB,actor(context),{
      leadId:body['lead_id'],newChannelId:body['new_channel_id'],reason:body['reason'],
    });
    return context.json(apiSuccess({correction},requestIdFromContext(context)),201);
  }));
}

function actor(context:Context<any>):AssignmentStaffAuthorization{
  const value=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
  if(!value||value.staffStatus!=='ACTIVE')throw new AcquisitionError('UNAUTHENTICATED',401);return value;
}
async function exactBody(context:Context<any>,keys:readonly string[]){
  const value=await readBoundedJson(context.req.raw,BODY_LIMIT);
  if(!value||typeof value!=='object'||Array.isArray(value))throw validation();
  const record=value as Record<string,unknown>;
  if(Object.keys(record).length!==keys.length||keys.some((key)=>!Object.hasOwn(record,key)))throw validation();
  return record;
}
function validation(){return new AcquisitionError('VALIDATION_ERROR',400);}
function withErrors(handler:(context:Context<any>)=>Promise<Response>){return async(context:Context<any>)=>{
  try{return await handler(context);}catch(error){const normalized=error instanceof AcquisitionError?error:new AcquisitionError('DEPENDENCY_UNAVAILABLE',503);
    const message=normalized.code==='FORBIDDEN'?'当前岗位或负责站点不允许此操作':normalized.code==='NOT_FOUND'?'没有找到对应记录':normalized.code==='STATE_CONFLICT'?'当前状态不允许此操作':normalized.code==='VERSION_CONFLICT'?'页面数据已变化，请刷新后重试':normalized.code==='VALIDATION_ERROR'?'提交信息不正确':'服务暂时不可用';
    return context.json(apiFailure(normalized.code,message,requestIdFromContext(context)),normalized.status);
  }};}
