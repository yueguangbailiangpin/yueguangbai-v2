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
 * Stage 7.5 batch 2 request-level coverage for the company public service
 * channels: seeds are empty, owner-only updates with idempotency/version/
 * audit semantics, buyer-safe projection, and the me contact projection.
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
  init: { method: 'GET' | 'PUT'; body?: unknown; key?: string } = { method: 'GET' },
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

const SESSION_SECRET = 'stage75-test-session-secret-with-at-least-32-bytes';

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
      expect(channel['qr_file_object_id']).toBeNull();
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

  it('rejects unknown qr files and unknown bodies', async () => {
    const owner = actor('owner', 'staff-owner');
    const badQr = await staffRequest(owner, '/api/staff/service-channels/BUYER_PRE_SALES', {
      method: 'PUT',
      body: channelBody({ qr_file_object_id: 'file-does-not-exist' }),
      key: 'key-owner-badqr-001',
    });
    expect(badQr.status).toBe(400);
    const unknownCode = await staffRequest(owner, '/api/staff/service-channels/WAT', {
      method: 'PUT',
      body: channelBody(),
      key: 'key-owner-wat-0001',
    });
    expect(unknownCode.status).toBe(400);
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
    qr_file_object_id: null,
    expected_version: 1,
    reason: 'stage75 测试更新',
    ...overrides,
  };
}
