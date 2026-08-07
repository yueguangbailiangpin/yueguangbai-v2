import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { parseFeishuWorkbenchTaskSummaryDto } from '@ygb/contracts';
import { prepareDirectWorkItem } from '../staff-assignment/assignment-service';
import { handleFeishuWorkbenchCallback, verifyFeishuWorkbenchSignature } from './callback';
import { FeishuWorkbenchAdapterError, MockFeishuWorkbenchAdapter } from './mock-adapter';
import { feishuWorkbenchRuntime } from './runtime';
import { runFeishuWorkbenchSyncBatch } from './sync';
import { createApp, type AppBindings } from '../app';
import { registerFeishuWorkbenchRoutes } from './routes';
import { runScheduledOperations } from '../scheduled-operations/runner';
import { evaluatePersistedScheduledJobSignals, MemoryOperationalAlertSink } from '../scheduled-operations/signals';

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

describe('Feishu staff workbench local boundary', () => {
  it('fails closed without complete local runtime configuration', () => {
    expect(feishuWorkbenchRuntime({ FEISHU_WORKBENCH_SYNC_ENABLED: 'true' }))
      .toMatchObject({ syncEnabled: false, callbackEnabled: false, adapter: null });
    expect(feishuWorkbenchRuntime({ FEISHU_WORKBENCH_CALLBACK_ENABLED: 'true', FEISHU_WORKBENCH_CALLBACK_SECRET: 'short' }))
      .toMatchObject({ callbackEnabled: false });
  });

  it('enforces the minimal DTO whitelist and safe deep link', () => {
    expect(() => parseFeishuWorkbenchTaskSummaryDto({
      work_item_id: 'item-1', work_type: 'REVIEW_DECISION', status: 'OPEN',
      assigned_staff_id: 'staff-1', updated_at: 1, safe_title: '待处理评价审核',
      deep_link: 'https://staff.example.test/staff/work-items/item-1',
      time_basis: 'UTC_MS', display_timezone: 'Asia/Shanghai', wechat: 'forbidden',
    })).toThrow('invalid_feishu_workbench_contract');
    expect(() => parseFeishuWorkbenchTaskSummaryDto({
      work_item_id: 'item-1', work_type: 'REVIEW_DECISION', status: 'OPEN',
      assigned_staff_id: 'staff-1', updated_at: 1, safe_title: '待处理评价审核',
      deep_link: 'https://staff.example.test/other', time_basis: 'UTC_MS', display_timezone: 'Asia/Shanghai',
    })).toThrow('invalid_feishu_workbench_summary');
  });

  it('coalesces only safe work-item snapshots and keeps provider failures outside business facts', async () => {
    const d = await setup();
    const item = await createWorkItem(d);
    expect(await d.prepare('SELECT aggregate_type,aggregate_id,available_at FROM integration_outbox WHERE aggregate_type=?').bind('STAFF_WORK_ITEM').first())
      .toMatchObject({ aggregate_type: 'STAFF_WORK_ITEM', aggregate_id: item.workItemId, available_at: 100 });
    const adapter = new MockFeishuWorkbenchAdapter();
    const synced = await runFeishuWorkbenchSyncBatch(d, adapter, { webOrigin: 'https://staff.example.test', now: 200, limit: 50 });
    expect(synced).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    const task = [...adapter.tasks.values()][0];
    expect(task).toMatchObject({ work_item_id: item.workItemId, safe_title: '待处理预约决策', display_timezone: 'Asia/Shanghai' });
    expect(JSON.stringify(task)).not.toMatch(/buyer|seller|wechat|amount|proof|source_entity|token|object_key/u);
    expect(await d.prepare('SELECT mirrored_work_item_version,mirror_key FROM feishu_workbench_mirrors WHERE work_item_id=?').bind(item.workItemId).first())
      .toMatchObject({ mirrored_work_item_version: 1, mirror_key: `local-feishu:${item.workItemId}` });

    d.exec(`INSERT INTO integration_outbox(id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES ('feishu-retry','feishu-retry-key','WORK_ITEM_CHANGED','STAFF_WORK_ITEM','${item.workItemId}','{}','${'a'.repeat(64)}','PENDING',201,NULL,NULL,0,NULL,201,201,NULL)`);
    adapter.nextError = new FeishuWorkbenchAdapterError('RATE_LIMITED');
    const failed = await runFeishuWorkbenchSyncBatch(d, adapter, { webOrigin: 'https://staff.example.test', now: 202, limit: 1 });
    expect(failed).toMatchObject({ processed: 1, failed: 1, failureCategory: 'provider_rate_limited' });
    expect(await d.prepare('SELECT status,last_error FROM integration_outbox WHERE id=?').bind('feishu-retry').first())
      .toEqual({ status: 'FAILED', last_error: 'provider_rate_limited' });
    expect(await d.prepare('SELECT version,assigned_staff_id FROM staff_work_items WHERE id=?').bind(item.workItemId).first())
      .toEqual({ version: 1, assigned_staff_id: 'pre-1' });
  });

  it('verifies signature, rejects replay, and recomputes D1 permission before reassigning', async () => {
    const d = await setup();
    const item = await createWorkItem(d);
    d.exec(`INSERT INTO feishu_staff_identities(id,staff_id,tenant_key,open_id,user_id,status,verified_at,created_at,updated_at,revoked_at) VALUES ('identity-owner','zz-phase3h-test-owner','tenant-local','open-owner',NULL,'ACTIVE',1,1,1,NULL)`);
    const body = JSON.stringify({ event_id: 'callback-event-001', tenant_key: 'tenant-local', open_id: 'open-owner', action: 'REASSIGN_WORK_ITEM', work_item_id: item.workItemId, expected_version: 1, target_staff_id: 'pre-2', reason: '本地任务改派' });
    const now = 10_000;
    const secret = 'local-test-callback-secret-at-least-thirty-two';
    const verified = await verifyFeishuWorkbenchSignature({ secret, signature: await signature(secret, String(now), 'nonce-001', body), timestamp: String(now), nonce: 'nonce-001', body, now });
    const result = await handleFeishuWorkbenchCallback(d, { body: JSON.parse(body), nonceHash: verified.nonceHash, payloadHash: verified.payloadHash, now });
    expect(result).toMatchObject({ outcome: 'SUCCEEDED', work_item_id: item.workItemId, version: 2 });
    const replay = await handleFeishuWorkbenchCallback(d, { body: JSON.parse(body), nonceHash: verified.nonceHash, payloadHash: verified.payloadHash, now: now + 1 });
    expect(replay).toEqual(result);
    expect(await d.prepare('SELECT assigned_staff_id,version FROM staff_work_items WHERE id=?').bind(item.workItemId).first())
      .toEqual({ assigned_staff_id: 'pre-2', version: 2 });
    await expect(verifyFeishuWorkbenchSignature({ secret, signature: '0'.repeat(64), timestamp: String(now), nonce: 'nonce-002', body, now }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('fails closed for an unknown identity and a current Personal DENY', async () => {
    const d = await setup();
    const item = await createWorkItem(d);
    const unknown = { event_id: 'callback-event-unknown', tenant_key: 'tenant-local', open_id: 'missing', action: 'REASSIGN_WORK_ITEM' as const, work_item_id: item.workItemId, expected_version: 1, target_staff_id: 'pre-2', reason: '本地任务改派' };
    expect(await handleFeishuWorkbenchCallback(d, { body: unknown, nonceHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64), now: 10_000 }))
      .toEqual({ outcome: 'REJECTED', work_item_id: null, version: null });
    d.exec(`INSERT INTO feishu_staff_identities(id,staff_id,tenant_key,open_id,user_id,status,verified_at,created_at,updated_at,revoked_at) VALUES ('identity-denied','zz-phase3h-test-owner','tenant-local','open-owner',NULL,'ACTIVE',1,1,1,NULL);
      INSERT INTO staff_permission_overrides(staff_id,permission_code,effect,status,reason,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at) VALUES ('zz-phase3h-test-owner','TASK_REASSIGN_TEAM','DENY','ACTIVE','本地拒绝','zz-phase3h-test-owner',2,NULL,2,2);`);
    const denied = { ...unknown, event_id: 'callback-event-denied', open_id: 'open-owner' };
    expect(await handleFeishuWorkbenchCallback(d, { body: denied, nonceHash: 'c'.repeat(64), payloadHash: 'd'.repeat(64), now: 10_001 }))
      .toEqual({ outcome: 'REJECTED', work_item_id: null, version: null });
    expect(await d.prepare('SELECT assigned_staff_id,version FROM staff_work_items WHERE id=?').bind(item.workItemId).first())
      .toEqual({ assigned_staff_id: 'pre-1', version: 1 });
  });

  it('quarantines a fifth failed sync, does not claim it again, and leaves dry-run read-only', async () => {
    const d=await setup(); const item=await createWorkItem(d);
    d.exec(`UPDATE integration_outbox SET attempt_count=4,available_at=200 WHERE aggregate_type='STAFF_WORK_ITEM' AND aggregate_id='${item.workItemId}'`);
    const adapter=new MockFeishuWorkbenchAdapter(); adapter.nextError=new FeishuWorkbenchAdapterError('UNAVAILABLE');
    expect(await runFeishuWorkbenchSyncBatch(d,adapter,{webOrigin:'https://staff.example.test',now:200,limit:1})).toMatchObject({processed:1,failed:1});
    const event=await d.prepare("SELECT id,status,last_error,attempt_count FROM integration_outbox WHERE aggregate_type='STAFF_WORK_ITEM'").first<{id:string;status:string;last_error:string;attempt_count:number}>();
    expect(event).toMatchObject({status:'FAILED',last_error:'quarantined',attempt_count:5});
    expect(await d.prepare("SELECT job_name,source_kind,source_id,replay_status,attempt_count FROM scheduled_dead_letters WHERE source_id=?").bind(event?.id).first()).toEqual({job_name:'feishu_sync',source_kind:'OUTBOX',source_id:event?.id,replay_status:'QUARANTINED',attempt_count:5});
    expect(await runFeishuWorkbenchSyncBatch(d,adapter,{webOrigin:'https://staff.example.test',now:300,limit:1})).toMatchObject({processed:0});
    expect(await runFeishuWorkbenchSyncBatch(d,adapter,{webOrigin:'https://staff.example.test',now:300,dryRun:true,limit:1})).toMatchObject({processed:0});
    expect(await d.prepare('SELECT attempt_count FROM integration_outbox WHERE id=?').bind(event?.id).first()).toEqual({attempt_count:5});
  });

  it('rejects mismatched callback replays and permits only exact success replay', async () => {
    const d=await setup(); const item=await createWorkItem(d); await insertOwnerIdentity(d);
    const body={event_id:'callback-mismatch-001',tenant_key:'tenant-local',open_id:'open-owner',action:'REASSIGN_WORK_ITEM' as const,work_item_id:item.workItemId,expected_version:1,target_staff_id:'pre-2',reason:'本地任务改派'};
    const first=await handleFeishuWorkbenchCallback(d,{body,nonceHash:'a'.repeat(64),payloadHash:'b'.repeat(64),now:10_000});
    expect(await handleFeishuWorkbenchCallback(d,{body,nonceHash:'a'.repeat(64),payloadHash:'b'.repeat(64),now:10_001})).toEqual(first);
    await expect(handleFeishuWorkbenchCallback(d,{body,nonceHash:'c'.repeat(64),payloadHash:'b'.repeat(64),now:10_001})).rejects.toMatchObject({code:'UNAUTHENTICATED',status:401});
    await expect(handleFeishuWorkbenchCallback(d,{body,nonceHash:'a'.repeat(64),payloadHash:'d'.repeat(64),now:10_001})).rejects.toMatchObject({code:'UNAUTHENTICATED',status:401});
    await expect(handleFeishuWorkbenchCallback(d,{body:{...body,event_id:'callback-mismatch-002'},nonceHash:'a'.repeat(64),payloadHash:'b'.repeat(64),now:10_001})).rejects.toMatchObject({code:'UNAUTHENTICATED',status:401});
    expect(first).toMatchObject({outcome:'SUCCEEDED',version:2});
  });

  it('reports in-progress, takes over an expired receipt lease, and reconciles a race loser from D1', async () => {
    const d=await setup(); const item=await createWorkItem(d); await insertOwnerIdentity(d);
    const body={event_id:'callback-lease-001',tenant_key:'tenant-local',open_id:'open-owner',action:'REASSIGN_WORK_ITEM' as const,work_item_id:item.workItemId,expected_version:1,target_staff_id:'pre-2',reason:'本地任务改派'};
    d.exec(`INSERT INTO feishu_workbench_callback_receipts(event_id,nonce_hash,payload_hash,status,response_json,failure_code,lease_token,lease_expires_at,version,created_at,updated_at,completed_at) VALUES ('callback-lease-001','${'e'.repeat(64)}','${'f'.repeat(64)}','PROCESSING',NULL,NULL,'held',20000,1,1,1,NULL)`);
    expect(await handleFeishuWorkbenchCallback(d,{body,nonceHash:'e'.repeat(64),payloadHash:'f'.repeat(64),now:10_000})).toEqual({outcome:'IN_PROGRESS',work_item_id:null,version:null});
    d.exec("UPDATE feishu_workbench_callback_receipts SET lease_expires_at=9999,version=version+1,updated_at=2 WHERE event_id='callback-lease-001'");
    expect(await handleFeishuWorkbenchCallback(d,{body,nonceHash:'e'.repeat(64),payloadHash:'f'.repeat(64),now:10_000})).toMatchObject({outcome:'SUCCEEDED',version:2});
    const loser={...body,event_id:'callback-race-loser',expected_version:1,target_staff_id:'pre-1'};
    expect(await handleFeishuWorkbenchCallback(d,{body:loser,nonceHash:'1'.repeat(64),payloadHash:'2'.repeat(64),now:10_001})).toEqual({outcome:'REJECTED',work_item_id:null,version:null});
    expect(await d.prepare("SELECT status,failure_code FROM feishu_workbench_callback_receipts WHERE event_id='callback-race-loser'").first()).toEqual({status:'REJECTED',failure_code:'VERSION_CONFLICT'});
    expect(await d.prepare("SELECT event_type,aggregate_type,aggregate_id,payload_json FROM integration_outbox WHERE dedup_key=?").bind(`staff-work-item:${item.workItemId}:feishu-reconcile:v2`).first()).toMatchObject({event_type:'FEISHU_WORKBENCH_RECONCILE',aggregate_type:'STAFF_WORK_ITEM',aggregate_id:item.workItemId,payload_json:JSON.stringify({reconciliation:'VERSION_CONFLICT',work_item_id:item.workItemId})});
    const adapter=new MockFeishuWorkbenchAdapter(); await runFeishuWorkbenchSyncBatch(d,adapter,{webOrigin:'https://staff.example.test',now:20_000,limit:50});
    expect([...adapter.tasks.values()].at(-1)).toMatchObject({work_item_id:item.workItemId,assigned_staff_id:'pre-2',updated_at:expect.any(Number)});
  });

  it('uses the work-item id as stable provider key across a mirror persistence retry', async () => {
    const d=await setup(); const item=await createWorkItem(d); const adapter=new MockFeishuWorkbenchAdapter();
    d.exec("CREATE TRIGGER fail_first_mirror BEFORE INSERT ON feishu_workbench_mirrors BEGIN SELECT RAISE(ABORT,'fixture mirror write failed'); END;");
    expect(await runFeishuWorkbenchSyncBatch(d,adapter,{webOrigin:'https://staff.example.test',now:200,limit:1})).toMatchObject({failed:1});
    d.exec('DROP TRIGGER fail_first_mirror');
    expect(await runFeishuWorkbenchSyncBatch(d,adapter,{webOrigin:'https://staff.example.test',now:61_000,limit:1})).toMatchObject({succeeded:1});
    expect(adapter.keys.get(item.workItemId)).toBe(`local-feishu:${item.workItemId}`);
    expect(adapter.tasks.size).toBe(1);
  });

  it('does not create a terminal-only mirror but closes an existing one', async () => {
    const d=await setup(); const adapter=new MockFeishuWorkbenchAdapter();
    const terminalOnly=await createWorkItem(d);
    d.exec(`UPDATE staff_work_items SET status='COMPLETED',completed_at=200,version=version+1,updated_at=200 WHERE id='${terminalOnly.workItemId}'`);
    expect(await runFeishuWorkbenchSyncBatch(d,adapter,{webOrigin:'https://staff.example.test',now:200,limit:1})).toMatchObject({succeeded:1});
    expect(await d.prepare('SELECT work_item_id FROM feishu_workbench_mirrors WHERE work_item_id=?').bind(terminalOnly.workItemId).first()).toBeNull();
    const existing=await createWorkItem(d);
    await runFeishuWorkbenchSyncBatch(d,adapter,{webOrigin:'https://staff.example.test',now:201,limit:5});
    d.exec(`UPDATE staff_work_items SET status='CANCELLED',cancelled_at=300,version=version+1,updated_at=300 WHERE id='${existing.workItemId}'; INSERT INTO integration_outbox(id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES('terminal-existing','terminal-existing-key','WORK_ITEM_CHANGED','STAFF_WORK_ITEM','${existing.workItemId}','{}','${'9'.repeat(64)}','PENDING',300,NULL,NULL,0,NULL,300,300,NULL)`);
    await runFeishuWorkbenchSyncBatch(d,adapter,{webOrigin:'https://staff.example.test',now:300,limit:5});
    expect(adapter.tasks.get(`local-feishu:${existing.workItemId}`)).toMatchObject({status:'CANCELLED'});
  });

  it('records fixed, idempotent adapter-failure observations and allows quiet recovery', async () => {
    const d=await setup(); await createWorkItem(d); await createWorkItem(d); await createWorkItem(d);
    const adapter=new MockFeishuWorkbenchAdapter(); const sink=new MemoryOperationalAlertSink();
    for(const now of [200,201,202]) {
      adapter.nextError=new FeishuWorkbenchAdapterError('UNAVAILABLE');
      await runScheduledOperations(d,{enabled:true,only:'feishu_sync',feishuAdapter:adapter,feishuWebOrigin:'https://staff.example.test',alertSink:sink,now,batchSize:1});
    }
    expect(sink.notifications).toEqual([expect.objectContaining({summary_code:'FEISHU_ADAPTER_FAILURE',category:'external',severity:'WARNING'})]);
    const serialized=JSON.stringify((await d.prepare("SELECT id,summary_code,job_name FROM scheduled_operational_signals WHERE summary_code='FEISHU_ADAPTER_FAILURE'").all()).results);
    expect(serialized).not.toMatch(/payload|token|secret|object_key|provider_unavailable/u);
    await evaluatePersistedScheduledJobSignals(d,{evaluationId:'3'.repeat(64),now:900_203,sink});
    await evaluatePersistedScheduledJobSignals(d,{evaluationId:'4'.repeat(64),now:901_203,sink});
    expect(sink.notifications.at(-1)).toMatchObject({summary_code:'FEISHU_ADAPTER_FAILURE',notification_kind:'RESOLVED',status:'RESOLVED'});
    const noFalseAlert=await evaluatePersistedScheduledJobSignals(d,{evaluationId:'5'.repeat(64),now:902_203,disabledJobs:['feishu_sync'],sink});
    expect(noFalseAlert.every((result)=>result.status!=='OPEN'||result.notification!=='SENT')).toBe(true);
  });

  it('keeps the public callback bounded, signed, strict, no-store, and free of payload disclosure', async () => {
    const d=await setup(); const item=await createWorkItem(d); await insertOwnerIdentity(d);
    const app=createApp(); registerFeishuWorkbenchRoutes(app);
    const secret='local-test-callback-secret-at-least-thirty-two'; const now=Date.now();
    const base:AppBindings={DB:d,FEISHU_WORKBENCH_CALLBACK_ENABLED:'true',FEISHU_WORKBENCH_CALLBACK_SECRET:secret};
    const body=JSON.stringify({event_id:'http-callback-001',tenant_key:'tenant-local',open_id:'open-owner',action:'REASSIGN_WORK_ITEM',work_item_id:item.workItemId,expected_version:1,target_staff_id:'pre-2',reason:'本地任务改派'});
    const headers=async(bodyValue:string,nonce='http-nonce-001')=>({'Content-Type':'application/json','X-Feishu-Workbench-Timestamp':String(now),'X-Feishu-Workbench-Nonce':nonce,'X-Feishu-Workbench-Signature':await signature(secret,String(now),nonce,bodyValue)});
    const disabled=await app.request('/api/feishu-workbench/callback',{method:'POST',body}, {DB:d});
    expect([disabled.status,disabled.headers.get('cache-control')]).toEqual([503,'no-store']);
    const first=await app.request('/api/feishu-workbench/callback',{method:'POST',headers:await headers(body),body},base);
    expect(first.status).toBe(200); expect(first.headers.get('cache-control')).toBe('no-store');
    const replay=await app.request('/api/feishu-workbench/callback',{method:'POST',headers:await headers(body),body},base);
    expect(replay.status).toBe(200);
    expect(await replay.text()).not.toMatch(/secret|payload|token|object_key|reason/u);
    expect((await app.request('/api/feishu-workbench/callback',{method:'POST',headers:{...(await headers(body)),'X-Feishu-Workbench-Signature':'0'.repeat(64)},body},base)).status).toBe(401);
    expect((await app.request('/api/feishu-workbench/callback',{method:'POST',headers:{...(await headers(body)),'X-Feishu-Workbench-Timestamp':String(now-300_001)},body},base)).status).toBe(401);
    const oversized=`{"event_id":"${'x'.repeat(17_000)}"}`;
    expect((await app.request('/api/feishu-workbench/callback',{method:'POST',headers:await headers(oversized,'http-nonce-large'),body:oversized},base)).status).toBe(400);
    const extra=JSON.stringify({...JSON.parse(body),event_id:'http-callback-extra',extra:'forbidden'});
    expect((await app.request('/api/feishu-workbench/callback',{method:'POST',headers:await headers(extra,'http-nonce-extra'),body:extra},base)).status).toBe(400);
    const collision=JSON.stringify({...JSON.parse(body),event_id:'http-callback-collision'});
    expect((await app.request('/api/feishu-workbench/callback',{method:'POST',headers:await headers(collision),body:collision},base)).status).toBe(401);
  });
});

async function insertOwnerIdentity(d: SqliteDatabase): Promise<void> { d.exec("INSERT INTO feishu_staff_identities(id,staff_id,tenant_key,open_id,user_id,status,verified_at,created_at,updated_at,revoked_at) VALUES ('identity-owner','zz-phase3h-test-owner','tenant-local','open-owner',NULL,'ACTIVE',1,1,1,NULL)"); }

async function setup(): Promise<SqliteDatabase> {
  database = createMigratedTestDatabase();
  database.exec(`
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at) VALUES ('pre-1','售前一号','ACTIVE',1,1,1,1,NULL);
    INSERT INTO staff_role_assignments(staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at) VALUES ('pre-1','pre_sales','ACTIVE','zz-phase3h-test-owner',1,NULL,1,1);
    INSERT INTO staff_team_memberships(staff_id,team_id,status,joined_at,ended_at,created_at,updated_at) VALUES ('pre-1','phase3h-test-team','ACTIVE',1,NULL,1,1);
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at) VALUES ('pre-2','售前二号','ACTIVE',1,1,1,1,NULL);
    INSERT INTO staff_role_assignments(staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at) VALUES ('pre-2','pre_sales','ACTIVE','zz-phase3h-test-owner',1,NULL,1,1);
    INSERT INTO staff_team_memberships(staff_id,team_id,status,joined_at,ended_at,created_at,updated_at) VALUES ('pre-2','phase3h-test-team','ACTIVE',1,NULL,1,1);
    INSERT INTO buyer_channels(id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at) VALUES ('channel-local','L','本地测试','ACTIVE',1,1,1,1,NULL);
    INSERT INTO customer_identity_subjects(id,subject_type,created_at) VALUES ('subject-local','BUYER_CUSTOMER',1);
    INSERT INTO buyer_customers(id,identity_subject_id,marketplace_code,buyer_channel_id,buyer_customer_no,buyer_sequence,first_valid_order_business_date,display_name,access_status,identity_review_status,version,created_at,updated_at,activated_at,disabled_at) VALUES ('buyer-local','subject-local','JP','channel-local',NULL,NULL,NULL,'匿名买家','DISABLED','CLEAR',1,1,1,NULL,1);
  `);
  return database;
}

async function createWorkItem(d: SqliteDatabase) {
  const prepared = await prepareDirectWorkItem(d, { workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION', sourceEntityId: `reservation-local-${crypto.randomUUID()}`, marketplaceCode: 'JP', buyerCustomerId: 'buyer-local', actorType: 'SYSTEM', now: 100 });
  await d.batch(prepared.statements);
  return prepared;
}

async function signature(secret: string, timestamp: string, nonce: string, body: string): Promise<string> {
  const bodyHash = await sha256(body);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${nonce}.${bodyHash}`));
  return [...new Uint8Array(signed)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
async function sha256(value: string): Promise<string> { const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
