import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  acknowledgeScheduledOperationalAlert,
  readScheduledOperationalAlerts,
} from './alerts';
import { ingestScheduledOperationalSignal } from './signals';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null});
const id=(value:number)=>value.toString(16).padStart(64,'0');

describe('scheduled operational alert Staff services',()=>{
  it('projects only the strict UTC-ms Staff-safe alert summary',async()=>{
    database=createMigratedTestDatabase();
    await openLoginAlert(database);
    const alerts=await readScheduledOperationalAlerts(database);
    expect(alerts).toEqual([expect.objectContaining({signal_type:'login_anomaly',category:'auth',severity:'CRITICAL',summary_code:'LOGIN_ANOMALY_DETECTED',job_name:null,status:'OPEN',incident_version:1,time_basis:'UTC_MS',display_timezone:'Asia/Shanghai'})]);
    expect(JSON.stringify(alerts)).not.toMatch(/observation_id|object_key|payload|token|wechat|password|user-agent|last_error|customer/u);
  });

  it('acknowledges one OPEN incident once and safely replays the same command',async()=>{
    database=createMigratedTestDatabase();
    await openLoginAlert(database);
    const command={signal_type:'login_anomaly',summary_code:'LOGIN_ANOMALY_DETECTED',job_name:null,incident_version:1};
    const first=await acknowledgeScheduledOperationalAlert(database,command,context('alert-ack-key'));
    const replay=await acknowledgeScheduledOperationalAlert(database,command,context('alert-ack-key'));
    expect(replay).toEqual(first);
    expect(first).toEqual({...command,status:'ACKNOWLEDGED',acknowledged_at:2_000});
    expect(await database.prepare("SELECT status,acknowledged_at,version FROM scheduled_alert_states WHERE signal_type='login_anomaly' AND job_name=''").first()).toEqual({status:'ACKNOWLEDGED',acknowledged_at:2_000,version:2});
    const audits=(await database.prepare("SELECT event_type,actor_id,idempotency_key,previous_state_json,next_state_json,reason,metadata_json FROM audit_events WHERE event_type='SCHEDULED_OPERATION_ALERT_ACKNOWLEDGED'").all()).results;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({actor_id:'zz-phase3h-test-owner',idempotency_key:'alert-ack-key',reason:'OPERATOR_ACKNOWLEDGED',metadata_json:'{}'});
    expect(JSON.stringify(audits)).not.toMatch(/payload|token|wechat|object_key|password|error/u);
  });

  it('rejects key conflicts, denied actors, stale incidents, and non-OPEN states',async()=>{
    database=createMigratedTestDatabase();
    await openLoginAlert(database);
    const command={signal_type:'login_anomaly',summary_code:'LOGIN_ANOMALY_DETECTED',job_name:null,incident_version:1};
    await expect(acknowledgeScheduledOperationalAlert(database,command,{...context('denied-alert-key'),actor:actor([])})).rejects.toMatchObject({code:'FORBIDDEN',status:403});
    await acknowledgeScheduledOperationalAlert(database,command,context('conflicting-alert-key'));
    await expect(acknowledgeScheduledOperationalAlert(database,{...command,incident_version:2},context('conflicting-alert-key'))).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT',status:409});
    await expect(acknowledgeScheduledOperationalAlert(database,command,context('already-acknowledged-key'))).rejects.toMatchObject({code:'STATE_CONFLICT',status:409});
    await expect(acknowledgeScheduledOperationalAlert(database,{signal_type:'worker_5xx',summary_code:'WORKER_5XX_THRESHOLD',job_name:null,incident_version:1},context('missing-alert-key'))).rejects.toMatchObject({code:'NOT_FOUND',status:404});
    expect((await database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='SCHEDULED_OPERATION_ALERT_ACKNOWLEDGED'").first<{count:number}>())?.count).toBe(1);
  });

  it('acknowledges one external adapter summary without changing the other',async()=>{
    database=createMigratedTestDatabase();
    await ingestScheduledOperationalSignal(database,{observation_id:id(20),signal_type:'external_adapter_failure',summary_code:'PRIMARY_ALERT_SINK_FAILURE',job_name:null,observation_state:'BREACH',observed_at:1_000,count_value:1});
    await ingestScheduledOperationalSignal(database,{observation_id:id(21),signal_type:'external_adapter_failure',summary_code:'FEISHU_ADAPTER_FAILURE',job_name:null,observation_state:'BREACH',observed_at:1_100,count_value:3});
    await acknowledgeScheduledOperationalAlert(database,{signal_type:'external_adapter_failure',summary_code:'FEISHU_ADAPTER_FAILURE',job_name:null,incident_version:1},context('external-alert-ack'));
    expect((await database.prepare("SELECT summary_code,status FROM scheduled_alert_states WHERE signal_type='external_adapter_failure' ORDER BY summary_code").all()).results).toEqual([
      {summary_code:'FEISHU_ADAPTER_FAILURE',status:'ACKNOWLEDGED'},
      {summary_code:'PRIMARY_ALERT_SINK_FAILURE',status:'OPEN'},
    ]);
  });
});

async function openLoginAlert(db:SqliteDatabase) {
  await ingestScheduledOperationalSignal(db,{observation_id:id(1),signal_type:'login_anomaly',summary_code:'LOGIN_ANOMALY_DETECTED',job_name:null,observation_state:'BREACH',observed_at:1_000,count_value:5});
}
function actor(permissions:readonly 'SCHEDULED_OPERATIONS_RUN'[]=['SCHEDULED_OPERATIONS_RUN']):AssignmentStaffAuthorization { return {staffId:'zz-phase3h-test-owner',displayName:'Owner',staffStatus:'ACTIVE',authorizationVersion:1,roles:new Set(['owner']),permissions:new Set(permissions),memberTeamIds:[],leaderTeamIds:[]}; }
function context(idempotencyKey:string) { return {actor:actor(),idempotencyKey,requestId:`request-${idempotencyKey}`,now:2_000}; }
