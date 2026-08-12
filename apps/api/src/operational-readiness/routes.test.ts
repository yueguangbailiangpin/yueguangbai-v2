import { afterEach,describe,expect,it } from 'vitest';
import { createMigratedTestDatabase,type SqliteDatabase } from '@ygb/testkit';
import { STAFF_SESSION_COOKIE_NAME } from '@ygb/contracts';
import { createApp } from '../app';
import { createAuditEventStatement } from '../foundation/audit';
import { MemoryOperationalAlertSink } from '../scheduled-operations/signals';
import { staffSessionMiddleware } from '../middleware/staff-auth';
import { generateStaffOpaqueToken } from '../staff-auth/crypto';
import { createInternalStaffSession } from '../staff-auth/repository';
import { OPERATIONAL_ALERT_ATTESTATION_AGGREGATE,OPERATIONAL_ALERT_ATTESTATION_EVENT,registerOperationalAlertAttestationRoutes } from './alert-attestation';
import { registerOperationalReadinessRoutes } from './routes';

const RELEASE='a'.repeat(40),FINGERPRINT='b'.repeat(64),IDENTITY='service:operations-primary';
const NOW=2_000_000_000_000;
let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('operational alert production readiness',()=>{
  it('rejects production local console mode and bare self-reported verification',async()=>{
    database=createMigratedTestDatabase();
    const response=await ready({APP_ENVIRONMENT:'production',APP_RELEASE_SHA:RELEASE,OPERATIONAL_ALERT_MODE:'local',OPERATIONAL_ALERT_SINK_VERIFIED:'true'},NOW);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({data:{checks:{operational_alerts:'failed'}}});
  });

  it('fails closed for missing, expired, release-mismatched, sink-mismatched or failed exercise attestations',async()=>{
    database=createMigratedTestDatabase();
    const base=productionBindings();
    expect(await alertCheck(base,NOW)).toBe('failed');
    await seedAttestation({verified_at:NOW-60_000,expires_at:NOW+60_000});
    expect(await alertCheck(base,NOW)).toBe('ok');
    expect(await alertCheck({...base,APP_RELEASE_SHA:'c'.repeat(40)},NOW)).toBe('failed');
    expect(await alertCheck({...base,OPERATIONAL_ALERT_SINK_IDENTITY:'service:other-primary'},NOW)).toBe('failed');
    expect(await alertCheck({...base,OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT:'d'.repeat(64)},NOW)).toBe('failed');
    expect(await alertCheck(base,NOW+60_001)).toBe('failed');

    database.close();database=createMigratedTestDatabase();
    await seedAttestation({verified_at:NOW-60_000,expires_at:NOW+60_000,recovery_result:'FAIL'});
    expect(await alertCheck(base,NOW)).toBe('failed');
  });

  it('allows disabled only outside production and local console only in local development',async()=>{
    database=createMigratedTestDatabase();
    expect(await alertCheck({APP_ENVIRONMENT:'local',OPERATIONAL_ALERT_MODE:'disabled'},NOW)).toBe('ok');
    expect(await alertCheck({APP_ENVIRONMENT:'local',OPERATIONAL_ALERT_MODE:'local'},NOW)).toBe('ok');
    expect(await alertCheck({APP_ENVIRONMENT:'staging',OPERATIONAL_ALERT_MODE:'disabled'},NOW)).toBe('ok');
    expect(await alertCheck({APP_ENVIRONMENT:'staging',OPERATIONAL_ALERT_MODE:'local'},NOW)).toBe('failed');
  });

  it('records a current structured attestation through formal Staff session and the atomic command boundary',async()=>{
    database=createMigratedTestDatabase();database.exec(`INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at,session_version) VALUES('staff-alert-owner','告警证明管理员','ACTIVE',1,1,1000,1000,NULL,1);INSERT INTO staff_role_assignments(staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at) VALUES('staff-alert-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000);`);
    const token=generateStaffOpaqueToken(),now=Date.now();
    await createInternalStaffSession(database,{token,identity:{identity_id:'alert-owner-identity',staff_id:'staff-alert-owner',identity_status:'ACTIVE',identity_user_id:null,display_name:'告警证明管理员',staff_status:'ACTIVE',authorization_version:1,session_version:1},requestId:'alert-attestation-session',now,expiresAt:now+60_000});
    const body={release_sha:RELEASE,sink_identity:IDENTITY,sink_config_fingerprint:FINGERPRINT,verified_at:now-1000,expires_at:now+60_000,delivery_result:'PASS',failure_result:'PASS',recovery_result:'PASS',evidence_reference:'operator-runbook-evidence-001'};
    expect((await attestationRequest(token,'alert-attestation-missing-origin',body,{Origin:null})).status).toBe(403);
    expect((await attestationRequest(token,'alert-attestation-foreign-origin',body,{Origin:'https://attacker.invalid','Sec-Fetch-Site':'cross-site'})).status).toBe(403);
    expect((await attestationRequest(token,'alert-attestation-extra-body',{...body,unexpected:true})).status).toBe(400);
    const invoke=(value:Record<string,unknown>)=>attestationRequest(token,'alert-attestation-command-001',value);
    const first=await invoke(body);expect(first.status).toBe(201);
    const firstBody=await first.json() as {data:{attestation_id:string}};
    const replay=await invoke(body);expect(replay.status).toBe(200);await expect(replay.json()).resolves.toMatchObject({data:{attestation_id:firstBody.data.attestation_id}});
    const conflict=await invoke({...body,evidence_reference:'operator-runbook-evidence-002'});expect(conflict.status).toBe(409);await expect(conflict.json()).resolves.toMatchObject({error:{code:'IDEMPOTENCY_CONFLICT'}});
    expect(database.raw.prepare(`SELECT
      (SELECT COUNT(*) FROM audit_events WHERE event_type='OPERATIONAL_ALERT_SINK_ATTESTED') AS audits,
      (SELECT COUNT(*) FROM integration_outbox WHERE event_type='OPERATIONAL_ALERT_SINK_ATTESTED') AS outbox,
      (SELECT COUNT(*) FROM command_idempotency_records WHERE idempotency_key='alert-attestation-command-001' AND status='COMMITTED') AS committed`).get()).toEqual({audits:1,outbox:1,committed:1});
    expect(()=>database!.raw.prepare(`UPDATE audit_events SET reason='tampered' WHERE id=?`).run(firstBody.data.attestation_id)).toThrow('audit_events_are_immutable');
  });
});

function productionBindings(){return{APP_ENVIRONMENT:'production',APP_RELEASE_SHA:RELEASE,OPERATIONAL_ALERT_MODE:'bound',OPERATIONAL_ALERT_SINK:new MemoryOperationalAlertSink(),OPERATIONAL_ALERT_SINK_IDENTITY:IDENTITY,OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT:FINGERPRINT};}
async function alertCheck(bindings:Record<string,unknown>,now:number):Promise<string>{const response=await ready(bindings,now);const body=await response.json() as {data:{checks:{operational_alerts:string}}};return body.data.checks.operational_alerts;}
async function ready(bindings:Record<string,unknown>,now:number):Promise<Response>{const original=Date.now;Date.now=()=>now;try{const app=createApp();registerOperationalReadinessRoutes(app);return await app.request('https://app.example.test/ready',{}, {DB:database!,...bindings});}finally{Date.now=original;}}
async function seedAttestation(overrides:Record<string,unknown>):Promise<void>{
  const value={attestation_id:'attestation-001',release_sha:RELEASE,sink_identity:IDENTITY,sink_config_fingerprint:FINGERPRINT,verified_at:NOW-60_000,expires_at:NOW+60_000,delivery_result:'PASS',failure_result:'PASS',recovery_result:'PASS',evidence_reference:'operator-evidence-ticket-001',verified_by_staff_id:'staff-owner',...overrides};
  await createAuditEventStatement(database!,{id:'audit-attestation-001',aggregateType:OPERATIONAL_ALERT_ATTESTATION_AGGREGATE,aggregateId:`${RELEASE}:${FINGERPRINT}`,eventType:OPERATIONAL_ALERT_ATTESTATION_EVENT,actor:{type:'STAFF',id:'staff-owner',roles:['owner']},nextState:value,createdAt:NOW-60_000}).run();
}
async function attestationRequest(token:string,key:string,body:Record<string,unknown>,overrides:Record<string,string|null>={}):Promise<Response>{const headers=new Headers({'Content-Type':'application/json','Idempotency-Key':key,Origin:'https://app.example.test','Sec-Fetch-Site':'same-origin',Cookie:`${STAFF_SESSION_COOKIE_NAME}=${token}`});for(const [name,value] of Object.entries(overrides)){if(value===null)headers.delete(name);else headers.set(name,value);}const app=createApp();app.use('/api/staff/*',staffSessionMiddleware());registerOperationalAlertAttestationRoutes(app);return app.request('https://app.example.test/api/staff/production-readiness/operational-alert-attestations',{method:'POST',headers,body:JSON.stringify(body)},{DB:database!,APP_ENVIRONMENT:'production',APP_RELEASE_SHA:RELEASE,OPERATIONAL_ALERT_MODE:'bound',OPERATIONAL_ALERT_SINK_IDENTITY:IDENTITY,OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT:FINGERPRINT,CUSTOMER_SECURITY_TOKEN_SECRET:'alert-test-secret-with-more-than-thirty-two-bytes'});}
