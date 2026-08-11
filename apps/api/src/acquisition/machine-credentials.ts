import type { SqlDatabase } from '@ygb/contracts';
import { AcquisitionError } from './errors';

export interface AcquisitionMachineIdentity{
  machineId:string;machineName:string;marketplaceCodes:readonly string[];channelIds:readonly string[];
}

export async function createMachineCredential(
  database:SqlDatabase,
  input:{machineName:string;marketplaceCodes:readonly string[];channelIds:readonly string[];hourlyRequestLimit:number;createdByStaffId:string},
){
  const name=text(input.machineName,100);const markets=unique(input.marketplaceCodes);const channels=unique(input.channelIds);
  if(markets.length<1||channels.length<1||!Number.isSafeInteger(input.hourlyRequestLimit)||input.hourlyRequestLimit<1||input.hourlyRequestLimit>10000)validation();
  const placeholders=markets.map(()=>'?').join(',');const marketCount=await database.prepare(`SELECT COUNT(*) AS count FROM marketplace_registry WHERE code IN (${placeholders})`).bind(...markets).first<{count:number}>();if(Number(marketCount?.count??0)!==markets.length)validation();
  const channelPlaceholders=channels.map(()=>'?').join(',');const channelRows=await database.prepare(`SELECT id,marketplace_code,status FROM acquisition_channels WHERE id IN (${channelPlaceholders})`).bind(...channels).all<{id:string;marketplace_code:string;status:string}>();
  if(channelRows.results.length!==channels.length||channelRows.results.some((row)=>row.status!=='ACTIVE'||!markets.includes(row.marketplace_code)))validation();
  const secret=`mw_machine_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;const hash=await sha256(secret);const id=crypto.randomUUID(),now=Date.now();
  await database.batch([
    database.prepare(`INSERT INTO acquisition_machine_credentials(id,machine_name,secret_sha256,status,hourly_request_limit,created_by_staff_id,created_at,updated_at,revoked_at,revoked_by_staff_id) VALUES(?,?,?,'ACTIVE',?,?,?, ?,NULL,NULL)`).bind(id,name,hash,input.hourlyRequestLimit,input.createdByStaffId,now,now),
    ...markets.map((market)=>database.prepare(`INSERT INTO acquisition_machine_marketplaces(machine_id,marketplace_code,created_at) VALUES(?,?,?)`).bind(id,market,now)),
    ...channels.map((channel)=>database.prepare(`INSERT INTO acquisition_machine_channels(machine_id,channel_id,created_at) VALUES(?,?,?)`).bind(id,channel,now)),
  ]);
  return{machine_id:id,machine_name:name,machine_secret:secret,status:'ACTIVE' as const,hourly_request_limit:input.hourlyRequestLimit,marketplace_codes:markets,channel_ids:channels,created_at:now};
}

export async function listMachineCredentials(database:SqlDatabase){
  const rows=await database.prepare(`SELECT credential.id,credential.machine_name,credential.status,credential.hourly_request_limit,credential.created_at,credential.revoked_at,
    (SELECT json_group_array(marketplace_code) FROM acquisition_machine_marketplaces scope WHERE scope.machine_id=credential.id) AS marketplaces_json,
    (SELECT json_group_array(channel_id) FROM acquisition_machine_channels scope WHERE scope.machine_id=credential.id) AS channels_json
    FROM acquisition_machine_credentials credential ORDER BY credential.status,credential.created_at DESC,credential.id DESC`).all<any>();
  return rows.results.map((row)=>({machine_id:String(row.id),machine_name:String(row.machine_name),status:row.status as 'ACTIVE'|'REVOKED',hourly_request_limit:Number(row.hourly_request_limit),marketplace_codes:jsonArray(row.marketplaces_json),channel_ids:jsonArray(row.channels_json),created_at:Number(row.created_at),revoked_at:row.revoked_at===null?null:Number(row.revoked_at)}));
}

export async function revokeMachineCredential(database:SqlDatabase,machineId:string,staffId:string){
  const now=Date.now();const result=await database.prepare(`UPDATE acquisition_machine_credentials SET status='REVOKED',revoked_at=?,revoked_by_staff_id=?,updated_at=? WHERE id=? AND status='ACTIVE'`).bind(now,staffId,now,clean(machineId)).run();
  if(Number(result.meta.changes)!==1)throw new AcquisitionError('STATE_CONFLICT',409);
  return{machine_id:machineId,status:'REVOKED' as const,revoked_at:now};
}

export async function authenticateAcquisitionMachine(database:SqlDatabase,request:Request,now=Date.now()):Promise<AcquisitionMachineIdentity>{
  const authorization=request.headers.get('Authorization')?.trim()??'';if(!authorization.startsWith('Bearer '))throw new AcquisitionError('UNAUTHENTICATED',401);
  const secret=authorization.slice(7);if(secret.length<32||secret.length>1000)throw new AcquisitionError('UNAUTHENTICATED',401);
  const hash=await sha256(secret);
  const row=await database.prepare(`SELECT id,machine_name,hourly_request_limit FROM acquisition_machine_credentials WHERE secret_sha256=? AND status='ACTIVE'`).bind(hash).first<{id:string;machine_name:string;hourly_request_limit:number}>();if(!row)throw new AcquisitionError('UNAUTHENTICATED',401);
  const bucket=Math.floor(now/3_600_000);const count=await database.prepare(`INSERT INTO acquisition_machine_rate_buckets(machine_id,bucket_hour,request_count,updated_at) VALUES(?,?,1,?)
    ON CONFLICT(machine_id,bucket_hour) DO UPDATE SET request_count=request_count+1,updated_at=excluded.updated_at RETURNING request_count`).bind(row.id,bucket,now).first<{request_count:number}>();
  if(Number(count?.request_count??0)>Number(row.hourly_request_limit))throw new AcquisitionError('RATE_LIMITED',429 as never);
  const [markets,channels]=await Promise.all([
    database.prepare(`SELECT marketplace_code FROM acquisition_machine_marketplaces WHERE machine_id=? ORDER BY marketplace_code`).bind(row.id).all<{marketplace_code:string}>(),
    database.prepare(`SELECT channel_id FROM acquisition_machine_channels WHERE machine_id=? ORDER BY channel_id`).bind(row.id).all<{channel_id:string}>(),
  ]);
  return{machineId:row.id,machineName:row.machine_name,marketplaceCodes:markets.results.map((value)=>value.marketplace_code),channelIds:channels.results.map((value)=>value.channel_id)};
}

export function requireMachineScope(machine:AcquisitionMachineIdentity,marketplaceCode:string,channelId:string){if(!machine.marketplaceCodes.includes(marketplaceCode)||!machine.channelIds.includes(channelId))throw new AcquisitionError('FORBIDDEN',403);}

async function sha256(value:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));return [...bytes].map((byte)=>byte.toString(16).padStart(2,'0')).join('');}
function base64Url(bytes:Uint8Array){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');}
function unique(values:readonly string[]){return [...new Set(values.map(clean))].sort();}
function clean(value:string){const normalized=String(value).normalize('NFKC').trim();if(normalized.length<1||normalized.length>200||/[\u0000-\u001f\u007f]/u.test(normalized))validation();return normalized;}
function text(value:string,max:number){const normalized=clean(value);if(normalized.length>max)validation();return normalized;}
function jsonArray(value:unknown):string[]{try{const parsed=JSON.parse(String(value??'[]'));return Array.isArray(parsed)&&parsed.every((item)=>typeof item==='string')?parsed:[];}catch{return[];}}
function validation():never{throw new AcquisitionError('VALIDATION_ERROR',400);}
