import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { StaffPermissionCode } from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { registerStaffAccessManagementRoutes } from './routes';

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

describe('staff access management HTTP boundary', () => {
  it('returns only the owner-safe projection and accepts an exact team-bound invitation', async () => {
    database = createMigratedTestDatabase();
    const app = routeApp(owner());

    const overview = await app.request(
      'https://api.example.test/api/staff/access-management',
      undefined,
      { DB: database },
    );
    expect(overview.status).toBe(200);
    expect(overview.headers.get('Cache-Control')).toBe('no-store');
    const overviewText = await overview.text();
    expect(overviewText).toContain('phase3h-test-team');
    expect(overviewText).not.toMatch(/open_id|user_id|tenant_key|token_hash/iu);

    const created = await app.request(
      'https://api.example.test/api/staff/access-management/invitations',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'route-invitation-key-0001',
        },
        body: JSON.stringify({
          display_name: '路由员工',
          role_code: 'pre_sales',
          team_id: 'phase3h-test-team',
        }),
      },
      { DB: database },
    );
    expect(created.status).toBe(200);
    const payload = await created.json() as {
      data: { invitation: { team: { team_id: string } }; invitation_path: string };
    };
    expect(payload.data.invitation.team.team_id).toBe('phase3h-test-team');
    expect(payload.data.invitation_path).toMatch(/^\/staff\/bind\?invite=/u);
  });

  it('fails closed for non-owner, Personal DENY and non-exact bodies', async () => {
    database = createMigratedTestDatabase();
    for (const actor of [preSales(), owner(new Set(['STAFF_MANAGE']))]) {
      const response = await routeApp(actor).request(
        'https://api.example.test/api/staff/access-management',
        undefined,
        { DB: database },
      );
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain('Phase 3H Test Owner');
    }

    const malformed = await routeApp(owner()).request(
      'https://api.example.test/api/staff/access-management/invitations',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'route-invitation-key-0002',
        },
        body: JSON.stringify({
          display_name: '多余字段', role_code: 'owner', team_id: null,
          permissions: ['STAFF_MANAGE'],
        }),
      },
      { DB: database },
    );
    expect(malformed.status).toBe(400);
  });

  it('keeps invitation identity immutable, terminal and non-deletable', async () => {
    database = createMigratedTestDatabase();
    const response = await routeApp(owner()).request(
      'https://api.example.test/api/staff/access-management/invitations',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'route-invitation-key-0003',
        },
        body: JSON.stringify({
          display_name: '不可篡改', role_code: 'owner', team_id: null,
        }),
      },
      { DB: database },
    );
    const payload = await response.json() as {
      data: { invitation: { invitation_id: string } };
    };
    const id = payload.data.invitation.invitation_id;
    expect(() => database!.raw.prepare(`
      UPDATE staff_binding_invitations SET display_name='篡改' WHERE id=?
    `).run(id)).toThrow(/immutable|invalid_staff_binding_invitation_transition/u);
    expect(() => database!.raw.prepare(`
      DELETE FROM staff_binding_invitations WHERE id=?
    `).run(id)).toThrow(/cannot_be_deleted/u);
  });
});

function routeApp(actor: AssignmentStaffAuthorization): Hono<any> {
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', 'staff-access-route-request');
    context.set('staffAuthorization', actor);
    await next();
  });
  registerStaffAccessManagementRoutes(app);
  return app;
}

function owner(
  denies: ReadonlySet<StaffPermissionCode> = new Set(),
): AssignmentStaffAuthorization {
  return authorization('owner', denies);
}

function preSales(): AssignmentStaffAuthorization {
  return authorization('pre_sales', new Set());
}

function authorization(
  role: 'owner' | 'pre_sales',
  denies: ReadonlySet<StaffPermissionCode>,
): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]),
    grants: new Set(),
    denies: new Set(denies),
    memberTeamIds: ['phase3h-test-team'],
    leaderTeamIds: [],
  });
  return {
    staffId: 'zz-phase3h-test-owner',
    displayName: 'Phase 3H Test Owner',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    ...effective,
  };
}
