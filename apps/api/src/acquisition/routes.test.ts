import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import {
  STAFF_SESSION_COOKIE_NAME,
  type SqlDatabase,
  type SqlRunResult,
  type SqlStatement,
  type StaffPermissionCode,
  type StaffRoleCode,
} from '@ygb/contracts';
import { createApp } from '../app';
import { staffSessionMiddleware } from '../middleware/staff-auth';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { generateStaffOpaqueToken } from '../staff-auth/crypto';
import { createInternalStaffSession } from '../staff-auth/repository';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import {
  createAcquisitionAssignment,
  createAcquisitionChannel,
  recordAcquisitionConsultation,
} from './admin';
import { registerAcquisitionRoutes } from './routes';

const ORIGIN = 'https://api.local.test';
const SECRET = 'acquisition-route-secret-with-at-least-thirty-two-bytes';
let database: SqliteDatabase|null = null;
afterEach(() => { database?.close(); database = null; });

describe('acquisition HTTP authority and privacy boundary', () => {
  it('rejects buyer_refund and Personal DENY before any lead fact', async () => {
    database = db();
    for (const actor of [auth('buyer_refund','staff-refund'), deniedPreSales()]) {
      const response = await request(actor, '/api/staff/acquisition/leads', {
        method: 'POST', headers: headers(`forbidden-${actor.staffId}`),
        body: JSON.stringify(leadBody('forbidden-channel', 'forbidden_wx')),
      });
      expect(response.status).toBe(403);
    }
    expect(database.raw.prepare('SELECT COUNT(*) AS count FROM acquisition_leads').get())
      .toEqual({ count: 0 });
  });

  it('rejects unknown channel authority and cross-site writes', async () => {
    database = db();
    await seedChannelAndAssignment(database);
    const clientAuthority = await request(auth('pre_sales','staff-pre'),
      '/api/staff/acquisition/leads', {
        method: 'POST', headers: headers('client-channel-0001'),
        body: JSON.stringify(leadBody('forged-channel', 'route_wx')),
      });
    expect(clientAuthority.status).toBe(400);
    const crossSite = await request(auth('pre_sales','staff-pre'),
      '/api/staff/acquisition/leads', {
        method: 'POST', headers: { ...headers('cross-site-lead-0001'),
          Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
        body: JSON.stringify(leadBody('forged-channel', 'route_wx')),
      });
    expect(crossSite.status).toBe(403);
    expect(database.raw.prepare('SELECT COUNT(*) AS count FROM acquisition_leads').get())
      .toEqual({ count: 0 });
  });

  it('creates a lead with an explicit approved channel and never returns protected fields', async () => {
    database = db();
    const channel = await seedChannelAndAssignment(database);
    const response = await request(auth('pre_sales','staff-pre'),
      '/api/staff/acquisition/leads', {
        method: 'POST', headers: headers('route-lead-0001'),
        body: JSON.stringify({ ...leadBody(channel, 'route_secret_wx'),
          display_name: '路由买家' }),
      });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: { lead: { origin_channel_id: string; wechat_masked: string } };
    };
    expect(body.data.lead).toMatchObject({
      origin_channel_id: channel, wechat_masked: 'ro***wx',
    });
    expect(JSON.stringify(body)).not.toContain('route_secret_wx');
    expect(JSON.stringify(body)).not.toContain('identity_hash');
    expect(JSON.stringify(body)).not.toContain('identity_ciphertext');
  });

  it('enforces consultation origin, exact body, idempotency key and strict owner authority', async () => {
    database = db();
    const channel = await seedChannelAndAssignment(database);
    const body = consultationBody(channel, '2025-01-01');
    const ownerResponse = await request(auth('owner','staff-owner-route'),
      '/api/staff/acquisition/consultations', {
        method: 'POST', headers: headers('route-consultation-owner-0001'),
        body: JSON.stringify(body),
      });
    expect(ownerResponse.status).toBe(200);
    expect(await ownerResponse.json()).toMatchObject({
      data: { consultation: { channel_id: channel, person_count: 12, version: 1 },
        replayed: false },
    });

    for (const [name, init] of [
      ['cross-origin', { headers: { ...headers('route-consultation-origin-0001'),
        Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, body }],
      ['extra-body', { headers: headers('route-consultation-extra-0001'),
        body: { ...body, owner: true } }],
      ['missing-idempotency', { headers: { 'Content-Type': 'application/json', Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin' }, body }],
    ] as const) {
      const response = await request(auth('owner','staff-owner-route'),
        '/api/staff/acquisition/consultations', {
          method: 'POST', headers: init.headers,
          body: JSON.stringify({ ...init.body, business_date: '2025-01-02' }),
        });
      expect(response.status, name).toBe(name === 'cross-origin' ? 403 : 400);
    }

    const forgedAcquisition = { ...auth('acquisition','staff-acquisition-route'),
      permissions: new Set<StaffPermissionCode>(['ACQUISITION_ADMIN']) };
    for (const [index, actor] of [auth('acquisition','staff-acquisition-route'),
      forgedAcquisition, auth('pre_sales','staff-pre'), auth('seller_ops','staff-seller'),
      auth('buyer_refund','staff-refund')].entries()) {
      const response = await request(actor, '/api/staff/acquisition/consultations', {
        method: 'POST', headers: headers(`route-consultation-forbidden-${index}`),
        body: JSON.stringify({ ...body, business_date: `2025-01-${String(index + 3).padStart(2, '0')}` }),
      });
      expect(response.status).toBe(403);
    }
    expect(database.raw.prepare(`SELECT
      (SELECT COUNT(*) FROM acquisition_daily_consultations) AS consultations,
      (SELECT COUNT(*) FROM acquisition_daily_consultation_events) AS events,
      (SELECT COUNT(*) FROM audit_events
        WHERE aggregate_type='ACQUISITION_DAILY_CONSULTATION') AS audits,
      (SELECT COUNT(*) FROM command_idempotency_records
        WHERE action='RECORD_ACQUISITION_CONSULTATION') AS idempotency`).get())
      .toEqual({ consultations: 1, events: 1, audits: 1, idempotency: 1 });
  });

  it('lets acquisition use scoped operator reads but conceals cross-scope history and formal Leads', async () => {
    database = db();
    const jpChannel = await seedChannelAndAssignment(database);
    const owner = auth('owner','staff-owner-route');
    const us = await createAcquisitionChannel(database, {
      code: 'ROUTE_XHS_US', platformName: '小红书', leadType: 'BUYER',
      marketplaceCode: 'AMAZON_US', displayName: '美国站路由账号',
    }, { actor: owner, idempotencyKey: 'route-channel-us-0001',
      requestId: 'route-channel-us-request', now: 1000 });
    const jp = await recordAcquisitionConsultation(database, {
      channelId: jpChannel, businessDate: '2025-01-01', personCount: 12,
      expectedVersion: 0, reason: '日本站路由汇总',
    }, { actor: owner, idempotencyKey: 'route-consultation-jp-0001',
      requestId: 'route-consultation-jp-request', now: 1001 });
    const crossScope = await recordAcquisitionConsultation(database, {
      channelId: us.channel.channel_id, businessDate: '2025-01-01', personCount: 7,
      expectedVersion: 0, reason: '美国站路由汇总',
    }, { actor: owner, idempotencyKey: 'route-consultation-us-0001',
      requestId: 'route-consultation-us-request', now: 1002 });
    const actor = auth('acquisition','staff-acquisition-route');

    for (const path of [
      '/api/staff/acquisition/consultations?from_date=2025-01-01&to_date=2025-01-01',
      '/api/staff/acquisition/prospects?limit=25',
      `/api/staff/acquisition/consultations/${jp.consultation.consultation_id}/history`,
    ]) {
      const response = await request(actor, path, { method: 'GET' });
      expect(response.status, path).toBe(200);
    }
    const history = await request(actor,
      `/api/staff/acquisition/consultations/${crossScope.consultation.consultation_id}/history`,
      { method: 'GET' });
    expect(history.status).toBe(404);
    expect(await history.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    const formalLeads = await request(actor,
      '/api/staff/acquisition/leads?limit=25', { method: 'GET' });
    expect(formalLeads.status).toBe(403);
  });

  it('maps an unknown consultation batch failure to 503 after cleaning the claim', async () => {
    database = db();
    const channel = await seedChannelAndAssignment(database);
    const failing = new ConsultationBatchFailureDatabase(database);
    const response = await request(auth('owner','staff-owner-route'),
      '/api/staff/acquisition/consultations', {
        method: 'POST', headers: headers('route-consultation-dependency-0001'),
        body: JSON.stringify(consultationBody(channel, '2025-02-01')),
      }, failing);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'DEPENDENCY_UNAVAILABLE' } });
    expect(database.raw.prepare(`SELECT
      (SELECT COUNT(*) FROM acquisition_daily_consultations) AS consultations,
      (SELECT COUNT(*) FROM acquisition_daily_consultation_events) AS events,
      (SELECT COUNT(*) FROM audit_events
        WHERE aggregate_type='ACQUISITION_DAILY_CONSULTATION') AS audits,
      (SELECT COUNT(*) FROM command_idempotency_records
        WHERE action='RECORD_ACQUISITION_CONSULTATION' AND status='COMMITTED') AS committed`).get())
      .toEqual({ consultations: 0, events: 0, audits: 0, committed: 0 });
    expect(database.raw.prepare(`SELECT status,error_code,response_json
      FROM command_idempotency_records
      WHERE idempotency_key='route-consultation-dependency-0001'`).get())
      .toEqual({ status: 'FAILED', error_code: 'ACQUISITION_COMMAND_FAILED', response_json: null });
  });

  it('recomputes consultation authority from a real Staff cookie and current D1 facts', async () => {
    database = db();
    const channel = await seedChannelAndAssignment(database);
    const body = JSON.stringify(consultationBody(channel, '2025-03-01'));

    const missing = await trustedRequest('/api/staff/acquisition/consultations', {
      method: 'POST', headers: headers('trusted-missing-cookie-0001'), body,
    });
    expect(missing.status).toBe(401);

    const revokedToken = await seedTrustedSession('staff-owner-route');
    database.raw.prepare(`UPDATE staff_sessions SET status='REVOKED',revoked_at=?,
      revoked_reason='TEST_REVOKED',updated_at=? WHERE token_hash=(
        SELECT token_hash FROM staff_sessions WHERE staff_id='staff-owner-route'
        ORDER BY created_at DESC LIMIT 1
      )`).run(Date.now(), Date.now());
    const revoked = await trustedRequest('/api/staff/acquisition/consultations', {
      method: 'POST', headers: trustedHeaders('trusted-revoked-cookie-0001', revokedToken), body,
    });
    expect(revoked.status).toBe(401);

    insertPermissionOverride('staff-owner-route', 'ACQUISITION_ADMIN', 'DENY');
    const deniedOwnerToken = await seedTrustedSession('staff-owner-route');
    const deniedOwner = await trustedRequest('/api/staff/acquisition/consultations', {
      method: 'POST', headers: trustedHeaders('trusted-owner-deny-0001', deniedOwnerToken), body,
    });
    expect(deniedOwner.status).toBe(403);

    insertPermissionOverride('staff-acquisition-route', 'ACQUISITION_ADMIN', 'GRANT');
    database.raw.prepare(`INSERT INTO staff_team_leaders (
      staff_id,team_id,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at
    ) VALUES (?,?, 'ACTIVE','staff-owner-route',?,NULL,?,?)`)
      .run('staff-acquisition-route', 'phase3h-test-team', 2000, 2000, 2000);
    const legacyToken = await seedTrustedSession('staff-acquisition-route');
    const legacyExpansion = await trustedRequest('/api/staff/acquisition/consultations', {
      method: 'POST', headers: trustedHeaders('trusted-legacy-expansion-0001', legacyToken), body,
    });
    expect(legacyExpansion.status).toBe(403);

    const driftToken = await seedTrustedSession('staff-pre');
    database.raw.prepare(`UPDATE staff_users SET authorization_version=authorization_version+1,
      updated_at=updated_at+1 WHERE id='staff-pre'`).run();
    const drift = await trustedRequest('/api/staff/acquisition/consultations', {
      method: 'POST', headers: trustedHeaders('trusted-version-drift-0001', driftToken), body,
    });
    expect(drift.status).toBe(401);

    expect(database.raw.prepare(`SELECT COUNT(*) AS count
      FROM command_idempotency_records
      WHERE idempotency_key IN (
        'trusted-missing-cookie-0001','trusted-revoked-cookie-0001',
        'trusted-owner-deny-0001','trusted-legacy-expansion-0001',
        'trusted-version-drift-0001'
      )`).get()).toEqual({ count: 0 });
  });
});

async function request(
  actor: AssignmentStaffAuthorization,
  path: string,
  init: RequestInit,
  boundDatabase: SqlDatabase = database!,
) {
  const app = createApp();
  app.use('/api/staff/*', async (context,next) => {
    context.set('staffAuthorization', actor); await next();
  });
  registerAcquisitionRoutes(app);
  return app.request(`${ORIGIN}${path}`, init, {
    DB: boundDatabase, CUSTOMER_SECURITY_TOKEN_SECRET: SECRET,
  });
}
async function trustedRequest(path: string, init: RequestInit) {
  const app = createApp();
  app.use('/api/staff/*', staffSessionMiddleware());
  registerAcquisitionRoutes(app);
  return app.request(`${ORIGIN}${path}`, init, {
    DB: database!, CUSTOMER_SECURITY_TOKEN_SECRET: SECRET,
  });
}
function headers(key: string) {
  return { 'Content-Type': 'application/json', 'Idempotency-Key': key,
    Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' };
}
function trustedHeaders(key: string, token: string) {
  return { ...headers(key), Cookie: `${STAFF_SESSION_COOKIE_NAME}=${token}` };
}
function db() {
  const value = createMigratedTestDatabase();
  value.exec(`
    INSERT INTO staff_users (id,display_name,status,authorization_version,version,
      created_at,updated_at,disabled_at,session_version) VALUES
      ('staff-owner-route','总管理员','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-acquisition-route','获客','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-pre','售前','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-seller','卖家对接','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-refund','买家返款','ACTIVE',1,1,1000,1000,NULL,1);
    INSERT INTO staff_role_assignments (staff_id,role_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,created_at,updated_at) VALUES
      ('staff-owner-route','owner','ACTIVE',NULL,1000,NULL,1000,1000),
      ('staff-acquisition-route','acquisition','ACTIVE','staff-owner-route',1000,NULL,1000,1000),
      ('staff-pre','pre_sales','ACTIVE','staff-owner-route',1000,NULL,1000,1000),
      ('staff-seller','seller_ops','ACTIVE','staff-owner-route',1000,NULL,1000,1000),
      ('staff-refund','buyer_refund','ACTIVE','staff-owner-route',1000,NULL,1000,1000);
    INSERT INTO staff_team_memberships (staff_id,team_id,status,joined_at,ended_at,
      created_at,updated_at) VALUES
      ('staff-pre','phase3h-test-team','ACTIVE',1000,NULL,1000,1000),
      ('staff-acquisition-route','phase3h-test-team','ACTIVE',1000,NULL,1000,1000),
      ('staff-seller','phase3h-test-team','ACTIVE',1000,NULL,1000,1000),
      ('staff-refund','phase3h-test-team','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_marketplace_scopes (
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES
      ('scope-route-pre-primary','staff-pre','pre_sales','AMAZON_JP','ACTIVE','staff-owner-route',1000,NULL,'TEST',1000,1000,'PRIMARY'),
      ('scope-route-acquisition-primary','staff-acquisition-route','acquisition','AMAZON_JP','ACTIVE','staff-owner-route',1000,NULL,'TEST',1000,1000,'PRIMARY'),
      ('scope-route-seller-primary','staff-seller','seller_ops','AMAZON_JP','ACTIVE','staff-owner-route',1000,NULL,'TEST',1000,1000,'PRIMARY'),
      ('scope-route-refund-primary','staff-refund','buyer_refund','AMAZON_JP','ACTIVE','staff-owner-route',1000,NULL,'TEST',1000,1000,'PRIMARY');
  `);
  return value;
}
async function seedChannelAndAssignment(db: SqliteDatabase) {
  const owner = auth('owner','staff-owner-route');
  const channel = await createAcquisitionChannel(db, {
    code: 'ROUTE_XHS', platformName: '小红书', leadType: 'BUYER',
    marketplaceCode: 'AMAZON_JP', displayName: '路由账号',
  }, { actor: owner, idempotencyKey: 'route-channel-0001',
    requestId: 'route-channel-request', now: 1000 });
  db.raw.prepare(`UPDATE acquisition_channel_privacy_profiles
    SET intake_wechat_label='路由测试工作微信',version=version+1,updated_at=1000
    WHERE channel_id=?`).run(channel.channel.channel_id);
  await createAcquisitionAssignment(db, {
    staffId: 'staff-pre', leadType: 'BUYER', channelId: channel.channel.channel_id,
    effectiveFrom: 0, effectiveUntil: null,
  }, { actor: owner, idempotencyKey: 'route-assignment-0001',
    requestId: 'route-assignment-request', now: 1000 });
  return channel.channel.channel_id;
}
function leadBody(channelId: string, wechatId: string) {
  return { lead_type: 'BUYER', marketplace_code: 'AMAZON_JP', channel_id: channelId,
    prospect_id: null, wechat_id: wechatId, display_name: null, note: null };
}
function consultationBody(channelId: string, businessDate: string) {
  return { channel_id: channelId, business_date: businessDate, person_count: 12,
    expected_version: 0, reason: '路由每日汇总' };
}
function auth(role: StaffRoleCode, staffId: string): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({ roles: new Set([role]),
    grants: new Set<StaffPermissionCode>(), denies: new Set<StaffPermissionCode>(),
    memberTeamIds: role === 'owner' ? [] : ['phase3h-test-team'], leaderTeamIds: [] });
  return { staffId, displayName: staffId, staffStatus: 'ACTIVE',
    authorizationVersion: 1, ...effective };
}
function deniedPreSales(): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({ roles: new Set(['pre_sales']),
    grants: new Set<StaffPermissionCode>(),
    denies: new Set<StaffPermissionCode>(['ACQUISITION_BUYER_LEAD']),
    memberTeamIds: ['phase3h-test-team'], leaderTeamIds: [] });
  return { staffId: 'staff-pre', displayName: 'staff-pre', staffStatus: 'ACTIVE',
    authorizationVersion: 1, ...effective };
}

async function seedTrustedSession(staffId: string): Promise<string> {
  const staff = database!.raw.prepare(`SELECT display_name,status,authorization_version,
    session_version FROM staff_users WHERE id=?`).get(staffId) as {
      display_name: string;
      status: 'ACTIVE';
      authorization_version: number;
      session_version: number;
    };
  const token = generateStaffOpaqueToken();
  const now = Date.now();
  await createInternalStaffSession(database!, {
    token,
    identity: {
      identity_id: `test-identity-${staffId}`,
      staff_id: staffId,
      identity_status: 'ACTIVE',
      identity_user_id: null,
      display_name: staff.display_name,
      staff_status: staff.status,
      authorization_version: Number(staff.authorization_version),
      session_version: Number(staff.session_version),
    },
    requestId: `test-session-${staffId}-${crypto.randomUUID()}`,
    now,
    expiresAt: now + 60_000,
  });
  return token;
}

function insertPermissionOverride(
  staffId: string,
  permission: StaffPermissionCode,
  effect: 'GRANT'|'DENY',
): void {
  // Migration 0054 blocks new active GRANT rows. Temporarily remove and restore
  // only the insert guard so this fixture can represent a row that survived
  // from before that migration; the request itself runs with the guard restored.
  if (effect === 'GRANT') {
    database!.exec(`DROP TRIGGER trg_staff_permission_override_deny_only_insert;`);
  }
  database!.raw.prepare(`INSERT INTO staff_permission_overrides (
    staff_id,permission_code,effect,status,reason,assigned_by_staff_id,
    assigned_at,revoked_at,created_at,updated_at
  ) VALUES (?,?,?,'ACTIVE','ROUTE_SECURITY_TEST','staff-owner-route',2000,NULL,2000,2000)`)
    .run(staffId, permission, effect);
  if (effect === 'GRANT') {
    database!.exec(`CREATE TRIGGER trg_staff_permission_override_deny_only_insert
      BEFORE INSERT ON staff_permission_overrides
      WHEN NEW.status='ACTIVE' AND NEW.effect='GRANT'
      BEGIN
        SELECT RAISE(ABORT,'staff_permission_active_grant_forbidden');
      END;`);
  }
}

class ConsultationBatchFailureDatabase implements SqlDatabase {
  constructor(private readonly target: SqlDatabase) {}
  prepare(sql: string): SqlStatement { return this.target.prepare(sql); }
  batch(_statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
    return Promise.reject(new Error('injected_consultation_dependency_failure'));
  }
}
