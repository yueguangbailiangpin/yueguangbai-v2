import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { StaffPermissionCode, StaffRoleCode } from '@ygb/contracts';
import { createApp } from '../app';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import { registerAdminBusinessDashboardRoutes } from './routes';

const ORIGIN = 'https://api.local.test';
let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

describe('admin business dashboard HTTP authority', () => {
  it('returns no-store owner-only data and no private fields', async () => {
    database = createMigratedTestDatabase();
    const response = await request(owner(),
      '/api/staff/admin-business-dashboard/summary?window=TODAY');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain('Asia/Shanghai');
    expect(serialized).not.toMatch(
      /wechat_masked|identity_hash|ciphertext|internal_note|object_key|file_object/iu,
    );
  });

  it('fails closed for non-owner, inactive owner and Personal DENY', async () => {
    database = createMigratedTestDatabase();
    for (const actor of [
      auth('pre_sales'),
      undefined,
      auth('owner', ['FINANCIAL_VIEW']),
    ]) {
      const response = await request(actor,
        '/api/staff/admin-business-dashboard/summary?window=TODAY');
      expect([401, 403]).toContain(response.status);
      const body = JSON.stringify(await response.json());
      expect(body).not.toContain('projected_profit');
      expect(body).not.toContain('buyer_funnel');
    }
  });

  it('rejects duplicate and unknown bounded queries on live endpoints', async () => {
    database = createMigratedTestDatabase();
    for (const path of [
      '/api/staff/admin-business-dashboard/summary?window=TODAY&window=WEEK',
      '/api/staff/admin-business-dashboard/summary?window=TODAY&owner=true',
      '/api/staff/admin-business-dashboard/financial-projection?from_date=2026-08-01&to_date=2026-08-08&extra=1',
    ]) {
      const response = await request(owner(), path);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'VALIDATION_ERROR' },
      });
    }
  });

  it('returns 404 for retired dashboard endpoints instead of compatibility behavior', async () => {
    database = createMigratedTestDatabase();
    for (const path of [
      '/api/staff/admin-business-dashboard/trends?from_date=2025-01-01&to_date=2026-08-01&granularity=DAY',
      '/api/staff/admin-business-dashboard/drill-down?metric=NEW_BUYERS&from_date=2026-08-01&to_date=2026-08-08&limit=101',
      '/api/staff/admin-business-dashboard/acquisition-daily?from_date=2026-08-01&to_date=2026-08-08',
    ]) {
      const response = await request(owner(), path);
      expect(response.status).toBe(404);
    }
  });
});

async function request(
  actor: AssignmentStaffAuthorization | undefined,
  path: string,
): Promise<Response> {
  const app = createApp();
  app.use('/api/staff/*', async (context, next) => {
    context.set('staffAuthorization', actor);
    await next();
  });
  registerAdminBusinessDashboardRoutes(app);
  return app.request(`${ORIGIN}${path}`, {}, { DB: database! });
}

function owner(): AssignmentStaffAuthorization {
  return auth('owner');
}

function auth(
  role: StaffRoleCode,
  denies: readonly StaffPermissionCode[] = [],
): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]),
    grants: new Set<StaffPermissionCode>(),
    denies: new Set(denies),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId: `dashboard-${role}`,
    displayName: role,
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    ...effective,
  };
}
