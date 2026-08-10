import type {
  AcquisitionChannelAssignmentDto,
  AcquisitionChannelAudience,
  AcquisitionChannelDto,
  AcquisitionChannelType,
  AcquisitionConsultationEventDto,
  AcquisitionDailyConsultationDto,
  AcquisitionLeadType,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { chinaBusinessDateStartEpoch, parseChinaBusinessDate } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import { createAuditEventStatement } from '../foundation/audit';
import { requireAcquisitionAdmin, requireAcquisitionOperator } from './authorization';
import {
  acquireAcquisitionCommand,
  failAcquisitionCommand,
  finishAcquisitionCommand,
  type AcquisitionCommandContext,
} from './command';
import { AcquisitionError, validation } from './errors';

interface ChannelRow {
  id:string; code:string; channel_type:AcquisitionChannelType;
  platform_name:string; lead_type:AcquisitionChannelAudience; marketplace_code:string;
  display_name:string; status:'ACTIVE'|'DISABLED'; version:number;
  created_at:number; updated_at:number;
}
interface AssignmentRow {
  id:string; staff_id:string; lead_type:AcquisitionLeadType;
  channel_id:string; channel_name:string; effective_from:number;
  effective_until:number|null; status:'ACTIVE'|'REVOKED'; version:number;
}
interface ConsultationRow {
  id:string; channel_id:string; lead_type:AcquisitionLeadType;
  business_date:string; person_count:number; version:number;
  updated_by_staff_id:string; updated_at:number; created_at:number;
}
type Result<T> = T & { replayed:boolean };

export async function createAcquisitionChannel(
  database:SqlDatabase,
  input:{ code:string; platformName:string; leadType:AcquisitionChannelAudience; marketplaceCode:string; displayName:string },
  command:AcquisitionCommandContext,
):Promise<Result<{channel:AcquisitionChannelDto}>>{
  requireAcquisitionAdmin(command.actor);
  const code=normalizedCode(input.code); const platformName=text(input.platformName,100);
  const displayName=text(input.displayName,100); const marketplaceCode=identifier(input.marketplaceCode);
  if(!['BUYER','SELLER','BOTH'].includes(input.leadType))validation();
  await requireMarketplace(database,marketplaceCode);
  const channelType=legacyType(platformName);
  const payload={code,channel_type:channelType,platform_name:platformName,lead_type:input.leadType,marketplace_code:marketplaceCode,display_name:displayName};
  const acquired=await acquireAcquisitionCommand<{channel:AcquisitionChannelDto}>(database,command,'CREATE_ACQUISITION_CHANNEL','ACQUISITION_CHANNEL',code,payload);
  if(acquired.acquired.kind==='REPLAY')return {...acquired.acquired.response,replayed:true};
  const id=crypto.randomUUID();
  const channel:AcquisitionChannelDto={channel_id:id,...payload,status:'ACTIVE',version:1,created_at:acquired.now,updated_at:acquired.now};
  try{
    await database.batch([
      database.prepare(`INSERT INTO acquisition_channels(
        id,code,channel_type,display_name,status,version,created_by_staff_id,created_at,updated_at,disabled_at,
        platform_name,lead_type,marketplace_code
      ) VALUES(?,?,?,?, 'ACTIVE',1,?,?,?,NULL,?,?,?)`).bind(
        id,code,channelType,displayName,command.actor.staffId,acquired.now,acquired.now,platformName,input.leadType,marketplaceCode),
      database.prepare(`INSERT INTO acquisition_channel_events(id,channel_id,event_type,previous_version,next_version,actor_staff_id,idempotency_key,request_hash,reason,created_at)
        VALUES(?,?,'CREATED',NULL,1,?,?,?,?,?)`).bind(crypto.randomUUID(),id,command.actor.staffId,command.idempotencyKey,acquired.requestHash,null,acquired.now),
      audit(database,command,'ACQUISITION_CHANNEL',id,'ACQUISITION_CHANNEL_CREATED',null,channel,null,acquired.now),
      ...finishAcquisitionCommand(database,acquired.acquired.claim,{channel},acquired.now,{channel_id:id}),
      assertion(database,`SELECT 1 FROM acquisition_channels WHERE id=? AND status='ACTIVE' AND version=1`,[id]),
    ]);
    return {channel,replayed:false};
  }catch(error){await failAcquisitionCommand(database,acquired.acquired.claim,acquired.now);if(String(error).includes('UNIQUE'))throw new AcquisitionError('CONFLICT',409);throw error;}
}

export async function disableAcquisitionChannel(
  database:SqlDatabase,input:{channelId:string;expectedVersion:number;reason:string},command:AcquisitionCommandContext,
):Promise<Result<{channel:AcquisitionChannelDto}>>{
  requireAcquisitionAdmin(command.actor); const channelId=identifier(input.channelId); const expected=version(input.expectedVersion); const reason=text(input.reason,1000);
  const existing=await readChannel(database,channelId); if(!existing)throw new AcquisitionError('NOT_FOUND',404);
  if(existing.status!=='ACTIVE')throw new AcquisitionError('STATE_CONFLICT',409); if(existing.version!==expected)throw new AcquisitionError('VERSION_CONFLICT',409);
  const acquired=await acquireAcquisitionCommand<{channel:AcquisitionChannelDto}>(database,command,'DISABLE_ACQUISITION_CHANNEL','ACQUISITION_CHANNEL',channelId,{expected_version:expected,reason});
  if(acquired.acquired.kind==='REPLAY')return {...acquired.acquired.response,replayed:true};
  const channel={...toChannel(existing),status:'DISABLED' as const,version:expected+1,updated_at:acquired.now};
  try{await database.batch([
    database.prepare(`UPDATE acquisition_channels SET status='DISABLED',version=version+1,updated_at=?,disabled_at=? WHERE id=? AND status='ACTIVE' AND version=?`).bind(acquired.now,acquired.now,channelId,expected),
    database.prepare(`INSERT INTO acquisition_channel_events(id,channel_id,event_type,previous_version,next_version,actor_staff_id,idempotency_key,request_hash,reason,created_at)
      VALUES(?,?,'DISABLED',?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),channelId,expected,expected+1,command.actor.staffId,command.idempotencyKey,acquired.requestHash,reason,acquired.now),
    audit(database,command,'ACQUISITION_CHANNEL',channelId,'ACQUISITION_CHANNEL_DISABLED',toChannel(existing),channel,reason,acquired.now),
    ...finishAcquisitionCommand(database,acquired.acquired.claim,{channel},acquired.now,{channel_id:channelId}),
  ]);return {channel,replayed:false};}catch{await failAcquisitionCommand(database,acquired.acquired.claim,acquired.now);throw new AcquisitionError('VERSION_CONFLICT',409);}
}

// Legacy channel-to-staff assignment endpoints are retained only for migration
// compatibility. New customer intake selects an explicit channel per Lead.
export async function createAcquisitionAssignment(
  database:SqlDatabase,input:{staffId:string;leadType:AcquisitionLeadType;channelId:string;effectiveFrom:number;effectiveUntil:number|null},command:AcquisitionCommandContext,
):Promise<Result<{assignment:AcquisitionChannelAssignmentDto}>>{
  requireAcquisitionAdmin(command.actor);
  const staffId=identifier(input.staffId),channelId=identifier(input.channelId),effectiveFrom=epoch(input.effectiveFrom),effectiveUntil=input.effectiveUntil===null?null:epoch(input.effectiveUntil);
  if(effectiveUntil!==null&&effectiveUntil<=effectiveFrom)validation(); const channel=await readChannel(database,channelId); if(!channel||channel.status!=='ACTIVE')throw new AcquisitionError('NOT_FOUND',404);
  const acquired=await acquireAcquisitionCommand<{assignment:AcquisitionChannelAssignmentDto}>(database,command,'CREATE_ACQUISITION_CHANNEL_ASSIGNMENT','STAFF_ACQUISITION_ASSIGNMENT',`${staffId}:${input.leadType}:${effectiveFrom}`,{staff_id:staffId,lead_type:input.leadType,channel_id:channelId,effective_from:effectiveFrom,effective_until:effectiveUntil});
  if(acquired.acquired.kind==='REPLAY')return {...acquired.acquired.response,replayed:true}; const id=crypto.randomUUID();
  const assignment:AcquisitionChannelAssignmentDto={assignment_id:id,staff_id:staffId,lead_type:input.leadType,channel_id:channelId,channel_name:channel.display_name,effective_from:effectiveFrom,effective_until:effectiveUntil,status:'ACTIVE',version:1};
  await database.batch([
    database.prepare(`INSERT INTO acquisition_staff_channel_assignments(id,staff_id,lead_type,channel_id,effective_from,effective_until,status,version,created_by_staff_id,created_at,updated_at,revoked_at,revoke_reason)
      VALUES(?,?,?,?,?,?,'ACTIVE',1,?,?,?,NULL,NULL)`).bind(id,staffId,input.leadType,channelId,effectiveFrom,effectiveUntil,command.actor.staffId,acquired.now,acquired.now),
    ...finishAcquisitionCommand(database,acquired.acquired.claim,{assignment},acquired.now,{assignment_id:id}),
  ]);return {assignment,replayed:false};
}
export async function revokeAcquisitionAssignment(
  database:SqlDatabase,input:{assignmentId:string;expectedVersion:number;reason:string},command:AcquisitionCommandContext,
):Promise<Result<{assignment:AcquisitionChannelAssignmentDto}>>{
  requireAcquisitionAdmin(command.actor);const existing=await readAssignment(database,identifier(input.assignmentId));if(!existing)throw new AcquisitionError('NOT_FOUND',404);
  if(existing.status!=='ACTIVE'||existing.version!==version(input.expectedVersion))throw new AcquisitionError('VERSION_CONFLICT',409);const reason=text(input.reason,1000);
  const assignment={...toAssignment(existing),status:'REVOKED' as const,version:existing.version+1};
  await database.prepare(`UPDATE acquisition_staff_channel_assignments SET status='REVOKED',version=version+1,updated_at=?,revoked_at=?,revoke_reason=? WHERE id=? AND version=?`)
    .bind(Date.now(),Date.now(),reason,existing.id,existing.version).run();return {assignment,replayed:false};
}

export async function recordAcquisitionConsultation(
  database:SqlDatabase,input:{channelId:string;businessDate:string;personCount:number;expectedVersion:number;reason:string},command:AcquisitionCommandContext,
):Promise<Result<{consultation:AcquisitionDailyConsultationDto}>>{
  requireAcquisitionOperator(command.actor);const channelId=identifier(input.channelId);const channel=await readChannel(database,channelId);if(!channel||channel.status!=='ACTIVE')throw new AcquisitionError('NOT_FOUND',404);
  await requireOperatorMarket(database,command.actor,channel.marketplace_code);
  if(channel.lead_type==='BOTH')throw new AcquisitionError('CHANNEL_CONFIGURATION_AMBIGUOUS',409);
  let businessDate:string;try{businessDate=parseChinaBusinessDate(input.businessDate);}catch{validation();}
  const personCount=count(input.personCount);const expected=input.expectedVersion;if(!Number.isSafeInteger(expected)||expected<0)validation();const reason=text(input.reason,1000);
  const existing=await database.prepare(`SELECT id,channel_id,lead_type,business_date,person_count,version,updated_by_staff_id,created_at,updated_at FROM acquisition_daily_consultations WHERE channel_id=? AND business_date=?`).bind(channelId,businessDate).first<ConsultationRow>();
  if((!existing&&expected!==0)||(existing&&Number(existing.version)!==expected))throw new AcquisitionError('VERSION_CONFLICT',409);
  const acquired=await acquireAcquisitionCommand<{consultation:AcquisitionDailyConsultationDto}>(database,command,'RECORD_ACQUISITION_CONSULTATION','ACQUISITION_DAILY_CONSULTATION',`${channelId}:${businessDate}`,{channel_id:channelId,lead_type:channel.lead_type,business_date:businessDate,person_count:personCount,expected_version:expected,reason});
  if(acquired.acquired.kind==='REPLAY')return {...acquired.acquired.response,replayed:true};const id=existing?.id??crypto.randomUUID();const next=expected+1;
  const consultation:AcquisitionDailyConsultationDto={consultation_id:id,channel_id:channelId,lead_type:channel.lead_type,business_date:businessDate,person_count:personCount,version:next,updated_by_staff_id:command.actor.staffId,updated_at:acquired.now};
  const mutation:SqlStatement=existing?database.prepare(`UPDATE acquisition_daily_consultations SET person_count=?,version=version+1,updated_by_staff_id=?,updated_at=? WHERE id=? AND version=?`).bind(personCount,command.actor.staffId,acquired.now,id,expected):database.prepare(`INSERT INTO acquisition_daily_consultations(id,channel_id,lead_type,business_date,person_count,version,updated_by_staff_id,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)`).bind(id,channelId,channel.lead_type,businessDate,personCount,command.actor.staffId,acquired.now,acquired.now);
  await database.batch([mutation,database.prepare(`INSERT INTO acquisition_daily_consultation_events(id,consultation_id,event_type,previous_count,next_count,previous_version,next_version,actor_staff_id,idempotency_key,request_hash,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),id,existing?'CORRECTED':'RECORDED',existing?.person_count??null,personCount,existing?.version??null,next,command.actor.staffId,command.idempotencyKey,acquired.requestHash,reason,acquired.now),...finishAcquisitionCommand(database,acquired.acquired.claim,{consultation},acquired.now,{consultation_id:id})]);
  return {consultation,replayed:false};
}

export async function listAcquisitionChannels(database:SqlDatabase,actor:AssignmentStaffAuthorization):Promise<AcquisitionChannelDto[]>{
  if(actor.roles.has('buyer_refund'))throw new AcquisitionError('FORBIDDEN',403);
  const markets=actor.roles.has('owner')?[]:await resolveStaffMarketplaceCodes(database,actor);
  if(!actor.roles.has('owner')&&markets.length===0)return [];
  const audience=actor.roles.has('pre_sales')?'BUYER':actor.roles.has('seller_ops')?'SELLER':null;
  const clauses=[`1=1`];const bindings:unknown[]=[];
  if(markets.length){clauses.push(`marketplace_code IN (${markets.map(()=>'?').join(',')})`);bindings.push(...markets);}
  if(audience){clauses.push(`lead_type IN (?, 'BOTH')`);bindings.push(audience);}
  const rows=await database.prepare(`SELECT id,code,channel_type,platform_name,lead_type,marketplace_code,display_name,status,version,created_at,updated_at FROM acquisition_channels WHERE ${clauses.join(' AND ')} ORDER BY status,display_name,id`).bind(...bindings).all<ChannelRow>();
  return rows.results.map(toChannel);
}
export async function listAcquisitionAssignments(database:SqlDatabase,actor:AssignmentStaffAuthorization){requireAcquisitionAdmin(actor);const rows=await database.prepare(`SELECT assignment.id,assignment.staff_id,assignment.lead_type,assignment.channel_id,channel.display_name AS channel_name,assignment.effective_from,assignment.effective_until,assignment.status,assignment.version FROM acquisition_staff_channel_assignments assignment JOIN acquisition_channels channel ON channel.id=assignment.channel_id ORDER BY assignment.effective_from DESC,assignment.id DESC`).all<AssignmentRow>();return rows.results.map(toAssignment);}
export async function listAcquisitionConsultations(database:SqlDatabase,actor:AssignmentStaffAuthorization,fromDate:string,toDate:string){requireAcquisitionOperator(actor);let from:string,to:string;try{from=parseChinaBusinessDate(fromDate);to=parseChinaBusinessDate(toDate);}catch{validation();}if(from>to)validation();const markets=actor.roles.has('owner')?[]:await resolveStaffMarketplaceCodes(database,actor);if(!actor.roles.has('owner')&&markets.length===0)return [];const marketClause=markets.length?`AND channel.marketplace_code IN (${markets.map(()=>'?').join(',')})`:'';const rows=await database.prepare(`SELECT consultation.id,consultation.channel_id,consultation.lead_type,consultation.business_date,consultation.person_count,consultation.version,consultation.updated_by_staff_id,consultation.created_at,consultation.updated_at FROM acquisition_daily_consultations consultation JOIN acquisition_channels channel ON channel.id=consultation.channel_id WHERE consultation.business_date BETWEEN ? AND ? ${marketClause} ORDER BY consultation.business_date DESC,consultation.channel_id`).bind(from,to,...markets).all<ConsultationRow>();return rows.results.map(toConsultation);}
export async function listAcquisitionConsultationHistory(database:SqlDatabase,actor:AssignmentStaffAuthorization,consultationId:string):Promise<AcquisitionConsultationEventDto[]>{requireAcquisitionOperator(actor);const id=identifier(consultationId);const rows=await database.prepare(`SELECT event.id,event.event_type,event.previous_count,event.next_count,event.previous_version,event.next_version,event.actor_staff_id,event.reason,event.created_at FROM acquisition_daily_consultation_events event JOIN acquisition_daily_consultations consultation ON consultation.id=event.consultation_id JOIN acquisition_channels channel ON channel.id=consultation.channel_id WHERE event.consultation_id=? ORDER BY event.created_at,event.id`).bind(id).all<any>();return rows.results.map((row)=>({event_id:row.id,event_type:row.event_type,previous_count:row.previous_count===null?null:Number(row.previous_count),next_count:Number(row.next_count),previous_version:row.previous_version===null?null:Number(row.previous_version),next_version:Number(row.next_version),actor_staff_id:row.actor_staff_id,reason:row.reason,created_at:Number(row.created_at)}));}

async function requireOperatorMarket(database:SqlDatabase,actor:AssignmentStaffAuthorization,market:string):Promise<void>{if(actor.roles.has('owner'))return;const markets=await resolveStaffMarketplaceCodes(database,actor);if(!markets.includes(market))throw new AcquisitionError('FORBIDDEN',403);}
async function requireMarketplace(database:SqlDatabase,code:string):Promise<void>{const row=await database.prepare(`SELECT 1 AS present FROM marketplace_registry WHERE code=?`).bind(code).first();if(!row)validation();}
async function readChannel(database:SqlDatabase,id:string){return database.prepare(`SELECT id,code,channel_type,platform_name,lead_type,marketplace_code,display_name,status,version,created_at,updated_at FROM acquisition_channels WHERE id=?`).bind(id).first<ChannelRow>();}
async function readAssignment(database:SqlDatabase,id:string){return database.prepare(`SELECT assignment.id,assignment.staff_id,assignment.lead_type,assignment.channel_id,channel.display_name AS channel_name,assignment.effective_from,assignment.effective_until,assignment.status,assignment.version FROM acquisition_staff_channel_assignments assignment JOIN acquisition_channels channel ON channel.id=assignment.channel_id WHERE assignment.id=?`).bind(id).first<AssignmentRow>();}
function toChannel(row:ChannelRow):AcquisitionChannelDto{return{channel_id:row.id,code:row.code,channel_type:row.channel_type,platform_name:row.platform_name,lead_type:row.lead_type,marketplace_code:row.marketplace_code,display_name:row.display_name,status:row.status,version:Number(row.version),created_at:Number(row.created_at),updated_at:Number(row.updated_at)}}
function toAssignment(row:AssignmentRow):AcquisitionChannelAssignmentDto{return{assignment_id:row.id,staff_id:row.staff_id,lead_type:row.lead_type,channel_id:row.channel_id,channel_name:row.channel_name,effective_from:Number(row.effective_from),effective_until:row.effective_until===null?null:Number(row.effective_until),status:row.status,version:Number(row.version)}}
function toConsultation(row:ConsultationRow):AcquisitionDailyConsultationDto{return{consultation_id:row.id,channel_id:row.channel_id,lead_type:row.lead_type,business_date:row.business_date,person_count:Number(row.person_count),version:Number(row.version),updated_by_staff_id:row.updated_by_staff_id,updated_at:Number(row.updated_at)}}
function legacyType(platform:string):AcquisitionChannelType{const value=platform.toLocaleLowerCase('zh-CN');if(value.includes('小红书'))return'XIAOHONGSHU';if(value.includes('微信'))return'PRIVATE_WECHAT';if(value.includes('转介绍'))return'REFERRAL';return'OTHER';}
function audit(database:SqlDatabase,command:AcquisitionCommandContext,aggregateType:string,aggregateId:string,eventType:string,previousState:unknown,nextState:unknown,reason:string|null,createdAt:number){return createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType,aggregateId,eventType,actor:{type:'STAFF',id:command.actor.staffId,roles:[...command.actor.roles]},requestId:command.requestId,idempotencyKey:command.idempotencyKey,previousState,nextState,reason,createdAt});}
function assertion(database:SqlDatabase,query:string,bindings:unknown[]){return database.prepare(`INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN EXISTS(${query}) THEN 1 ELSE 0 END`).bind(...bindings);}
function identifier(value:string):string{if(typeof value!=='string'||value.length<1||value.length>200||/[\u0000-\u001f\u007f]/u.test(value))validation();return value;}
function normalizedCode(value:string):string{const code=value.normalize('NFKC').trim().toUpperCase();if(!/^[A-Z0-9_-]{2,40}$/u.test(code))validation();return code;}
function text(value:string,maximum:number):string{const normalized=value.normalize('NFKC').trim();if(normalized.length<1||normalized.length>maximum||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized))validation();return normalized;}
function version(value:number):number{if(!Number.isSafeInteger(value)||value<1)validation();return value;}
function epoch(value:number):number{if(!Number.isSafeInteger(value)||value<0)validation();return value;}
function count(value:number):number{if(!Number.isSafeInteger(value)||value<0||value>1_000_000)validation();return value;}
// kept for old migration-focused tests
export function consultationDayStart(value:string):number{return chinaBusinessDateStartEpoch(value);}
