import { afterEach,describe,expect,it } from 'vitest';
import { createMigratedTestDatabase,type SqliteDatabase } from '@ygb/testkit';
import { STAFF_SESSION_COOKIE_NAME } from '@ygb/contracts';
import { hashCanonicalJson,operationalAlertDescriptorFromRuntime } from '@ygb/domain';
import { createApp,type AppBindings } from '../app';
import { createAuditEventStatement } from '../foundation/audit';
import { staffSessionMiddleware } from '../middleware/staff-auth';
import { generateStaffOpaqueToken } from '../staff-auth/crypto';
import { createInternalStaffSession } from '../staff-auth/repository';
import { expectedOperationalAlertOutcome,type OperationalAlertServiceBinding,type OperationalAlertVerificationChallenge,type OperationalAlertVerificationReceipt } from './alert-sink-contract';
import { OPERATIONAL_ALERT_ATTESTATION_AGGREGATE,OPERATIONAL_ALERT_ATTESTATION_EVENT,registerOperationalAlertAttestationRoutes } from './alert-attestation';
import { registerOperationalReadinessRoutes } from './routes';

const RELEASE='a'.repeat(40),IDENTITY='service:operations-primary',VERSION='deploy-001',SERVICE='ygb-operational-alerts',ENTRYPOINT='OperationalAlertSinkEntrypoint';
const DESCRIPTOR=operationalAlertDescriptorFromRuntime({serviceTarget:SERVICE,entrypoint:ENTRYPOINT,sinkIdentity:IDENTITY,sinkDeploymentVersion:VERSION})!;
const FINGERPRINT=await hashCanonicalJson(DESCRIPTOR),NOW=2_000_000_000_000;
const LONG_RUNNING_TEST_TIMEOUT_MS=30_000;
let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('operational alert production readiness',()=>{
  it('rejects local self-certification, invalid release identifiers and descriptor drift',async()=>{
    database=createMigratedTestDatabase();
    expect(await alertCheck({APP_ENVIRONMENT:'production',APP_RELEASE_SHA:RELEASE,OPERATIONAL_ALERT_MODE:'local'},NOW)).toBe('failed');
    await seedAttestation();
    const base=productionBindings(new ReceiptSink());expect(await alertCheck(base,NOW)).toBe('ok');
    for(const drift of [
      {...base,OPERATIONAL_ALERT_SINK_SERVICE:'ygb-operational-alerts-b'},
      {...base,OPERATIONAL_ALERT_SINK_ENTRYPOINT:'OtherEntrypoint'},
      {...base,OPERATIONAL_ALERT_SINK_IDENTITY:'service:operations-other'},
      {...base,OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION:'deploy-002'},
      {...base,APP_RELEASE_SHA:'c'.repeat(40)},
      {...base,APP_RELEASE_SHA:'abc1234'},
      {...base,APP_RELEASE_SHA:'g'.repeat(40)},
      {...base,APP_RELEASE_SHA:'REQUIRED_RELEASE_COMMIT_SHA'},
    ])expect(await alertCheck(drift,NOW)).toBe('failed');
  });

  it('fails closed for missing, expired, cross-release or incomplete immutable attestations',async()=>{
    database=createMigratedTestDatabase();const base=productionBindings(new ReceiptSink());
    expect(await alertCheck(base,NOW)).toBe('failed');await seedAttestation();expect(await alertCheck(base,NOW)).toBe('ok');expect(await alertCheck(base,NOW+60_001)).toBe('failed');
    database.close();database=createMigratedTestDatabase();await seedAttestation({release_sha:'c'.repeat(40)});expect(await alertCheck(base,NOW)).toBe('failed');
    database.close();database=createMigratedTestDatabase();await seedAttestation({verified_receipts:[]});expect(await alertCheck(base,NOW)).toBe('failed');
  },LONG_RUNNING_TEST_TIMEOUT_MS);

  it('allows disabled only outside production and local console only in local development',async()=>{
    database=createMigratedTestDatabase();
    expect(await alertCheck({APP_ENVIRONMENT:'local',OPERATIONAL_ALERT_MODE:'disabled'},NOW)).toBe('ok');
    expect(await alertCheck({APP_ENVIRONMENT:'local',OPERATIONAL_ALERT_MODE:'local'},NOW)).toBe('ok');
    expect(await alertCheck({APP_ENVIRONMENT:'staging',OPERATIONAL_ALERT_MODE:'disabled'},NOW)).toBe('not_required');
    expect(await alertCheck({APP_ENVIRONMENT:'staging',OPERATIONAL_ALERT_MODE:'local'},NOW)).toBe('failed');
  });

  it('reports disabled staging-only production gates as not required without weakening production',async()=>{
    database=createMigratedTestDatabase();
    let storageHeadCalls=0;
    const response=await ready({
      APP_ENVIRONMENT:'staging',APP_RELEASE_SHA:RELEASE,
      SCHEDULED_OPERATIONS_ENABLED:'false',OUTBOX_DELIVERY_ENABLED:'false',ACQUISITION_MAINTENANCE_ENABLED:'false',
      OPERATIONAL_ALERT_MODE:'disabled',
      STAFF_ACCESS_TEAM_DOMAIN:'https://staging-team.cloudflareaccess.com',
      STAFF_ACCESS_AUD:'staging-access-audience',
      FILE_OBJECT_STORAGE:{headObject:async()=>{storageHeadCalls+=1;return null;}} as any,
    },NOW);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({data:{status:'ready',checks:{
      schema:'ok',scheduler:'not_required',outbox_delivery:'not_required',acquisition_maintenance:'not_required',
      operational_alerts:'not_required',object_storage:'ok',recovery:'not_required',
      staff_access:'ok',release:'ok',
    }}});
    expect(storageHeadCalls).toBe(1);
    for(const enabled of [
      {SCHEDULED_OPERATIONS_ENABLED:'true'},
      {OUTBOX_DELIVERY_ENABLED:'true'},
      {ACQUISITION_MAINTENANCE_ENABLED:'true'},
      {OPERATIONAL_ALERT_MODE:'local'},
    ]){
      const blocked=await ready({
        APP_ENVIRONMENT:'staging',APP_RELEASE_SHA:RELEASE,
        SCHEDULED_OPERATIONS_ENABLED:'false',ACQUISITION_MAINTENANCE_ENABLED:'false',
        OPERATIONAL_ALERT_MODE:'disabled',
        STAFF_ACCESS_TEAM_DOMAIN:'https://staging-team.cloudflareaccess.com',
        STAFF_ACCESS_AUD:'staging-access-audience',
        FILE_OBJECT_STORAGE:{headObject:async()=>null} as any,
        ...enabled,
      },NOW);
      expect(blocked.status).toBe(503);
    }
  });

  it('fails staging readiness when the empty-bucket object storage probe rejects',async()=>{
    database=createMigratedTestDatabase();let storageHeadCalls=0;
    const response=await ready({
      APP_ENVIRONMENT:'staging',APP_RELEASE_SHA:RELEASE,
      SCHEDULED_OPERATIONS_ENABLED:'false',OUTBOX_DELIVERY_ENABLED:'false',ACQUISITION_MAINTENANCE_ENABLED:'false',
      OPERATIONAL_ALERT_MODE:'disabled',
      STAFF_ACCESS_TEAM_DOMAIN:'https://staging-team.cloudflareaccess.com',
      STAFF_ACCESS_AUD:'staging-access-audience',
      FILE_OBJECT_STORAGE:{headObject:async()=>{storageHeadCalls+=1;throw new Error('r2_unavailable');}} as any,
    },NOW);
    expect(response.status).toBe(503);expect(storageHeadCalls).toBe(1);
    await expect(response.json()).resolves.toMatchObject({data:{status:'not_ready',checks:{object_storage:'failed'}}});
  });

  it('calls all three safe RPC challenges and atomically records only verified receipt summaries',async()=>{
    const {token}=await ownerSession();const sink=new ReceiptSink();const now=Date.now();const body={expires_at:now+60_000,evidence_reference:'operator-runbook-evidence-001'};
    expect((await attestationRequest(token,'alert-attestation-missing-origin',body,new ReceiptSink(),{Origin:null})).status).toBe(403);
    expect((await attestationRequest(token,'alert-attestation-foreign-origin',body,new ReceiptSink(),{Origin:'https://attacker.invalid','Sec-Fetch-Site':'cross-site'})).status).toBe(403);
    expect((await attestationRequest(token,'alert-attestation-extra-body',{...body,delivery_result:'PASS'},new ReceiptSink())).status).toBe(400);
    const invoke=(value:Record<string,unknown>)=>attestationRequest(token,'alert-attestation-command-001',value,sink);
    const first=await invoke(body);expect(first.status).toBe(201);const firstBody=await first.json() as {data:{attestation_id:string;verified_receipts:unknown[]}};
    expect(firstBody.data.verified_receipts).toHaveLength(3);expect(sink.calls.map((value)=>value.challenge_type)).toEqual(['DELIVERY','FAILURE','RECOVERY']);expect(sink.calls.every((value)=>value.simulation_mode==='SAFE_NO_PRODUCTION_DISRUPTION')).toBe(true);
    const replay=await invoke(body);expect(replay.status).toBe(200);await expect(replay.json()).resolves.toMatchObject({data:{attestation_id:firstBody.data.attestation_id}});expect(sink.calls).toHaveLength(3);
    const conflict=await invoke({...body,evidence_reference:'operator-runbook-evidence-002'});expect(conflict.status).toBe(409);await expect(conflict.json()).resolves.toMatchObject({error:{code:'IDEMPOTENCY_CONFLICT'}});
    const state=database!.raw.prepare(`SELECT (SELECT COUNT(*) FROM audit_events WHERE event_type='OPERATIONAL_ALERT_SINK_ATTESTED') AS audits,(SELECT COUNT(*) FROM integration_outbox WHERE event_type='OPERATIONAL_ALERT_SINK_ATTESTED') AS outbox,(SELECT COUNT(*) FROM command_idempotency_records WHERE idempotency_key='alert-attestation-command-001' AND status='COMMITTED') AS committed,(SELECT next_state_json FROM audit_events WHERE event_type='OPERATIONAL_ALERT_SINK_ATTESTED') AS json`).get() as {audits:number;outbox:number;committed:number;json:string};
    expect(state).toMatchObject({audits:1,outbox:1,committed:1});expect(state.json).not.toContain('nonce');expect(()=>database!.raw.prepare(`UPDATE audit_events SET reason='tampered' WHERE id=?`).run(firstBody.data.attestation_id)).toThrow('audit_events_are_immutable');
  });

  it('rejects malformed, stale, duplicated or failed RPC receipts with 503 and zero success ghosts',async()=>{
    const {token}=await ownerSession();const now=Date.now(),body={expires_at:now+60_000,evidence_reference:'operator-negative-evidence-001'};
    const corruptions:Array<(receipt:OperationalAlertVerificationReceipt,challenge:OperationalAlertVerificationChallenge,index:number)=>unknown>=[
      (r)=>({...r,nonce:'wrong-nonce'}),(r)=>({...r,release_sha:'c'.repeat(40)}),(r)=>({...r,binding_fingerprint:'d'.repeat(64)}),(r)=>({...r,challenge_type:'RECOVERY'}),(r)=>({...r,sink_identity:'service:operations-other'}),(r)=>({...r,sink_deployment_version:'deploy-999'}),(r)=>({...r,observed_outcome:'WRONG'}),(r)=>({...r,issued_at:Date.now()+60_000}),
      (r)=>{const value={...r};delete (value as Partial<OperationalAlertVerificationReceipt>).nonce;return value;},(r)=>({...r,expires_at:Date.now()-1}),()=>({unknown:true}),
    ];
    let index=0;
    for(const corrupt of corruptions){const response=await attestationRequest(token,`alert-negative-${index}`,body,new ReceiptSink(corrupt));expect(response.status,`corruption ${index}`).toBe(503);index+=1;}
    const duplicate=new ReceiptSink((receipt,_challenge,receiptIndex)=>({...receipt,receipt_id:receiptIndex===0?'receipt-duplicate':'receipt-duplicate'}));
    expect((await attestationRequest(token,'alert-negative-duplicate',body,duplicate)).status).toBe(503);
    const failed=new ReceiptSink(undefined,true);expect((await attestationRequest(token,'alert-negative-rpc-failure',body,failed)).status).toBe(503);
    expect(database!.raw.prepare(`SELECT (SELECT COUNT(*) FROM audit_events WHERE event_type='OPERATIONAL_ALERT_SINK_ATTESTED') AS audits,(SELECT COUNT(*) FROM integration_outbox WHERE event_type='OPERATIONAL_ALERT_SINK_ATTESTED') AS outbox,(SELECT COUNT(*) FROM command_idempotency_records WHERE action='ATTEST_OPERATIONAL_ALERT_SINK' AND status='COMMITTED') AS committed`).get()).toEqual({audits:0,outbox:0,committed:0});
  });
});

class ReceiptSink implements OperationalAlertServiceBinding{
  readonly calls:OperationalAlertVerificationChallenge[]=[];
  constructor(private readonly mutate?:(receipt:OperationalAlertVerificationReceipt,challenge:OperationalAlertVerificationChallenge,index:number)=>unknown,private readonly fail=false){}
  async notify():Promise<void>{}
  async verifyOperationalAlertChallenge(challenge:OperationalAlertVerificationChallenge):Promise<unknown>{
    if(this.fail)throw new Error('sink_rpc_failed');const index=this.calls.length;this.calls.push(challenge);
    const receipt:OperationalAlertVerificationReceipt={protocol_version:'moonwhite-operational-alert-verification-v1',receipt_id:`receipt-${challenge.challenge_type.toLowerCase()}-${challenge.challenge_id}`,challenge_id:challenge.challenge_id,challenge_type:challenge.challenge_type,nonce:challenge.nonce,release_sha:challenge.release_sha,binding_fingerprint:challenge.binding_fingerprint,sink_identity:challenge.sink_identity,sink_deployment_version:challenge.sink_deployment_version,observed_outcome:expectedOperationalAlertOutcome(challenge.challenge_type),issued_at:challenge.issued_at,expires_at:challenge.expires_at};
    return this.mutate?this.mutate(receipt,challenge,index):receipt;
  }
}
function productionBindings(sink:OperationalAlertServiceBinding):Partial<AppBindings>{return{APP_ENVIRONMENT:'production',APP_RELEASE_SHA:RELEASE,OPERATIONAL_ALERT_MODE:'bound',OPERATIONAL_ALERT_SINK:sink,OPERATIONAL_ALERT_SINK_SERVICE:SERVICE,OPERATIONAL_ALERT_SINK_ENTRYPOINT:ENTRYPOINT,OPERATIONAL_ALERT_SINK_IDENTITY:IDENTITY,OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION:VERSION,OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT:FINGERPRINT};}
async function alertCheck(bindings:Partial<AppBindings>,now:number):Promise<string>{const response=await ready(bindings,now);const body=await response.json() as {data:{checks:{operational_alerts:string}}};return body.data.checks.operational_alerts;}
async function ready(bindings:Partial<AppBindings>,now:number):Promise<Response>{const original=Date.now;Date.now=()=>now;try{const app=createApp();registerOperationalReadinessRoutes(app);return await app.request('https://app.example.test/ready',{}, {DB:database!,...bindings});}finally{Date.now=original;}}
async function seedAttestation(overrides:Record<string,unknown>={}):Promise<void>{const receipts=['DELIVERY','FAILURE','RECOVERY'].map((type,index)=>({receipt_id:`stored-receipt-${index}`,challenge_id:`stored-challenge-${index}`,challenge_type:type,observed_outcome:type==='DELIVERY'?'DELIVERED':type==='FAILURE'?'FAILURE_PATH_VERIFIED':'RECOVERED',issued_at:NOW-60_000,expires_at:NOW+60_000,binding_fingerprint:FINGERPRINT,sink_deployment_version:VERSION}));const value={attestation_id:'attestation-001',release_sha:RELEASE,sink_identity:IDENTITY,sink_deployment_version:VERSION,sink_config_fingerprint:FINGERPRINT,verified_at:NOW-60_000,expires_at:NOW+60_000,evidence_reference:'operator-evidence-ticket-001',verified_by_staff_id:'staff-owner',verified_receipts:receipts,...overrides};await createAuditEventStatement(database!,{id:'audit-attestation-001',aggregateType:OPERATIONAL_ALERT_ATTESTATION_AGGREGATE,aggregateId:`${RELEASE}:${FINGERPRINT}`,eventType:OPERATIONAL_ALERT_ATTESTATION_EVENT,actor:{type:'STAFF',id:'staff-owner',roles:['owner']},nextState:value,createdAt:NOW-60_000}).run();}
async function ownerSession():Promise<{token:string}>{database=createMigratedTestDatabase();database.exec(`INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at,session_version) VALUES('staff-alert-owner','告警证明管理员','ACTIVE',1,1,1000,1000,NULL,1);INSERT INTO staff_role_assignments(staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at) VALUES('staff-alert-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000);`);const token=generateStaffOpaqueToken(),now=Date.now();await createInternalStaffSession(database,{token,identity:{identity_id:'alert-owner-identity',staff_id:'staff-alert-owner',identity_status:'ACTIVE',identity_user_id:null,display_name:'告警证明管理员',staff_status:'ACTIVE',authorization_version:1,session_version:1},requestId:'alert-attestation-session',now,expiresAt:now+60_000});return{token};}
async function attestationRequest(token:string,key:string,body:Record<string,unknown>,sink:OperationalAlertServiceBinding,overrides:Record<string,string|null>={}):Promise<Response>{const headers=new Headers({'Content-Type':'application/json','Idempotency-Key':key,Origin:'https://app.example.test','Sec-Fetch-Site':'same-origin',Cookie:`${STAFF_SESSION_COOKIE_NAME}=${token}`});for(const [name,value]of Object.entries(overrides)){if(value===null)headers.delete(name);else headers.set(name,value);}const app=createApp();app.use('/api/staff/*',staffSessionMiddleware());registerOperationalAlertAttestationRoutes(app);return app.request('https://app.example.test/api/staff/production-readiness/operational-alert-attestations',{method:'POST',headers,body:JSON.stringify(body)},{DB:database!,...productionBindings(sink),CUSTOMER_SECURITY_TOKEN_SECRET:'alert-test-secret-with-more-than-thirty-two-bytes'});}
