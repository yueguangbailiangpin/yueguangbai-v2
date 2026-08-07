import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { AppBindings, AppEnv } from '../app';
import { registerScheduledOperationRoutes } from './routes';
import { ingestScheduledOperationalSignal } from './signals';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null});

describe('scheduled operation Staff HTTP contract',()=>{
  it('returns only Staff-safe capability scopes and enforces AUDIT_VIEW',async()=>{
    database=createMigratedTestDatabase();
    await ingestScheduledOperationalSignal(database,{observation_id:'a'.repeat(64),signal_type:'login_anomaly',summary_code:'LOGIN_ANOMALY_DETECTED',job_name:null,observation_state:'BREACH',observed_at:1000,count_value:5});
    const app=createTestApp();
    const bindings:AppBindings={DB:database};
    const denied=await app.request('http://local/api/staff/operations/health',{},bindings);
    expect(denied.status).toBe(403);
    expect((await app.request('http://local/api/staff/operations/health',{headers:{'X-Test-Permission':'deny'}},bindings)).status).toBe(403);
    const response=await app.request('http://local/api/staff/operations/health',{headers:{'X-Test-Permission':'audit'}},bindings);
    expect(response.status).toBe(200);
    const body=await response.json() as {data:{jobs:Array<Record<string,unknown>>;alerts:Array<Record<string,unknown>>;time_basis:string;display_timezone:string}};
    expect(body.data.jobs).toHaveLength(7);
    expect(Object.fromEntries(body.data.jobs.map(j=>[j['job_name'],j['capability_scope']]))).toEqual({reservation_expiry:'ALL_ENABLED_MARKETPLACES',instruction_expiry:'LEGACY_JP_ONLY',outbox_delivery:'ALL_ENABLED_MARKETPLACES',file_orphan_cleanup:'ALL_ENABLED_MARKETPLACES',staff_auth_cleanup:'ALL_ENABLED_MARKETPLACES',drive_archive:'HARD_DISABLED',feishu_sync:'HARD_DISABLED'});
    expect(body.data.jobs.filter((job)=>job['capability_scope']==='HARD_DISABLED').every((job)=>job['enabled']===false)).toBe(true);
    expect(body.data.alerts).toEqual([expect.objectContaining({signal_type:'login_anomaly',category:'auth',severity:'CRITICAL',summary_code:'LOGIN_ANOMALY_DETECTED',status:'OPEN',time_basis:'UTC_MS',display_timezone:'Asia/Shanghai'})]);
    expect([body.data.time_basis,body.data.display_timezone]).toEqual(['UTC_MS','Asia/Shanghai']);
    expect(JSON.stringify(body)).not.toMatch(/object_key|payload_json|token|wechat|last_error/u);
  });

  it('protects alert ACK with the run permission and HTTP idempotency contract',async()=>{
    database=createMigratedTestDatabase();
    await ingestScheduledOperationalSignal(database,{observation_id:'b'.repeat(64),signal_type:'login_anomaly',summary_code:'LOGIN_ANOMALY_DETECTED',job_name:null,observation_state:'BREACH',observed_at:1000,count_value:5});
    const app=createTestApp(); const bindings:AppBindings={DB:database};
    const command={signal_type:'login_anomaly',summary_code:'LOGIN_ANOMALY_DETECTED',job_name:null,incident_version:1};
    const base={method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'http-alert-ack-key'},body:JSON.stringify(command)};
    expect((await app.request('http://local/api/staff/operations/alerts/ack',{...base,headers:{...base.headers,'X-Test-Permission':'audit'}},bindings)).status).toBe(403);
    const authorized={...base,headers:{...base.headers,'X-Test-Permission':'run'}};
    const first=await app.request('http://local/api/staff/operations/alerts/ack',authorized,bindings);
    const replay=await app.request('http://local/api/staff/operations/alerts/ack',authorized,bindings);
    expect([first.status,replay.status]).toEqual([200,200]);
    expect(await first.json()).toEqual(await replay.json());
    const conflict=await app.request('http://local/api/staff/operations/alerts/ack',{...authorized,body:JSON.stringify({...command,incident_version:2})},bindings);
    expect(conflict.status).toBe(409);
    const already=await app.request('http://local/api/staff/operations/alerts/ack',{...authorized,headers:{...authorized.headers,'Idempotency-Key':'http-alert-state-key'}},bindings);
    expect(already.status).toBe(409);
    const unknown=await app.request('http://local/api/staff/operations/alerts/ack',{...authorized,headers:{...authorized.headers,'Idempotency-Key':'http-alert-unknown-key'},body:JSON.stringify({...command,payload_json:'secret'})},bindings);
    expect(unknown.status).toBe(400);
    expect(JSON.stringify((await database.prepare("SELECT next_state_json,metadata_json FROM audit_events WHERE event_type='SCHEDULED_OPERATION_ALERT_ACKNOWLEDGED'").all()).results)).not.toMatch(/secret|payload|token|wechat|object_key|error/u);
  });

  it('enforces permission and strict idempotent manual-run HTTP commands',async()=>{
    database=createMigratedTestDatabase();
    seedOutbox(database,'http-manual-event');
    let sends=0;
    const bindings:AppBindings={DB:database,SCHEDULED_OPERATIONS_ENABLED:'true',OUTBOX_DELIVERY_ADAPTER:{deliver:async()=>{sends+=1}}};
    const app=createTestApp();
    const request={method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'http-manual-key'},body:JSON.stringify({reason_code:'OPERATOR_RETRY'})};
    expect((await app.request('http://local/api/staff/operations/jobs/outbox_delivery/retry',request,bindings)).status).toBe(403);
    const authorized={...request,headers:{...request.headers,'X-Test-Permission':'run'}};
    expect((await app.request('http://local/api/staff/operations/jobs/outbox_delivery/retry',{...authorized,headers:{'Content-Type':'application/json','X-Test-Permission':'run'}},bindings)).status).toBe(400);
    const first=await app.request('http://local/api/staff/operations/jobs/outbox_delivery/retry',authorized,bindings);
    const replay=await app.request('http://local/api/staff/operations/jobs/outbox_delivery/retry',authorized,bindings);
    expect([first.status,replay.status,sends]).toEqual([200,200,1]);
    expect(await first.json()).toEqual(await replay.json());
    const conflict=await app.request('http://local/api/staff/operations/jobs/outbox_delivery/retry',{...authorized,body:JSON.stringify({reason_code:'BACKLOG_RECOVERY'})},bindings);
    expect(conflict.status).toBe(409);
    const unknown=await app.request('http://local/api/staff/operations/jobs/outbox_delivery/retry',{...authorized,headers:{...authorized.headers,'Idempotency-Key':'http-unknown-key'},body:JSON.stringify({reason_code:'OPERATOR_RETRY',payload_json:'secret'})},bindings);
    expect(unknown.status).toBe(400);
    expect((await app.request('http://local/api/staff/operations/jobs/not-a-job/retry',{...authorized,headers:{...authorized.headers,'Idempotency-Key':'http-invalid-job'}},bindings)).status).toBe(400);
  });

  it('conceals missing or handled dead letters and applies the replay kill switch',async()=>{
    database=createMigratedTestDatabase();
    seedDeadLetter(database,'http-dead','http-poison-event');
    const app=createTestApp();
    const bindings:AppBindings={DB:database,SCHEDULED_OPERATIONS_ENABLED:'false'};
    const request={method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'http-replay-disabled','X-Test-Permission':'run'},body:JSON.stringify({event_id:'http-poison-event',reason_code:'POISON_RECOVERY'})};
    const disabled=await app.request('http://local/api/staff/operations/dead-letters/http-dead/replay',request,bindings);
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toMatchObject({data:{command:{outcome:'DISABLED'}}});
    expect(await database.prepare("SELECT replay_status FROM scheduled_dead_letters WHERE id='http-dead'").first()).toEqual({replay_status:'QUARANTINED'});
    bindings.SCHEDULED_OPERATIONS_ENABLED='true';
    const replayed=await app.request('http://local/api/staff/operations/dead-letters/http-dead/replay',{...request,headers:{...request.headers,'Idempotency-Key':'http-replay-success'}},bindings);
    expect(replayed.status).toBe(200);
    const handled=await app.request('http://local/api/staff/operations/dead-letters/http-dead/replay',{...request,headers:{...request.headers,'Idempotency-Key':'http-replay-handled'}},bindings);
    const missing=await app.request('http://local/api/staff/operations/dead-letters/missing/replay',{...request,headers:{...request.headers,'Idempotency-Key':'http-replay-missing'}},bindings);
    expect([handled.status,missing.status]).toEqual([404,404]);
    expect(JSON.stringify(await replayed.json())).not.toMatch(/payload|secret|object_key|token|wechat|last_error/u);
  });
});

function createTestApp() { const app=new Hono<AppEnv>(); app.use('*',async(context,next)=>{context.set('requestId','request-scheduled-http'); const permission=context.req.header('X-Test-Permission'); if (permission) context.set('staffAuthorization',{staffId:'zz-phase3h-test-owner',displayName:'Owner',staffStatus:'ACTIVE',authorizationVersion:1,roles:new Set(['owner']),permissions:new Set(permission==='run'?['SCHEDULED_OPERATIONS_RUN']:permission==='audit'?['AUDIT_VIEW']:[]),memberTeamIds:[],leaderTeamIds:[]}); await next()}); registerScheduledOperationRoutes(app); return app; }
function seedOutbox(db:SqliteDatabase,id:string) { db.exec(`INSERT INTO integration_outbox(id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES('${id}','dedup-${id}','TEST','TEST','aggregate','{}','${'c'.repeat(64)}','PENDING',1,NULL,NULL,0,NULL,1,1,NULL)`); }
function seedDeadLetter(db:SqliteDatabase,deadLetterId:string,eventId:string) { db.exec("INSERT INTO scheduled_job_states(job_name,updated_at) VALUES('outbox_delivery',1)"); db.exec(`INSERT INTO integration_outbox(id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES('${eventId}','dedup-${eventId}','TEST','TEST','aggregate','{}','${'d'.repeat(64)}','FAILED',1,NULL,NULL,5,'quarantined',1,1,NULL); INSERT INTO scheduled_dead_letters(id,job_name,source_kind,source_id,failure_category,attempt_count,quarantined_at) VALUES('${deadLetterId}','outbox_delivery','OUTBOX','${eventId}','delivery_failed',5,1)`); }
