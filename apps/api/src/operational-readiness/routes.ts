import { apiSuccess, type ObjectStorageAdapter, type SqlDatabase } from '@ygb/contracts';
import type { Hono } from 'hono';

const TARGET_SCHEMA=58;
const MAX_JOB_STALENESS_MS=6*60*60*1000;
const MAX_ACQUISITION_STALENESS_MS=24*60*60*1000;
const REQUIRED_JOBS=['reservation_expiry','instruction_expiry','outbox_delivery','file_orphan_cleanup','staff_auth_cleanup'] as const;

export function registerOperationalReadinessRoutes(app:Hono<any>):void{
  app.get('/ready',async(context)=>{
    const now=Date.now();
    const result=await evaluateReadiness(context.env.DB,context.env.FILE_OBJECT_STORAGE??null,now).catch(()=>({
      ready:false,schema:false,scheduler:false,acquisition_maintenance:false,object_storage:false,recovery:false,
    }));
    context.header('Cache-Control','no-store');
    return context.json(apiSuccess({status:result.ready?'ready' as const:'not_ready' as const,checks:{
      schema:result.schema?'ok':'failed',scheduler:result.scheduler?'ok':'failed',
      acquisition_maintenance:result.acquisition_maintenance?'ok':'failed',object_storage:result.object_storage?'ok':'failed',
      recovery:result.recovery?'ok':'failed',
    },timestamp:now},String(context.get('requestId')??crypto.randomUUID())),result.ready?200:503);
  });
}

async function evaluateReadiness(database:SqlDatabase,storage:ObjectStorageAdapter|null,now:number){
  const schemaRow=await database.prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`).first<{schema_version:number}>();
  const schema=Number(schemaRow?.schema_version)===TARGET_SCHEMA;
  const jobs=await database.prepare(`SELECT job_name,last_succeeded_at,last_failed_at,last_backlog_count
    FROM scheduled_job_states WHERE job_name IN (${REQUIRED_JOBS.map(()=>'?').join(',')})`).bind(...REQUIRED_JOBS).all<{job_name:string;last_succeeded_at:number|null;last_failed_at:number|null;last_backlog_count:number|null}>();
  const byName=new Map(jobs.results.map((row)=>[row.job_name,row]));
  const scheduler=REQUIRED_JOBS.every((name)=>{
    const row=byName.get(name);if(!row||row.last_succeeded_at===null)return false;
    const succeeded=Number(row.last_succeeded_at);const failed=row.last_failed_at===null?null:Number(row.last_failed_at);
    return now-succeeded<=MAX_JOB_STALENESS_MS&&(failed===null||succeeded>=failed);
  });
  const maintenance=await database.prepare(`SELECT last_succeeded_at,last_failed_at FROM acquisition_maintenance_state WHERE singleton_id=1`).first<{last_succeeded_at:number|null;last_failed_at:number|null}>();
  const maintenanceSucceeded=maintenance?.last_succeeded_at===null||maintenance?.last_succeeded_at===undefined?null:Number(maintenance.last_succeeded_at);
  const maintenanceFailed=maintenance?.last_failed_at===null||maintenance?.last_failed_at===undefined?null:Number(maintenance.last_failed_at);
  const acquisition_maintenance=maintenanceSucceeded!==null&&now-maintenanceSucceeded<=MAX_ACQUISITION_STALENESS_MS&&(maintenanceFailed===null||maintenanceSucceeded>=maintenanceFailed);
  const object_storage=await storageReady(database,storage);
  const recoveryRow=await database.prepare(`SELECT schema_version FROM production_recovery_attestations ORDER BY schema_version DESC,verified_at DESC,id DESC LIMIT 1`).first<{schema_version:number}>();
  const recovery=Number(recoveryRow?.schema_version??0)>=TARGET_SCHEMA;
  return{ready:schema&&scheduler&&acquisition_maintenance&&object_storage&&recovery,schema,scheduler,acquisition_maintenance,object_storage,recovery};
}

async function storageReady(database:SqlDatabase,storage:ObjectStorageAdapter|null):Promise<boolean>{
  if(!storage)return false;
  const row=await database.prepare(`SELECT object_key,uploaded_byte_size,uploaded_sha256 FROM file_objects
    WHERE status='VERIFIED' AND uploaded_byte_size IS NOT NULL AND uploaded_sha256 IS NOT NULL
    ORDER BY rowid DESC LIMIT 1`).first<{object_key:string;uploaded_byte_size:number;uploaded_sha256:string}>();
  if(!row)return true;
  const head=await storage.headObject(row.object_key).catch(()=>null);
  return Boolean(head&&head.byteSize===Number(row.uploaded_byte_size)&&head.checksumSha256===row.uploaded_sha256);
}
