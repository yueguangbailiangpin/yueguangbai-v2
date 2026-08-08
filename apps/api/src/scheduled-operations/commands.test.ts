import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  replayScheduledDeadLetter,
  runScheduledOperationManually,
} from './commands';
import { runScheduledOperations } from './runner';
import { MockFeishuWorkbenchAdapter } from '../feishu-workbench/mock-adapter';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null});

describe('scheduled operation manual commands',()=>{
  it('runs once, replays the same result, and conflicts on a changed request',async()=>{
    database=createMigratedTestDatabase();
    seedOutbox(database,'manual-event');
    let sends=0;
    const dependencies={enabled:true,outboxAdapter:{deliver:async()=>{sends+=1}}};
    const first=await runScheduledOperationManually(database,dependencies,{jobName:'outbox_delivery',command:{reason_code:'OPERATOR_RETRY'}},commandContext('manual-command-key'));
    const replay=await runScheduledOperationManually(database,dependencies,{jobName:'outbox_delivery',command:{reason_code:'OPERATOR_RETRY'}},commandContext('manual-command-key'));
    expect(first).toEqual(replay);
    expect(first).toMatchObject({command_type:'RUN_JOB',outcome:'SUCCEEDED',run:{processed_count:1,succeeded_count:1}});
    expect(sends).toBe(1);
    await expect(runScheduledOperationManually(database,dependencies,{jobName:'outbox_delivery',command:{reason_code:'BACKLOG_RECOVERY'}},commandContext('manual-command-key'))).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT',status:409});
    expect(await count(database,'scheduled_manual_commands')).toBe(1);
    expect(await database.prepare("SELECT command_type,job_name,target_id,reason_code,staff_id,request_id,outcome,length(request_hash) AS hash_length FROM scheduled_manual_commands").first()).toEqual({command_type:'RUN_JOB',job_name:'outbox_delivery',target_id:'outbox_delivery',reason_code:'OPERATOR_RETRY',staff_id:'zz-phase3h-test-owner',request_id:'request-manual-command-key',outcome:'SUCCEEDED',hash_length:64});
    expect(await auditFacts(database,'SCHEDULED_OPERATION_MANUAL_RUN')).toHaveLength(1);
  });

  it('allows only one effective side effect for a concurrent double click',async()=>{
    database=createMigratedTestDatabase();
    seedOutbox(database,'manual-race-event');
    let enteredResolve!:()=>void; const entered=new Promise<void>((resolve)=>{enteredResolve=resolve});
    let releaseResolve!:()=>void; const release=new Promise<void>((resolve)=>{releaseResolve=resolve});
    let sends=0;
    const dependencies={enabled:true,outboxAdapter:{deliver:async()=>{sends+=1;enteredResolve();await release}}};
    const first=runScheduledOperationManually(database,dependencies,{jobName:'outbox_delivery',command:{reason_code:'OPERATOR_RETRY'}},commandContext('manual-race-key'));
    await entered;
    await expect(runScheduledOperationManually(database,dependencies,{jobName:'outbox_delivery',command:{reason_code:'OPERATOR_RETRY'}},commandContext('manual-race-key'))).rejects.toMatchObject({code:'REQUEST_IN_PROGRESS',status:409});
    releaseResolve();
    await expect(first).resolves.toMatchObject({outcome:'SUCCEEDED'});
    expect(sends).toBe(1);
  });

  it('requeues an exact quarantined event once without copying its payload',async()=>{
    database=createMigratedTestDatabase();
    seedDeadLetter(database,'dead-1','poison-event');
    let quarantinedSends=0;
    expect((await runScheduledOperations(database,{now:1500,only:'outbox_delivery',outboxAdapter:{deliver:async()=>{quarantinedSends+=1}}}))[0]?.processed_count).toBe(0);
    expect(quarantinedSends).toBe(0);
    await expect(replayScheduledDeadLetter(database,{enabled:true},{deadLetterId:'dead-1',command:{event_id:'mismatched-event',reason_code:'POISON_RECOVERY'}},commandContext('replay-mismatch-key'))).rejects.toMatchObject({code:'NOT_FOUND',status:404});
    const first=await replayScheduledDeadLetter(database,{enabled:true},{deadLetterId:'dead-1',command:{event_id:'poison-event',reason_code:'POISON_RECOVERY'}},commandContext('replay-command-key'));
    const replay=await replayScheduledDeadLetter(database,{enabled:true},{deadLetterId:'dead-1',command:{event_id:'poison-event',reason_code:'POISON_RECOVERY'}},commandContext('replay-command-key'));
    expect(first).toEqual(replay);
    expect(first).toMatchObject({command_type:'REPLAY_DEAD_LETTER',outcome:'SUCCEEDED'});
    expect(await database.prepare("SELECT replay_status,replayed_by_staff_id FROM scheduled_dead_letters WHERE id='dead-1'").first()).toEqual({replay_status:'REPLAYED',replayed_by_staff_id:'zz-phase3h-test-owner'});
    expect(await database.prepare("SELECT status,attempt_count,last_error FROM integration_outbox WHERE id='poison-event'").first()).toEqual({status:'PENDING',attempt_count:0,last_error:null});
    await expect(replayScheduledDeadLetter(database,{enabled:true},{deadLetterId:'dead-1',command:{event_id:'another-event',reason_code:'POISON_RECOVERY'}},commandContext('replay-command-key'))).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    await expect(replayScheduledDeadLetter(database,{enabled:true},{deadLetterId:'dead-1',command:{event_id:'poison-event',reason_code:'POISON_RECOVERY'}},commandContext('replay-already-key'))).rejects.toMatchObject({code:'NOT_FOUND',status:404});
    await expect(replayScheduledDeadLetter(database,{enabled:true},{deadLetterId:'missing-dead',command:{event_id:'poison-event',reason_code:'POISON_RECOVERY'}},commandContext('replay-missing-key'))).rejects.toMatchObject({code:'NOT_FOUND',status:404});
    seedDeadLetter(database,'dead-sent','sent-event');
    database.exec("UPDATE integration_outbox SET status='SENT',sent_at=2,last_error=NULL WHERE id='sent-event'");
    await expect(replayScheduledDeadLetter(database,{enabled:true},{deadLetterId:'dead-sent',command:{event_id:'sent-event',reason_code:'POISON_RECOVERY'}},commandContext('replay-sent-key'))).rejects.toMatchObject({code:'NOT_FOUND',status:404});
    const audit=await auditFacts(database,'SCHEDULED_OPERATION_DEAD_LETTER_REPLAY');
    expect(audit).toHaveLength(3);
    expect(audit.map((row)=>JSON.parse(String(row['next_state_json']))['outcome']).sort()).toEqual(['FAILED','FAILED','SUCCEEDED']);
    expect(JSON.stringify(audit)).not.toMatch(/payload|secret-value|object_key|token|wechat|amount|last_error/u);
    let sends=0;
    const delivered=await runScheduledOperations(database,{now:3000,only:'outbox_delivery',outboxAdapter:{deliver:async()=>{sends+=1}}});
    expect(delivered[0]).toMatchObject({outcome:'SUCCEEDED',processed_count:1});
    expect(sends).toBe(1);
  });

  it('prevents two different commands from concurrently replaying one dead letter',async()=>{
    database=createMigratedTestDatabase();
    seedDeadLetter(database,'dead-race','race-event');
    let enteredResolve!:()=>void; const entered=new Promise<void>((resolve)=>{enteredResolve=resolve});
    let releaseResolve!:()=>void; const release=new Promise<void>((resolve)=>{releaseResolve=resolve});
    const first=replayScheduledDeadLetter(database,{enabled:true,afterReplayClaimed:async()=>{enteredResolve();await release}},{deadLetterId:'dead-race',command:{event_id:'race-event',reason_code:'POISON_RECOVERY'}},commandContext('replay-race-one'));
    await entered;
    await expect(replayScheduledDeadLetter(database,{enabled:true},{deadLetterId:'dead-race',command:{event_id:'race-event',reason_code:'POISON_RECOVERY'}},commandContext('replay-race-two'))).rejects.toMatchObject({code:'REQUEST_IN_PROGRESS',status:409});
    releaseResolve();
    await expect(first).resolves.toMatchObject({outcome:'SUCCEEDED'});
    expect(await database.prepare("SELECT replay_status FROM scheduled_dead_letters WHERE id='dead-race'").first()).toEqual({replay_status:'REPLAYED'});
  });

  it('replays a quarantined STAFF_WORK_ITEM only to the fixed feishu_sync consumer',async()=>{
    database=createMigratedTestDatabase();
    database.exec("INSERT INTO scheduled_job_states(job_name,updated_at) VALUES('feishu_sync',1); INSERT INTO integration_outbox(id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES('feishu-poison','feishu-poison-key','WORK_ITEM_CHANGED','STAFF_WORK_ITEM','no-business-read','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','FAILED',1,NULL,NULL,5,'quarantined',1,1,NULL); INSERT INTO scheduled_dead_letters(id,job_name,source_kind,source_id,failure_category,attempt_count,quarantined_at) VALUES('feishu-dead','feishu_sync','OUTBOX','feishu-poison','adapter_unavailable',5,1)");
    const result=await replayScheduledDeadLetter(database,{enabled:true,feishuAdapter:new MockFeishuWorkbenchAdapter(),feishuWebOrigin:'https://staff.example.test',feishuTenantKey:'tenant-local'},{deadLetterId:'feishu-dead',command:{event_id:'feishu-poison',reason_code:'DEPENDENCY_RECOVERED'}},commandContext('replay-feishu-key'));
    expect(result).toMatchObject({job_name:'feishu_sync',outcome:'SUCCEEDED'});
    let genericCalls=0;
    expect((await runScheduledOperations(database,{now:2_000,only:'outbox_delivery',outboxAdapter:{deliver:async()=>{genericCalls+=1}}}))[0]).toMatchObject({processed_count:0});
    expect(genericCalls).toBe(0);
    expect((await runScheduledOperations(database,{now:2_000,only:'feishu_sync',feishuAdapter:new MockFeishuWorkbenchAdapter(),feishuWebOrigin:'https://staff.example.test',feishuTenantKey:'tenant-local'}))[0]).toMatchObject({processed_count:1,succeeded_count:1});
  });

  it('keeps feishu dead letters quarantined when its adapter or valid origin is absent',async()=>{
    database=createMigratedTestDatabase();
    seedFeishuDeadLetter(database,'feishu-no-adapter','feishu-no-adapter-event');
    const noAdapter=await replayScheduledDeadLetter(database,{enabled:true,feishuWebOrigin:'https://staff.example.test'},{deadLetterId:'feishu-no-adapter',command:{event_id:'feishu-no-adapter-event',reason_code:'DEPENDENCY_RECOVERED'}},commandContext('replay-feishu-no-adapter'));
    expect(noAdapter).toMatchObject({job_name:'feishu_sync',outcome:'DISABLED'});
    expect(await database.prepare("SELECT replay_status FROM scheduled_dead_letters WHERE id='feishu-no-adapter'").first()).toEqual({replay_status:'QUARANTINED'});
    expect(await database.prepare("SELECT status,attempt_count FROM integration_outbox WHERE id='feishu-no-adapter-event'").first()).toEqual({status:'FAILED',attempt_count:5});
    seedFeishuDeadLetter(database,'feishu-bad-origin','feishu-bad-origin-event');
    const badOrigin=await replayScheduledDeadLetter(database,{enabled:true,feishuAdapter:new MockFeishuWorkbenchAdapter(),feishuWebOrigin:'http://not-safe.example.test',feishuTenantKey:'tenant-local'},{deadLetterId:'feishu-bad-origin',command:{event_id:'feishu-bad-origin-event',reason_code:'DEPENDENCY_RECOVERED'}},commandContext('replay-feishu-bad-origin'));
    expect(badOrigin).toMatchObject({job_name:'feishu_sync',outcome:'DISABLED'});
    expect(await database.prepare("SELECT replay_status FROM scheduled_dead_letters WHERE id='feishu-bad-origin'").first()).toEqual({replay_status:'QUARANTINED'});
    expect(await database.prepare("SELECT status,attempt_count FROM integration_outbox WHERE id='feishu-bad-origin-event'").first()).toEqual({status:'FAILED',attempt_count:5});
  });

  it('applies global, per-job, and hard kill switches to manual commands and replay',async()=>{
    database=createMigratedTestDatabase();
    seedOutbox(database,'disabled-event');
    let sends=0; const adapter={deliver:async()=>{sends+=1}};
    const global=await runScheduledOperationManually(database,{enabled:false,outboxAdapter:adapter},{jobName:'outbox_delivery',command:{reason_code:'OPERATOR_RETRY'}},commandContext('global-disabled-key'));
    expect(global.outcome).toBe('DISABLED');
    database.exec("UPDATE scheduled_job_states SET enabled=0 WHERE job_name='outbox_delivery'");
    const perJob=await runScheduledOperationManually(database,{enabled:true,outboxAdapter:adapter},{jobName:'outbox_delivery',command:{reason_code:'OPERATOR_RETRY'}},commandContext('job-disabled-key'));
    const hard=await runScheduledOperationManually(database,{enabled:true},{jobName:'drive_archive',command:{reason_code:'OPERATOR_RETRY'}},commandContext('hard-disabled-key'));
    expect([perJob.outcome,hard.outcome]).toEqual(['DISABLED','DISABLED']);
    expect(sends).toBe(0);
    expect(await count(database,'scheduled_job_runs')).toBe(0);
    seedDeadLetter(database,'dead-disabled','disabled-replay-event');
    const replay=await replayScheduledDeadLetter(database,{enabled:false},{deadLetterId:'dead-disabled',command:{event_id:'disabled-replay-event',reason_code:'POISON_RECOVERY'}},commandContext('replay-disabled-key'));
    expect(replay.outcome).toBe('DISABLED');
    expect(await database.prepare("SELECT replay_status FROM scheduled_dead_letters WHERE id='dead-disabled'").first()).toEqual({replay_status:'QUARANTINED'});
  });

  it('requires an ACTIVE effective actor with the dedicated permission',async()=>{
    database=createMigratedTestDatabase();
    await expect(runScheduledOperationManually(database,{enabled:true},{jobName:'staff_auth_cleanup',command:{reason_code:'OPERATOR_RETRY'}},{...commandContext('missing-permission-key'),actor:actor([])})).rejects.toMatchObject({code:'FORBIDDEN',status:403});
    const inactive=actor(['SCHEDULED_OPERATIONS_RUN']); Reflect.set(inactive,'staffStatus','DISABLED');
    await expect(runScheduledOperationManually(database,{enabled:true},{jobName:'staff_auth_cleanup',command:{reason_code:'OPERATOR_RETRY'}},{...commandContext('inactive-actor-key'),actor:inactive})).rejects.toMatchObject({code:'FORBIDDEN',status:403});
    expect(await count(database,'scheduled_manual_commands')).toBe(0);
  });
});

function actor(permissions:readonly ('SCHEDULED_OPERATIONS_RUN')[]=['SCHEDULED_OPERATIONS_RUN']):AssignmentStaffAuthorization { return {staffId:'zz-phase3h-test-owner',displayName:'Owner',staffStatus:'ACTIVE',authorizationVersion:1,roles:new Set(['owner']),permissions:new Set(permissions),memberTeamIds:[],leaderTeamIds:[]}; }
function commandContext(idempotencyKey:string):{actor:AssignmentStaffAuthorization;idempotencyKey:string;requestId:string;now:number} { return {actor:actor(),idempotencyKey,requestId:`request-${idempotencyKey}`,now:2000}; }
function seedOutbox(db:SqliteDatabase,id:string) { db.exec(`INSERT INTO integration_outbox(id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES('${id}','dedup-${id}','TEST','TEST','aggregate','{"secret":"secret-value"}','${'a'.repeat(64)}','PENDING',1,NULL,NULL,0,NULL,1,1,NULL)`); }
function seedDeadLetter(db:SqliteDatabase,deadLetterId:string,eventId:string) { db.exec("INSERT OR IGNORE INTO scheduled_job_states(job_name,updated_at) VALUES('outbox_delivery',1)"); db.exec(`INSERT INTO integration_outbox(id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES('${eventId}','dedup-${eventId}','TEST','TEST','aggregate','{"secret":"secret-value"}','${'b'.repeat(64)}','FAILED',1,NULL,NULL,5,'quarantined',1,1,NULL); INSERT INTO scheduled_dead_letters(id,job_name,source_kind,source_id,failure_category,attempt_count,quarantined_at) VALUES('${deadLetterId}','outbox_delivery','OUTBOX','${eventId}','delivery_failed',5,1)`); }
function seedFeishuDeadLetter(db:SqliteDatabase,deadLetterId:string,eventId:string) { db.exec(`INSERT OR IGNORE INTO scheduled_job_states(job_name,updated_at) VALUES('feishu_sync',1); INSERT INTO integration_outbox(id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES('${eventId}','dedup-${eventId}','WORK_ITEM_CHANGED','STAFF_WORK_ITEM','no-business-read','{}','${'c'.repeat(64)}','FAILED',1,NULL,NULL,5,'quarantined',1,1,NULL); INSERT INTO scheduled_dead_letters(id,job_name,source_kind,source_id,failure_category,attempt_count,quarantined_at) VALUES('${deadLetterId}','feishu_sync','OUTBOX','${eventId}','provider_unavailable',5,1)`); }
async function count(db:SqliteDatabase,table:string) { return Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{count:number}>())?.count??0); }
async function auditFacts(db:SqliteDatabase,eventType:string) { return (await db.prepare('SELECT event_type,actor_id,request_id,idempotency_key,next_state_json,reason,metadata_json FROM audit_events WHERE event_type=? ORDER BY created_at,id').bind(eventType).all()).results; }
