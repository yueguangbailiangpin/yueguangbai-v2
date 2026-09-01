import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { StaffPermissionCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  registerBuyerServiceChannelRoutes,
  registerStaffServiceChannelRoutes,
} from './routes';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { toBuyerPortalMeDto, type BuyerPortalContext } from '../buyer-portal/buyer-context';

/**
 * Stage 7.5 batch 2 + 7.5R request-level coverage for the company public
 * service channels: seeds are empty, owner-only updates with idempotency/
 * version/audit semantics, buyer-safe projection, the me contact projection,
 * and the controlled QR attach chain (purpose/visibility/verified/version/
 * foreign-link validation, idempotent replay, clear-with-revoke).
 */

const ORIGIN = 'https://api.example.test';

let database: SqliteDatabase | null = null;

beforeEach(() => {
  database = createMigratedTestDatabase();
  database.exec(`
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
    VALUES('staff-owner','渠道管理员','ACTIVE',1,1,1000,1000,NULL),('staff-pre','渠道售前','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at)
    VALUES('role-sc-owner','staff-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000),
          ('role-sc-pre','staff-pre','pre_sales','ACTIVE','staff-owner',1000,NULL,1000,1000);
    INSERT INTO customer_identity_subjects(id,subject_type,created_at)
    VALUES('sc-buyer-subject','BUYER_CUSTOMER',1000);
    INSERT INTO customer_login_accounts(id,identity_subject_id,account_type,login_identifier_display,login_identifier_normalized,status,session_version,password_change_required,version,created_at,updated_at,activated_at,disabled_at,registration_source)
    VALUES('sc-buyer-account','sc-buyer-subject','BUYER','buyer-sc','buyer-sc','ACTIVE',1,0,1,1000,1000,1000,NULL,NULL);
    INSERT OR IGNORE INTO buyer_channels(id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at)
    VALUES('buyer-channel-wechat-b','B','买家微信对接渠道 B','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO buyer_customers(id,identity_subject_id,marketplace_code,buyer_channel_id,buyer_customer_no,buyer_sequence,
      display_name,access_status,identity_review_status,version,created_at,updated_at,activated_at,disabled_at)
    VALUES('sc-buyer','sc-buyer-subject','AMAZON_JP','buyer-channel-wechat-b','20260829B90001',1,
      '渠道测试买家','ACTIVE','CLEAR',1,1000,1000,1000,NULL);
  `);
});
afterEach(() => {
  database?.close();
  database = null;
});

function actor(
  role: 'owner' | 'pre_sales' | 'buyer_refund',
  staffId: string,
  denies: StaffPermissionCode[] = [],
): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]),
    grants: new Set<StaffPermissionCode>(),
    denies: new Set(denies),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId,
    displayName: staffId,
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: effective.roles,
    permissions: effective.permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

async function staffRequest(
  actorValue: AssignmentStaffAuthorization,
  path: string,
  init: { method: 'GET' | 'PUT' | 'POST'; body?: unknown; key?: string } = { method: 'GET' },
): Promise<Response> {
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', `sc-${crypto.randomUUID()}`);
    context.set('staffAuthorization', actorValue);
    await next();
  });
  registerStaffServiceChannelRoutes(app);
  return app.request(`${ORIGIN}${path}`, {
    method: init.method,
    ...(init.body === undefined ? {} : {
      body: JSON.stringify(init.body),
      headers: {
        'content-type': 'application/json',
        ...(init.key === undefined ? {} : { 'Idempotency-Key': init.key }),
      },
    }),
  }, { DB: database! });
}

const SESSION_SECRET = 'stage75r-test-session-secret-with-at-least-32b';

async function buyerRequest(path: string): Promise<Response> {
  const token = await issueCustomerSession({
    accountId: 'sc-buyer-account',
    identitySubjectId: 'sc-buyer-subject',
    accountType: 'BUYER',
    sessionVersion: 1,
    passwordChangeRequired: false,
  }, SESSION_SECRET, {
    now: Date.now(),
    ttlMs: 60 * 60 * 1000,
  });
  const app = new Hono<any>();
  registerBuyerServiceChannelRoutes(app);
  return app.request(`${ORIGIN}${path}`, {
    headers: {
      Cookie: `__Host-ygb_customer_session=${token}`,
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
    },
  }, { DB: database!, CUSTOMER_SESSION_SECRET: SESSION_SECRET } as never);
}

/** Seed a completed SERVICE_CHANNEL_QR-style file (defaults = the valid case). */
function seedQrFile(overrides: {
  id?: string;
  purpose?: string;
  visibility?: string;
  status?: string;
  version?: number;
} = {}): string {
  const id = overrides.id ?? 'qr-file-1';
  const purpose = overrides.purpose ?? 'SERVICE_CHANNEL_QR';
  const visibility = overrides.visibility ?? 'BUYER_VISIBLE';
  const finalStatus = overrides.status ?? 'VERIFIED';
  const version = overrides.version ?? 1;
  // 真实生命周期：intent 以 ISSUED 落库（触发器要求），文件随后插入，
  // 双方再一起 UPDATE 到终态（file_objects 的 VERIFIED 守卫要求 intent 先验证）。
  database!.exec(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility,
      status, requested_file_count, manifest_hash, version, expires_at,
      failure_code, created_at, updated_at, completed_at
    ) VALUES (
      '${id}-intent', 'STAFF', 'staff-owner', '${purpose}', '${visibility}',
      'ISSUED', 1, '${'a'.repeat(64)}', 1, 10000, NULL, 1000, 1000, NULL
    );
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size,
      status, upload_token_hash, upload_expires_at, uploaded_byte_size,
      detected_mime, uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at, uploaded_at,
      verified_at, deleted_at
    ) VALUES (
      '${id}', '${id}-intent', 1, '${purpose}', '${visibility}',
      'files/v1/2026/08/${id}${'q'.repeat(30)}',
      'qr.png', 'png', 'image/png', 10, 'RESERVED', '${'b'.repeat(64)}',
      10000, NULL, NULL, NULL, NULL, 0, NULL,
      ${version}, 1000, 1000, NULL, NULL, NULL
    );
  `);
  if (finalStatus === 'VERIFIED') {
    database!.exec(`
      UPDATE file_upload_intents
      SET status='VERIFIED', updated_at=1001, completed_at=1001
      WHERE id='${id}-intent';
      UPDATE file_objects
      SET status='VERIFIED', uploaded_byte_size=10, detected_mime='image/png',
          uploaded_sha256='${'c'.repeat(64)}', updated_at=1001,
          uploaded_at=1001, verified_at=1001
      WHERE id='${id}';
    `);
  } else {
    database!.exec(`
      UPDATE file_objects
      SET status='${finalStatus}', uploaded_byte_size=10,
          detected_mime='image/png', uploaded_sha256='${'c'.repeat(64)}',
          updated_at=1001, uploaded_at=1001
      WHERE id='${id}';
    `);
  }
  return id;
}

function attachBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    file_object_id: 'qr-file-1',
    expected_file_version: 1,
    expected_version: 1,
    reason: '7.5R 受控二维码测试',
    ...overrides,
  };
}

describe('company public service channels', () => {
  it('seeds both channels empty and lets any active staff read them', async () => {
    const response = await staffRequest(actor('pre_sales', 'staff-pre'), '/api/staff/service-channels');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { channels: Array<Record<string, unknown>> };
    };
    expect(body.data.channels).toHaveLength(2);
    for (const channel of body.data.channels) {
      expect(channel['wechat_id']).toBeNull();
      expect(channel['qr_file']).toBeNull();
      expect(channel['version']).toBe(1);
    }
    // No staff identity fields exist on the rows at all.
    expect(JSON.stringify(body)).not.toContain('staff_id');
    expect(JSON.stringify(body)).not.toContain('email');
  });

  it('rejects non-owner updates with 403', async () => {
    const response = await staffRequest(
      actor('pre_sales', 'staff-pre'),
      '/api/staff/service-channels/BUYER_PRE_SALES',
      {
        method: 'PUT',
        body: channelBody(),
        key: 'key-non-owner-000001',
      },
    );
    expect(response.status).toBe(403);
  });

  it('owner updates a channel, replays idempotently and rejects mismatched payloads', async () => {
    const owner = actor('owner', 'staff-owner');
    const first = await staffRequest(owner, '/api/staff/service-channels/BUYER_AFTER_SALES', {
      method: 'PUT',
      body: channelBody({ wechat_id: 'ygb-after-sales' }),
      key: 'key-owner-00000001',
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as {
      data: { channel: Record<string, unknown>; replayed: boolean };
    };
    expect(firstBody.data.channel).toMatchObject({
      code: 'BUYER_AFTER_SALES',
      wechat_id: 'ygb-after-sales',
      version: 2,
    });

    const replay = await staffRequest(owner, '/api/staff/service-channels/BUYER_AFTER_SALES', {
      method: 'PUT',
      body: channelBody({ wechat_id: 'ygb-after-sales' }),
      key: 'key-owner-00000001',
    });
    expect(replay.status).toBe(200);
    const replayBody = await replay.json() as {
      data: { channel: Record<string, unknown>; replayed: boolean };
    };
    expect(replayBody.data.replayed).toBe(true);

    const mismatch = await staffRequest(owner, '/api/staff/service-channels/BUYER_AFTER_SALES', {
      method: 'PUT',
      body: channelBody({ wechat_id: 'ygb-other' }),
      key: 'key-owner-00000001',
    });
    expect(mismatch.status).toBe(409);

    const staleVersion = await staffRequest(owner, '/api/staff/service-channels/BUYER_AFTER_SALES', {
      method: 'PUT',
      body: channelBody({ wechat_id: 'ygb-v3', expected_version: 1 }),
      key: 'key-owner-00000002',
    });
    expect(staleVersion.status).toBe(409);

    const audit = database!.raw.prepare(
      `SELECT COUNT(*) c FROM audit_events
       WHERE aggregate_type='SERVICE_CHANNEL' AND event_type='SERVICE_CHANNEL_UPDATED'`,
    ).get() as { c: number };
    expect(audit.c).toBe(1);
  });

  it('rejects unknown qr files, unknown codes and unknown bodies', async () => {
    const owner = actor('owner', 'staff-owner');
    const unknownFile = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody({ file_object_id: 'file-does-not-exist' }),
      key: 'key-owner-qr-unk-01',
    });
    expect(unknownFile.status).toBe(400);
    const unknownCode = await staffRequest(owner, '/api/staff/service-channels/WAT/qr', {
      method: 'POST',
      body: attachBody(),
      key: 'key-owner-qr-wat-001',
    });
    expect(unknownCode.status).toBe(400);
    const legacyQrInPut = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES', {
      method: 'PUT',
      body: channelBody({ qr_file_object_id: 'qr-file-1' }),
      key: 'key-owner-legacy-001',
    });
    expect(legacyQrInPut.status).toBe(400);
    const missingKey = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody(),
    });
    expect(missingKey.status).toBe(400);
  });

  it('owner attaches a verified QR file and buyers receive only a safe reference', async () => {
    seedQrFile();
    const owner = actor('owner', 'staff-owner');
    const attach = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody(),
      key: 'key-owner-qr-att-01',
    });
    expect(attach.status).toBe(201);
    const attachBodyJson = await attach.json() as {
      data: { channel: Record<string, unknown>; replayed: boolean };
    };
    expect(attachBodyJson.data.channel['qr_file']).toEqual({
      file_object_id: 'qr-file-1',
      file_version: 1,
      purpose: 'SERVICE_CHANNEL_QR',
      visibility: 'BUYER_VISIBLE',
    });
    expect(attachBodyJson.data.channel['version']).toBe(2);
    expect(attachBodyJson.data.replayed).toBe(false);

    // Idempotent replay returns the same channel, flagged as replayed.
    const replay = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody(),
      key: 'key-owner-qr-att-01',
    });
    expect(replay.status).toBe(200);
    const replayJson = await replay.json() as {
      data: { channel: Record<string, unknown>; replayed: boolean };
    };
    expect(replayJson.data.replayed).toBe(true);
    expect(replayJson.data.channel['version']).toBe(2);

    // Exactly one attach audit event across original + replay.
    const audit = database!.raw.prepare(
      `SELECT COUNT(*) c FROM audit_events
       WHERE aggregate_type='SERVICE_CHANNEL' AND event_type='SERVICE_CHANNEL_QR_ATTACHED'`,
    ).get() as { c: number };
    expect(audit.c).toBe(1);

    // Buyer projection carries the SafeFileReference but no version metadata.
    const buyerResponse = await buyerRequest('/api/buyer-portal/service-channels');
    expect(buyerResponse.status).toBe(200);
    const buyerText = await buyerResponse.text();
    expect(buyerText).toContain('"file_object_id":"qr-file-1"');
    expect(buyerText).toContain('"purpose":"SERVICE_CHANNEL_QR"');
    expect(buyerText).not.toContain('"version"');
    expect(buyerText).not.toContain('staff-owner');
    expect(buyerText).not.toContain('updated_by');
  });

  it('rejects attach with wrong purpose, unverified status, wrong visibility, stale file version or a foreign-bound file', async () => {
    const owner = actor('owner', 'staff-owner');

    const wrongPurpose = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody({ file_object_id: seedQrFile({ id: 'qr-wrong-purpose', purpose: 'PRODUCT_IMAGE' }) }),
      key: 'key-owner-qr-prp-001',
    });
    expect(wrongPurpose.status).toBe(400);

    const unverified = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody({ file_object_id: seedQrFile({ id: 'qr-unverified', status: 'UPLOADED' }) }),
      key: 'key-owner-qr-ver-001',
    });
    expect(unverified.status).toBe(400);

    const wrongVisibility = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody({
        file_object_id: seedQrFile({ id: 'qr-internal', visibility: 'INTERNAL_ONLY' }),
      }),
      key: 'key-owner-qr-vis-001',
    });
    expect(wrongVisibility.status).toBe(400);

    seedQrFile({ id: 'qr-stale', version: 3 });
    const staleFileVersion = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody({ file_object_id: 'qr-stale', expected_file_version: 1 }),
      key: 'key-owner-qr-stl-001',
    });
    expect(staleFileVersion.status).toBe(409);

    seedQrFile({ id: 'qr-foreign' });
    // 该文件已绑定另一条渠道（不同业务对象）——attach 必须拒绝。
    database!.exec(`
      INSERT INTO file_entity_links (
        id, file_object_id, entity_type, entity_id, purpose, visibility,
        linked_by_actor_type, linked_by_actor_id, created_at,
        authorization_mode, expires_at, revoked_at
      ) VALUES (
        'foreign-link', 'qr-foreign', 'SERVICE_CHANNEL', 'BUYER_AFTER_SALES',
        'SERVICE_CHANNEL_QR', 'BUYER_VISIBLE',
        'STAFF', 'staff-owner', 1000, 'EXPLICIT_AUDIENCES',
        NULL, NULL
      );
    `);
    const foreignBound = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody({ file_object_id: 'qr-foreign' }),
      key: 'key-owner-qr-foi-001',
    });
    expect(foreignBound.status).toBe(400);

    const nonOwner = await staffRequest(actor('pre_sales', 'staff-pre'), '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody(),
      key: 'key-pre-qr-att-001',
    });
    expect(nonOwner.status).toBe(403);
  });

  it('clearing revokes the link and empties the buyer projection; replay is semantic', async () => {
    seedQrFile();
    const owner = actor('owner', 'staff-owner');
    await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody(),
      key: 'key-owner-qr-c-0001',
    });

    const wrongChannelVersion = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody({ file_object_id: null, expected_version: 1 }),
      key: 'key-owner-qr-c-0002',
    });
    expect(wrongChannelVersion.status).toBe(409);

    const clear = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody({ file_object_id: null, expected_version: 2 }),
      key: 'key-owner-qr-c-0003',
    });
    expect(clear.status).toBe(201);
    const clearJson = await clear.json() as {
      data: { channel: Record<string, unknown>; replayed: boolean };
    };
    expect(clearJson.data.channel['qr_file']).toBeNull();
    expect(clearJson.data.channel['version']).toBe(3);

    // The historical file facts stay; the link is revoked append-only.
    const link = database!.raw.prepare(
      `SELECT revoked_at FROM file_entity_links
       WHERE entity_type='SERVICE_CHANNEL' AND entity_id='BUYER_PRE_SALES'
         AND file_object_id='qr-file-1'`,
    ).get() as { revoked_at: number | null } | undefined;
    expect(link).toBeDefined();
    expect(link!['revoked_at']).not.toBeNull();

    // Clearing an already-cleared channel is a semantic replay.
    const clearReplay = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES/qr', {
      method: 'POST',
      body: attachBody({ file_object_id: null, expected_version: 3 }),
      key: 'key-owner-qr-c-0004',
    });
    expect(clearReplay.status).toBe(200);
    const clearReplayJson = await clearReplay.json() as {
      data: { channel: Record<string, unknown>; replayed: boolean };
    };
    expect(clearReplayJson.data.replayed).toBe(true);

    const buyerResponse = await buyerRequest('/api/buyer-portal/service-channels');
    const buyerText = await buyerResponse.text();
    expect(buyerText).toContain('"qr_file":null');
    expect(buyerText).not.toContain('qr-file-1');
  });

  it('exposes only public fields to buyers', async () => {
    const owner = actor('owner', 'staff-owner');
    await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES', {
      method: 'PUT',
      body: channelBody({ wechat_id: 'ygb-pre-sales' }),
      key: 'key-owner-pre-00001',
    });
    const response = await buyerRequest('/api/buyer-portal/service-channels');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('ygb-pre-sales');
    // Buyer payload never carries staff updater identity or version metadata.
    expect(text).not.toContain('updated_by');
    expect(text).not.toContain('staff-owner');
    expect(text).not.toContain('version');
  });

  it('projects the fixed owner public display names through me', async () => {
    const context = {
      preSalesOwnerDisplayName: '售前甲',
      refundOwnerDisplayName: null,
    } as unknown as BuyerPortalContext;
    const dto = toBuyerPortalMeDto(context);
    expect(dto.assigned_contacts).toEqual({
      pre_sales_owner_display_name: '售前甲',
      refund_owner_display_name: null,
    });
    // No internal staff ids/emails leak through the projection.
    expect(JSON.stringify(dto)).not.toContain('staff_id');
    expect(JSON.stringify(dto)).not.toContain('email');
  });
});

function channelBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    display_name: '售前客服',
    wechat_id: null,
    expected_version: 1,
    reason: 'stage75 测试更新',
    ...overrides,
  };
}
