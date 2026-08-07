import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { parseFeishuWorkbenchTaskSummaryDto } from '@ygb/contracts';
import { prepareDirectWorkItem } from '../staff-assignment/assignment-service';
import { handleFeishuWorkbenchCallback, verifyFeishuWorkbenchSignature } from './callback';
import { FeishuWorkbenchAdapterError, MockFeishuWorkbenchAdapter } from './mock-adapter';
import { feishuWorkbenchRuntime } from './runtime';
import { runFeishuWorkbenchSyncBatch } from './sync';

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
    expect(replay).toMatchObject({ outcome: 'DUPLICATE', work_item_id: item.workItemId, version: 2 });
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
});

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
  const prepared = await prepareDirectWorkItem(d, { workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION', sourceEntityId: 'reservation-local', marketplaceCode: 'JP', buyerCustomerId: 'buyer-local', actorType: 'SYSTEM', now: 100 });
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
