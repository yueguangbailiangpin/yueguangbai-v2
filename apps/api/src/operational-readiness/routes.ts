import { apiSuccess,type ObjectStorageAdapter,type SqlDatabase } from '@ygb/contracts';
import type { Hono } from 'hono';
import { safeResolveOperationalAlertSink, type OperationalAlertSink } from '../scheduled-operations/signals';
import { operationalAlertAttestationReady } from './alert-attestation';

const TARGET_SCHEMA=65;
const MAX_JOB_STALENESS_MS=6*60*60*1000;
const MAX_ACQUISITION_STALENESS_MS=24*60*60*1000;
const MAX_JOB_BACKLOG=1000;
const REQUIRED_JOBS=['reservation_expiry','instruction_expiry','outbox_delivery','file_orphan_cleanup'] as const;

export function registerOperationalReadinessRoutes(app:Hono<any>):void{
  app.get('/ready',async(context)=>{
    const now=Date.now();
    const result=await evaluateReadiness(context.env.DB,context.env.FILE_OBJECT_STORAGE??null,context.env,now)
      .catch(()=>({ready:false,schema:false,scheduler:false,acquisition_maintenance:false,operational_alerts:false,object_storage:false,recovery:false,staff_access:false,release:false}));
    context.header('Cache-Control','no-store');
    return context.json(apiSuccess({
      status:result.ready?'ready' as const:'not_ready' as const,
      checks:{
        schema:result.schema?'ok':'failed',scheduler:result.scheduler?'ok':'failed',
        acquisition_maintenance:result.acquisition_maintenance?'ok':'failed',operational_alerts:result.operational_alerts?'ok':'failed',object_storage:result.object_storage?'ok':'failed',
        recovery:result.recovery?'ok':'failed',staff_access:result.staff_access?'ok':'failed',release:result.release?'ok':'failed',
      },timestamp:now,
    },String(context.get('requestId')??crypto.randomUUID())),result.ready?200:503);
  });
}

async function evaluateReadiness(database:SqlDatabase,storage:ObjectStorageAdapter|null,bindings:Record<string,unknown>,now:number){
  const schemaRow=await database.prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`).first<{schema_version:number}>();
  const schema=Number(schemaRow?.schema_version)===TARGET_SCHEMA;
  const jobs=await database.prepare(`SELECT job_name,last_succeeded_at,last_failed_at,last_backlog_count FROM scheduled_job_states WHERE job_name IN (${REQUIRED_JOBS.map(()=>'?').join(',')})`).bind(...REQUIRED_JOBS).all<{job_name:string;last_succeeded_at:number|null;last_failed_at:number|null;last_backlog_count:number|null}>();
  const byName=new Map(jobs.results.map((row)=>[row.job_name,row]));
  const schedulerEnabled=bindings['SCHEDULED_OPERATIONS_ENABLED']==='true';
  const scheduler=schedulerEnabled&&REQUIRED_JOBS.every((name)=>{
    const row=byName.get(name);if(!row||row.last_succeeded_at===null)return false;
    const succeeded=Number(row.last_succeeded_at),failed=row.last_failed_at===null?null:Number(row.last_failed_at),backlog=row.last_backlog_count===null?0:Number(row.last_backlog_count);
    return now-succeeded<=MAX_JOB_STALENESS_MS&&(failed===null||succeeded>=failed)&&Number.isSafeInteger(backlog)&&backlog>=0&&backlog<=MAX_JOB_BACKLOG;
  });
  const maintenance=await database.prepare(`SELECT last_succeeded_at,last_failed_at FROM acquisition_maintenance_state WHERE singleton_id=1`).first<{last_succeeded_at:number|null;last_failed_at:number|null}>();
  const maintenanceSucceeded=maintenance?.last_succeeded_at==null?null:Number(maintenance.last_succeeded_at),maintenanceFailed=maintenance?.last_failed_at==null?null:Number(maintenance.last_failed_at);
  const acquisition_maintenance=bindings['ACQUISITION_MAINTENANCE_ENABLED']==='true'&&maintenanceSucceeded!==null&&now-maintenanceSucceeded<=MAX_ACQUISITION_STALENESS_MS&&(maintenanceFailed===null||maintenanceSucceeded>=maintenanceFailed);
  const operational_alerts=await operationalAlertsReady(database,bindings,now);
  const object_storage=await storageReady(database,storage);
  const runningRelease=releaseSha(bindings['APP_RELEASE_SHA']);const release=runningRelease!==null;
  const recoveryRow=await database.prepare(`SELECT release_sha,schema_version FROM production_recovery_attestations WHERE schema_version=? ORDER BY verified_at DESC,id DESC LIMIT 1`).bind(TARGET_SCHEMA).first<{release_sha:string;schema_version:number}>();
  const recovery=release&&Number(recoveryRow?.schema_version??0)===TARGET_SCHEMA&&String(recoveryRow?.release_sha??'').toLowerCase()===runningRelease;
  const staff_access=validAccessConfig(bindings['STAFF_ACCESS_TEAM_DOMAIN'],bindings['STAFF_ACCESS_AUD']);
  return{ready:schema&&scheduler&&acquisition_maintenance&&operational_alerts&&object_storage&&recovery&&staff_access&&release,schema,scheduler,acquisition_maintenance,operational_alerts,object_storage,recovery,staff_access,release};
}

async function operationalAlertsReady(database:SqlDatabase,bindings:Record<string,unknown>,now:number):Promise<boolean>{
  const environment=bindings['APP_ENVIRONMENT'];
  const mode=bindings['OPERATIONAL_ALERT_MODE'];
  const injected=bindings['OPERATIONAL_ALERT_SINK'];
  const sink=safeResolveOperationalAlertSink({
    ...(typeof mode==='string'?{mode}:{}),
    ...(injected&&typeof injected==='object'&&'notify' in injected&&mode==='bound'?{boundSink:injected as OperationalAlertSink}:{}),
    ...(injected&&typeof injected==='object'&&'notify' in injected&&mode!=='bound'?{localSink:injected as OperationalAlertSink}:{}),
  });
  if(environment==='production')return mode==='bound'&&sink!==null&&await operationalAlertAttestationReady(database,bindings,now);
  if(environment==='local')return(mode==='disabled'&&injected===undefined)||(mode==='local'&&sink!==null);
  if(environment==='staging')return mode==='disabled'&&injected===undefined;
  return false;
}

async function storageReady(database:SqlDatabase,storage:ObjectStorageAdapter|null):Promise<boolean>{
  if(!storage)return false;
  const row=await database.prepare(`SELECT object_key,uploaded_byte_size,uploaded_sha256 FROM file_objects WHERE status='VERIFIED' AND uploaded_byte_size IS NOT NULL AND uploaded_sha256 IS NOT NULL ORDER BY rowid DESC LIMIT 1`).first<{object_key:string;uploaded_byte_size:number;uploaded_sha256:string}>();
  if(!row)return true;const head=await storage.headObject(row.object_key).catch(()=>null);
  return Boolean(head&&head.byteSize===Number(row.uploaded_byte_size)&&head.checksumSha256===row.uploaded_sha256);
}
function releaseSha(value:unknown):string|null{if(typeof value!=='string')return null;const normalized=value.trim().toLowerCase();return /^[0-9a-f]{7,64}$/u.test(normalized)?normalized:null;}
function validAccessConfig(domain:unknown,aud:unknown):boolean{
  if(typeof domain!=='string'||typeof aud!=='string'||aud.trim().length<8||aud.startsWith('REQUIRED_'))return false;
  try{const url=new URL(domain.trim());return url.protocol==='https:'&&url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password&&!domain.includes('REQUIRED_');}catch{return false;}
}
