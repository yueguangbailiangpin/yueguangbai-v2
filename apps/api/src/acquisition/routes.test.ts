import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { StaffPermissionCode, StaffRoleCode } from '@ygb/contracts';
import { createApp } from '../app';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import { createAcquisitionAssignment, createAcquisitionChannel } from './admin';
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
});

async function request(actor: AssignmentStaffAuthorization, path: string, init: RequestInit) {
  const app = createApp();
  app.use('/api/staff/*', async (context,next) => {
    context.set('staffAuthorization', actor); await next();
  });
  registerAcquisitionRoutes(app);
  return app.request(`${ORIGIN}${path}`, init, {
    DB: database!, CUSTOMER_SECURITY_TOKEN_SECRET: SECRET,
  });
}
function headers(key: string) {
  return { 'Content-Type': 'application/json', 'Idempotency-Key': key,
    Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' };
}
function db() {
  const value = createMigratedTestDatabase();
  value.exec(`
    INSERT INTO staff_users (id,display_name,status,authorization_version,version,
      created_at,updated_at,disabled_at,session_version) VALUES
      ('staff-owner-route','总管理员','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-pre','售前','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-refund','买家返款','ACTIVE',1,1,1000,1000,NULL,1);
    INSERT INTO staff_role_assignments (staff_id,role_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,created_at,updated_at) VALUES
      ('staff-owner-route','owner','ACTIVE',NULL,1000,NULL,1000,1000),
      ('staff-pre','pre_sales','ACTIVE','staff-owner-route',1000,NULL,1000,1000),
      ('staff-refund','buyer_refund','ACTIVE','staff-owner-route',1000,NULL,1000,1000);
    INSERT INTO staff_team_memberships (staff_id,team_id,status,joined_at,ended_at,
      created_at,updated_at) VALUES
      ('staff-pre','phase3h-test-team','ACTIVE',1000,NULL,1000,1000),
      ('staff-refund','phase3h-test-team','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_marketplace_scopes (
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES
      ('scope-route-pre-primary','staff-pre','pre_sales','AMAZON_JP','ACTIVE','staff-owner-route',1000,NULL,'TEST',1000,1000,'PRIMARY'),
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
