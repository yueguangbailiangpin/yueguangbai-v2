import { apiFailure, apiSuccess, isAcquisitionLeadType, type SqlDatabase } from '@ygb/contracts';
import type { Hono } from 'hono';
import { createAuditEventStatement } from '../foundation/audit';
import { IdempotencyError } from '../foundation/idempotency';
import { AcquisitionError, validation } from './errors';
import { addMachineProspectSignal, createMachineProspect } from './prospects';

const BODY_LIMIT=32*1024;
const MACHINE_STATUSES=new Set(['NEW','RESEARCHING','QUALIFIED','READY_CONTACT']);

export function registerAcquisitionMachineRoutes(app:Hono<any>):void{
  app.post('/api/acquisition-machine/prospects',wrap(async(context)=>{
    const machine=await machineIdentity(context.req.raw,context.env.ACQUISITION_MACHINE_SHARED_SECRET);
    const key=idempotencyKey(context.req.raw);const body=await bodyObject(context.req.raw);
    exact(body,['lead_type','marketplace_code','channel_id','display_name','contact_value','source_url','note','ai_score']);
    if(!isAcquisitionLeadType(body['lead_type'])||typeof body['marketplace_code']!=='string'||typeof body['channel_id']!=='string'
      ||typeof body['display_name']!=='string'||!(body['contact_value']===null||typeof body['contact_value']==='string')
      ||!(body['source_url']===null||typeof body['source_url']==='string')||!(body['note']===null||typeof body['note']==='string')
      ||!(body['ai_score']===null||Number.isSafeInteger(body['ai_score'])))validation();
    const result=await createMachineProspect(context.env.DB,{leadType:body['lead_type'],marketplaceCode:body['marketplace_code'],channelId:body['channel_id'],displayName:body['display_name'],contactValue:body['contact_value'],sourceUrl:body['source_url'],note:body['note'],aiScore:body['ai_score']===null?null:Number(body['ai_score'])},machine,key);
    return context.json(apiSuccess(result,requestId(context)),201,{'Cache-Control':'no-store'});
  }));

  app.post('/api/acquisition-machine/prospects/:id/signals',wrap(async(context)=>{
    const machine=await machineIdentity(context.req.raw,context.env.ACQUISITION_MACHINE_SHARED_SECRET);
    const body=await bodyObject(context.req.raw);exact(body,['signal_type','signal_content','source_url','confidence']);
    if(typeof body['signal_type']!=='string'||typeof body['signal_content']!=='string'||!(body['source_url']===null||typeof body['source_url']==='string')
      ||!['LOW','MEDIUM','HIGH','CONFIRMED'].includes(String(body['confidence'])))validation();
    const signal=await addMachineProspectSignal(context.env.DB,required(context.req.param('id')),{signalType:body['signal_type'],signalContent:body['signal_content'],sourceUrl:body['source_url'],confidence:body['confidence'] as 'LOW'|'MEDIUM'|'HIGH'|'CONFIRMED'},machine);
    return context.json(apiSuccess({signal},requestId(context)),201,{'Cache-Control':'no-store'});
  }));

  app.post('/api/acquisition-machine/prospects/:id/analysis',wrap(async(context)=>{
    const machine=await machineIdentity(context.req.raw,context.env.ACQUISITION_MACHINE_SHARED_SECRET);
    const id=required(context.req.param('id'));const body=await bodyObject(context.req.raw);exact(body,['expected_version','status','ai_score','note']);
    if(!Number.isSafeInteger(body['expected_version'])||typeof body['status']!=='string'||!MACHINE_STATUSES.has(body['status'])
      ||!(body['ai_score']===null||Number.isSafeInteger(body['ai_score']))||!(body['note']===null||typeof body['note']==='string'))validation();
    const result=await updateMachineAnalysis(context.env.DB,id,{expectedVersion:Number(body['expected_version']),status:body['status'],aiScore:body['ai_score']===null?null:Number(body['ai_score']),note:body['note']},machine);
    return context.json(apiSuccess({prospect:result},requestId(context)),200,{'Cache-Control':'no-store'});
  }));
}

async function updateMachineAnalysis(database:SqlDatabase,id:string,input:{expectedVersion:number;status:string;aiScore:number|null;note:string|null},machine:string){
  if(input.aiScore!==null&&(!Number.isSafeInteger(input.aiScore)||input.aiScore<0||input.aiScore>100))validation();
  const note=input.note===null?null:input.note.normalize('NFKC').trim();if(note!==null&&note.length>4000)validation();
  const row=await database.prepare(`SELECT id,status,version FROM acquisition_prospects WHERE id=?`).bind(id).first<{id:string;status:string;version:number}>();
  if(!row)throw new AcquisitionError('NOT_FOUND',404);if(row.status==='CONVERTED'||row.status==='LOST')throw new AcquisitionError('STATE_CONFLICT',409);
  if(Number(row.version)!==input.expectedVersion)throw new AcquisitionError('VERSION_CONFLICT',409);const now=Date.now();
  await database.batch([
    database.prepare(`UPDATE acquisition_prospects SET status=?,ai_score=?,note=?,version=version+1,updated_at=? WHERE id=? AND version=?`).bind(input.status,input.aiScore,note,now,id,input.expectedVersion),
    createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType:'ACQUISITION_PROSPECT',aggregateId:id,eventType:'CODEX_PROSPECT_ANALYSIS_UPDATED',actor:{type:'CODEX',id:machine,roles:[]},previousState:{status:row.status,version:input.expectedVersion},nextState:{status:input.status,ai_score:input.aiScore,note,version:input.expectedVersion+1},createdAt:now}),
  ]);
  return database.prepare(`SELECT prospect.id AS prospect_id,prospect.lead_type,prospect.marketplace_code,prospect.origin_channel_id,channel.display_name AS origin_channel_name,prospect.display_name,prospect.contact_value,prospect.source_url,prospect.origin_mode,prospect.status,prospect.ai_score,prospect.note,prospect.discovered_at,prospect.converted_lead_id,prospect.version,prospect.created_at,prospect.updated_at FROM acquisition_prospects prospect JOIN acquisition_channels channel ON channel.id=prospect.origin_channel_id WHERE prospect.id=?`).bind(id).first();
}

async function machineIdentity(request:Request,secretValue:unknown):Promise<string>{
  const secret=typeof secretValue==='string'?secretValue:'';if(secret.length<32||secret.length>1000)throw new AcquisitionError('DEPENDENCY_UNAVAILABLE',503);
  const auth=request.headers.get('Authorization')??'';if(!auth.startsWith('Bearer '))throw new AcquisitionError('UNAUTHENTICATED',401);
  if(!await constantEqual(auth.slice(7),secret))throw new AcquisitionError('UNAUTHENTICATED',401);
  const machine=required(request.headers.get('X-Moonwhite-Machine-Id')??'');if(machine.length>120)validation();return machine;
}
async function constantEqual(left:string,right:string):Promise<boolean>{const [a,b]=await Promise.all([digest(left),digest(right)]);let diff=0;for(let i=0;i<a.length;i+=1)diff|=a[i]!^b[i]!;return diff===0;}
async function digest(value:string):Promise<Uint8Array>{return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
function idempotencyKey(request:Request):string{const value=request.headers.get('Idempotency-Key')?.trim()??'';if(value.length<8||value.length>128||/[\u0000-\u001f\u007f]/u.test(value))validation();return value;}
async function bodyObject(request:Request):Promise<Record<string,unknown>>{const length=request.headers.get('content-length');if(length&&Number(length)>BODY_LIMIT)validation();let value:unknown;try{value=await request.json();}catch{validation();}if(!value||typeof value!=='object'||Array.isArray(value))validation();return value as Record<string,unknown>;}
function exact(record:Record<string,unknown>,keys:readonly string[]){const actual=Object.keys(record).sort(),expected=[...keys].sort();if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))validation();}
function required(value:string):string{const normalized=value.trim();if(normalized.length<1||normalized.length>200||/[\u0000-\u001f\u007f]/u.test(normalized))validation();return normalized;}
function requestId(context:{get:(key:string)=>unknown}){return String(context.get('requestId')??crypto.randomUUID());}
function wrap(handler:(context:any)=>Promise<Response>){return async(context:any)=>{try{return await handler(context);}catch(error){const normalized=error instanceof AcquisitionError?error:error instanceof IdempotencyError?error:new AcquisitionError('DEPENDENCY_UNAVAILABLE',503);return context.json(apiFailure(normalized.code,normalized.code==='UNAUTHENTICATED'?'机器身份验证失败':normalized.code==='FORBIDDEN'?'机器无权执行该操作':normalized.code==='NOT_FOUND'?'潜在线索不存在':normalized.code==='VERSION_CONFLICT'?'潜在线索已更新，请重新读取':normalized.code==='VALIDATION_ERROR'?'请求内容不正确':'获客机器接口暂时不可用',requestId(context)),normalized.status);}};}
