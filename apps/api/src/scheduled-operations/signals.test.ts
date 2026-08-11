import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp } from '../app';
import {
  evaluatePersistedScheduledJobSignals,
  ingestScheduledOperationalSignal,
  LocalOperationalAlertSink,
  MemoryOperationalAlertSink,
  resolveOperationalAlertSink,
  recordLoginAnomalySignal,
} from './signals';

let database: SqliteDatabase|null=null;
afterEach(()=>{ database?.close(); database=null; vi.restoreAllMocks(); });

const id=(value:number)=>value.toString(16).padStart(64,'0');
const workerObservation=(value:number,observedAt:number,countValue=1)=>({observation_id:id(value),signal_type:'worker_5xx',summary_code:'WORKER_5XX_THRESHOLD',job_name:null,observation_state:'BREACH',observed_at:observedAt,count_value:countValue});

describe('scheduled operational signal evaluation',()=>{
  it('opens only at the threshold and makes duplicate observations idempotent',async()=>{
    database=createMigratedTestDatabase();
    const sink=new MemoryOperationalAlertSink();
    expect((await ingestScheduledOperationalSignal(database,workerObservation(1,1_000),{sink})).status).toBe('RESOLVED');
    expect((await ingestScheduledOperationalSignal(database,workerObservation(2,2_000),{sink})).status).toBe('RESOLVED');
    expect((await ingestScheduledOperationalSignal(database,workerObservation(2,2_000),{sink})).disposition).toBe('DUPLICATE');
    expect((await ingestScheduledOperationalSignal(database,workerObservation(3,3_000),{sink}))).toMatchObject({status:'OPEN',notification:'SENT',incident_version:1});
    expect(sink.notifications).toHaveLength(1);
    expect(sink.notifications[0]).toMatchObject({category:'worker',severity:'CRITICAL',summary_code:'WORKER_5XX_THRESHOLD',notification_kind:'OPENED',count_value:3});
    const state=await alertState(database,'worker_5xx','');
    expect(state).toMatchObject({status:'OPEN',window_count_value:3,threshold_count:3,threshold_window_ms:300_000,consecutive_breach_count:3,incident_version:1,version:3,last_notification_at:3_000});
    expect(await count(database,'scheduled_operational_signals')).toBe(3);
  });

  it('suppresses cooldown reminders, resolves after two healthy scans, and reopens a new incident',async()=>{
    database=createMigratedTestDatabase();
    const sink=new MemoryOperationalAlertSink();
    await ingestScheduledOperationalSignal(database,workerObservation(10,1_000,3),{sink});
    const suppressed=await ingestScheduledOperationalSignal(database,workerObservation(11,2_000),{sink});
    expect(suppressed.notification).toBe('SUPPRESSED');
    expect((await alertState(database,'worker_5xx',''))?.['suppressed_until']).toBe(1_801_000);
    await ingestScheduledOperationalSignal(database,workerObservation(12,1_802_000,3),{sink});
    expect(sink.notifications.map((entry)=>entry.notification_kind)).toEqual(['OPENED','REMINDER']);

    await ingestScheduledOperationalSignal(database,{...workerObservation(13,1_803_000,0),observation_state:'HEALTHY'} ,{sink});
    const resolved=await ingestScheduledOperationalSignal(database,{...workerObservation(14,1_804_000,0),observation_state:'HEALTHY'} ,{sink});
    expect(resolved).toMatchObject({status:'RESOLVED',notification:'SENT'});
    expect(sink.notifications.map((entry)=>entry.notification_kind)).toEqual(['OPENED','REMINDER','RESOLVED']);

    const recurrence=await ingestScheduledOperationalSignal(database,workerObservation(15,1_805_000,3),{sink});
    expect(recurrence).toMatchObject({status:'OPEN',notification:'SUPPRESSED',incident_version:2});
    expect((await alertState(database,'worker_5xx',''))).toMatchObject({status:'OPEN',incident_version:2,resolved_at:null});
  });

  it('requires three distinct healthy-window scans before sustained backlog opens',async()=>{
    database=createMigratedTestDatabase();
    database.exec("INSERT INTO scheduled_job_states(job_name,last_backlog_count,updated_at) VALUES('outbox_delivery',7,1000)");
    const sink=new MemoryOperationalAlertSink();
    await evaluatePersistedScheduledJobSignals(database,{evaluationId:id(101),now:2_000,sink});
    await evaluatePersistedScheduledJobSignals(database,{evaluationId:id(102),now:3_000,sink});
    const third=await evaluatePersistedScheduledJobSignals(database,{evaluationId:id(103),now:4_000,sink});
    expect(third.some((entry)=>entry.status==='OPEN' && entry.notification==='SENT')).toBe(true);
    expect(sink.notifications).toEqual([expect.objectContaining({signal_type:'backlog_sustained',job_name:'outbox_delivery',summary_code:'JOB_BACKLOG_SUSTAINED',count_value:3})]);
    const duplicate=await evaluatePersistedScheduledJobSignals(database,{evaluationId:id(103),now:4_000,sink});
    expect(duplicate.every((entry)=>entry.disposition==='DUPLICATE')).toBe(true);
    expect(sink.notifications).toHaveLength(1);
    expect(await count(database,'scheduled_operational_signals')).toBe(9);
  });

  it('derives stale success, stuck lease, and file failures from scheduler facts',async()=>{
    database=createMigratedTestDatabase();
    database.exec("INSERT INTO scheduled_job_states(job_name,lease_token,lease_expires_at,last_succeeded_at,last_failure_category,last_backlog_count,updated_at) VALUES('file_orphan_cleanup','stuck',1000,0,'file_cleanup_deferred',0,0)");
    const sink=new MemoryOperationalAlertSink();
    const now=6*60*60*1000+400_000;
    await evaluatePersistedScheduledJobSignals(database,{evaluationId:id(201),now,sink});
    await evaluatePersistedScheduledJobSignals(database,{evaluationId:id(202),now:now+1_000,sink});
    await evaluatePersistedScheduledJobSignals(database,{evaluationId:id(203),now:now+2_000,sink});
    expect(sink.notifications.map((entry)=>entry.signal_type).sort()).toEqual(['file_failure','job_stale','lease_stuck']);
    expect(await alertState(database,'job_stale','file_orphan_cleanup')).toMatchObject({status:'OPEN',category:'scheduler',severity:'WARNING'});
    expect(await alertState(database,'lease_stuck','file_orphan_cleanup')).toMatchObject({status:'OPEN',category:'scheduler',severity:'CRITICAL'});
    expect(await alertState(database,'file_failure','file_orphan_cleanup')).toMatchObject({status:'OPEN',category:'file',threshold_count:3});
  });

  it('uses a fixed authentication anomaly policy',async()=>{
    database=createMigratedTestDatabase();
    const sink=new MemoryOperationalAlertSink();
    for (let index=0;index<5;index+=1) await recordLoginAnomalySignal(database,{securityEventId:`safe-login-event-${index}`,observedAt:1_000+index,sink});
    expect((await recordLoginAnomalySignal(database,{securityEventId:'safe-login-event-0',observedAt:1_000,sink})).disposition).toBe('DUPLICATE');
    expect(sink.notifications).toEqual([
      expect.objectContaining({signal_type:'login_anomaly',category:'auth',severity:'CRITICAL',summary_code:'LOGIN_ANOMALY_DETECTED'}),
    ]);
  });

  it('contains sink failures and records a fixed primary-adapter failure signal',async()=>{
    database=createMigratedTestDatabase();
    const sink=new MemoryOperationalAlertSink(()=>true);
    const result=await ingestScheduledOperationalSignal(database,workerObservation(401,1_000,3),{sink});
    expect(result).toMatchObject({status:'OPEN',notification:'FAILED'});
    expect(sink.notifications).toHaveLength(0);
    expect(await alertState(database,'external_adapter_failure','')).toMatchObject({status:'OPEN',summary_code:'PRIMARY_ALERT_SINK_FAILURE',category:'external',severity:'CRITICAL',incident_version:1});
    expect(await count(database,'scheduled_operational_signals')).toBe(2);
  });

  it('automatically resolves event-based alerts after two quiet scheduled evaluations',async()=>{
    database=createMigratedTestDatabase();
    const sink=new MemoryOperationalAlertSink();
    await ingestScheduledOperationalSignal(database,workerObservation(460,1_000,3),{sink});
    await evaluatePersistedScheduledJobSignals(database,{evaluationId:id(461),now:301_001,sink});
    await evaluatePersistedScheduledJobSignals(database,{evaluationId:id(462),now:302_001,sink});
    expect(await alertState(database,'worker_5xx','','WORKER_5XX_THRESHOLD')).toMatchObject({status:'RESOLVED',consecutive_healthy_count:2});
    expect(sink.notifications.map((entry)=>entry.notification_kind)).toEqual(['OPENED','RESOLVED']);
  });

  it('defaults the primary adapter to disabled and validates local-only configuration',async()=>{
    expect(resolveOperationalAlertSink({})).toBeNull();
    expect(()=>resolveOperationalAlertSink({mode:'external'})).toThrow('invalid_operational_alert_mode');
    expect(()=>resolveOperationalAlertSink({mode:'disabled',localSink:new MemoryOperationalAlertSink()})).toThrow('operational_alert_sink_disabled_with_adapter');
    const facts:unknown[]=[];
    const local=new LocalOperationalAlertSink((notification)=>{facts.push(notification)});
    expect(resolveOperationalAlertSink({mode:'local',localSink:local})).toBe(local);
    await local.notify({signal_type:'login_anomaly',category:'auth',severity:'CRITICAL',summary_code:'LOGIN_ANOMALY_DETECTED',job_name:null,notification_kind:'OPENED',status:'OPEN',observed_at:1000,incident_version:1,count_value:5});
    expect(facts).toEqual([expect.objectContaining({summary_code:'LOGIN_ANOMALY_DETECTED'})]);
    expect(JSON.stringify(facts)).not.toMatch(/token|wechat|object_key|payload|error/u);
  });

  it('collects handled Worker 5xx responses without persisting route or exception detail',async()=>{
    database=createMigratedTestDatabase();
    const sink=new MemoryOperationalAlertSink();
    const app=createApp();
    app.get('/private/customer/:id',()=>new Response('safe failure',{status:503}));
    app.get('/unhandled',()=>{ throw new Error('token=private-customer-secret'); });
    vi.spyOn(console,'error').mockImplementation(()=>undefined);
    for (let index=0;index<3;index+=1) {
      const response=await app.request(`/private/customer/customer-${index}`,{}, {DB:database,OPERATIONAL_ALERT_MODE:'local',OPERATIONAL_ALERT_SINK:sink});
      expect(response.status).toBe(503);
    }
    expect((await app.request('/unhandled',{}, {DB:database,OPERATIONAL_ALERT_MODE:'local',OPERATIONAL_ALERT_SINK:sink})).status).toBe(500);
    expect(sink.notifications).toEqual([expect.objectContaining({signal_type:'worker_5xx',summary_code:'WORKER_5XX_THRESHOLD',category:'worker'})]);
    const serialized=JSON.stringify((await database.prepare('SELECT * FROM scheduled_operational_signals').all()).results);
    expect(serialized).not.toMatch(/private|customer|object_key|safe failure|token/u);
  });

  it('rejects arbitrary summaries, scopes, labels, and observation-id collisions',async()=>{
    database=createMigratedTestDatabase();
    const valid=workerObservation(501,1_000,1);
    await ingestScheduledOperationalSignal(database,valid);
    await expect(ingestScheduledOperationalSignal(database,{...valid,path:'/orders/private',token:'secret'})).rejects.toThrow('invalid_scheduled_operation_contract');
    await expect(ingestScheduledOperationalSignal(database,{...valid,count_value:2})).rejects.toThrow('scheduled_operational_signal_id_conflict');
    await expect(ingestScheduledOperationalSignal(database,{...workerObservation(502,2_000),summary_code:'LOGIN_ANOMALY_DETECTED'})).rejects.toThrow('invalid_scheduled_operational_signal_scope');
    await expect(ingestScheduledOperationalSignal(database,{...workerObservation(503,3_000),job_name:'outbox_delivery'})).rejects.toThrow('invalid_scheduled_operational_signal_scope');
    const columns=await database.prepare('PRAGMA table_info(scheduled_operational_signals)').all<{name:string}>();
    expect(columns.results.map((entry)=>entry.name)).toEqual(['id','signal_type','category','severity','summary_code','job_name','observation_state','observed_at','count_value','evaluated_at']);
    expect(JSON.stringify((await database.prepare('SELECT * FROM scheduled_operational_signals').all()).results)).not.toMatch(/orders|private|token|secret|wechat|object_key/u);
  });
});

async function alertState(db:SqliteDatabase,signalType:string,jobName:string,summaryCode?:string) {
  return summaryCode
    ? db.prepare('SELECT * FROM scheduled_alert_states WHERE signal_type=? AND job_name=? AND summary_code=?').bind(signalType,jobName,summaryCode).first<Record<string,unknown>>()
    : db.prepare('SELECT * FROM scheduled_alert_states WHERE signal_type=? AND job_name=?').bind(signalType,jobName).first<Record<string,unknown>>();
}

async function count(db:SqliteDatabase,table:'scheduled_operational_signals') {
  return Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{count:number}>())?.count??0);
}
