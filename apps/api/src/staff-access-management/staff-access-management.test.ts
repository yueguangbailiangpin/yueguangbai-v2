import { afterEach, describe, expect, it } from 'vitest';
import {
  STAFF_SESSION_COOKIE_NAME,
  type SqlDatabase,
  type StaffPermissionCode,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import app from '../index';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import { FakeStaffAuthProvider } from '../staff-auth/provider';
import {
  changeStaffAccessStatus,
  changeStaffRole,
} from './lifecycle';
import {
  cancelStaffBindingInvitation,
  createStaffBindingInvitation,
} from './invitations';
import { readStaffAccessManagementOverview } from './read-model';

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

describe('staff access and Feishu binding management', () => {
  it('stores only invitation hashes, replays without the secret and projects no Provider identifiers', async () => {
    database = createMigratedTestDatabase();
    const command = {
      actor: ownerActor(), idempotencyKey: 'staff-invite-test-0001',
      requestId: 'invite-request-1', now: 1_000,
    };
    const first = await createStaffBindingInvitation(database, {
      displayName: ' 新员工 ', roleCode: 'pre_sales',
      teamId: 'phase3h-test-team',
    }, command);
    expect(first.replayed).toBe(false);
    expect(first.invitation_path).toMatch(/^\/staff\/bind\?invite=[A-Za-z0-9_-]{43}$/u);
    const token = new URL(first.invitation_path!, 'https://app.test')
      .searchParams.get('invite')!;

    const replay = await createStaffBindingInvitation(database, {
      displayName: ' 新员工 ', roleCode: 'pre_sales',
      teamId: 'phase3h-test-team',
    }, { ...command, now: 1_100 });
    expect(replay.replayed).toBe(true);
    expect(replay.invitation_path).toBeNull();

    const persisted = database.raw.prepare(`
      SELECT token_hash FROM staff_binding_invitations WHERE id=?
    `).get(first.invitation.invitation_id) as { token_hash: string };
    expect(persisted.token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(persisted.token_hash).not.toContain(token);
    const serializedCommands = JSON.stringify(database.raw.prepare(`
      SELECT response_json,result_references_json
      FROM command_idempotency_records
      WHERE action='CREATE_STAFF_BINDING_INVITATION'
    `).all());
    expect(serializedCommands).not.toContain(token);

    const overview = await readStaffAccessManagementOverview(database, 1_100);
    const serialized = JSON.stringify(overview);
    expect(serialized).toContain('新员工');
    expect(serialized).not.toMatch(/open_id|user_id|tenant_key|token_hash|state_hash/iu);
  });

  it('binds one verified employee through the existing provision command and keeps normal unknown login closed', async () => {
    database = createMigratedTestDatabase();
    const created = await createStaffBindingInvitation(database, {
      displayName: '飞书员工', roleCode: 'seller_ops',
      teamId: 'phase3h-test-team',
    }, {
      actor: ownerActor(), idempotencyKey: 'staff-invite-test-0002',
      requestId: 'invite-request-2', now: Date.now(),
    });
    const inviteToken = new URL(created.invitation_path!, 'https://app.test')
      .searchParams.get('invite')!;
    const bindings = authEnv(database, 'open-new-staff', 'user-new-staff');
    const start = await app.request(
      'https://api.example.test/api/staff-auth/binding/start',
      {
        method: 'POST',
        headers: {
          Origin: 'https://staff.example.test',
          'Sec-Fetch-Site': 'same-origin',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ invite_token: inviteToken }),
      },
      bindings,
    );
    expect(start.status).toBe(200);
    const startBody = await start.json() as {
      data: { authorization_url: string };
    };
    const state = new URL(startBody.data.authorization_url)
      .searchParams.get('state');
    expect(state).toHaveLength(43);

    const callback = await app.request(
      `https://api.example.test/api/staff-auth/feishu/callback?code=test-code&state=${state}`,
      { method: 'GET', redirect: 'manual' },
      bindings,
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get('Location')).toBe('/staff');
    expect(callback.headers.getSetCookie().join(';')).toContain(
      `${STAFF_SESSION_COOKIE_NAME}=`,
    );
    const employee = database.raw.prepare(`
      SELECT staff.id,staff.display_name,staff.status,role.role_code,
        identity.open_id,identity.status AS identity_status
      FROM staff_users staff
      JOIN staff_role_assignments role ON role.staff_id=staff.id
        AND role.status='ACTIVE'
      JOIN feishu_staff_identities identity ON identity.staff_id=staff.id
        AND identity.status='ACTIVE'
      WHERE identity.open_id='open-new-staff'
    `).get() as Record<string, unknown>;
    expect(employee).toMatchObject({
      display_name: '飞书员工', status: 'ACTIVE', role_code: 'seller_ops',
      identity_status: 'ACTIVE',
    });
    expect(database.raw.prepare(`
      SELECT status,consumed_staff_id FROM staff_binding_invitations WHERE id=?
    `).get(created.invitation.invitation_id)).toEqual({
      status: 'CONSUMED', consumed_staff_id: employee['id'],
    });

    const replay = await app.request(
      `https://api.example.test/api/staff-auth/feishu/callback?code=test-code&state=${state}`,
      { method: 'GET', redirect: 'manual' },
      bindings,
    );
    expect(replay.status).toBe(409);
    expect(Number((database.raw.prepare(`SELECT COUNT(*) AS total FROM staff_users
      WHERE display_name='飞书员工'`).get() as { total: number }).total)).toBe(1);

    const unknownBindings = authEnv(database, 'open-unknown', 'user-unknown');
    const ordinaryStart = await app.request(
      'https://api.example.test/api/staff-auth/login/start',
      {
        method: 'POST',
        headers: {
          Origin: 'https://staff.example.test',
          'Sec-Fetch-Site': 'same-origin',
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
      unknownBindings,
    );
    const ordinaryState = new URL(((await ordinaryStart.json()) as {
      data: { authorization_url: string };
    }).data.authorization_url).searchParams.get('state');
    const unknown = await app.request(
      `https://api.example.test/api/staff-auth/feishu/callback?code=test-code&state=${ordinaryState}`,
      { method: 'GET', redirect: 'manual' },
      unknownBindings,
    );
    expect(unknown.status).toBe(401);
    expect(Number((database.raw.prepare(`SELECT COUNT(*) AS total FROM staff_users
      WHERE display_name<>'Phase 3H Test Owner'`).get() as { total: number }).total)).toBe(1);
  });

  it('rejects cancelled and expired invitations before Provider authorization', async () => {
    database = createMigratedTestDatabase();
    const cancelled = await createStaffBindingInvitation(database, {
      displayName: '已取消员工', roleCode: 'pre_sales',
      teamId: 'phase3h-test-team',
    }, {
      actor: ownerActor(), idempotencyKey: 'staff-invite-cancel-create-0001',
      now: 10_000,
    });
    await cancelStaffBindingInvitation(database, {
      invitationId: cancelled.invitation.invitation_id, expectedVersion: 1,
    }, {
      actor: ownerActor(), idempotencyKey: 'staff-invite-cancel-0001',
      now: 11_000,
    });
    const cancelledToken = new URL(cancelled.invitation_path!, 'https://app.test')
      .searchParams.get('invite')!;
    const cancelledStart = await app.request(
      'https://api.example.test/api/staff-auth/binding/start',
      bindingStartRequest(cancelledToken),
      authEnv(database, 'cancelled-open', 'cancelled-user'),
    );
    expect(cancelledStart.status).toBe(401);

    const expired = await createStaffBindingInvitation(database, {
      displayName: '已过期员工', roleCode: 'seller_ops',
      teamId: 'phase3h-test-team',
    }, {
      actor: ownerActor(), idempotencyKey: 'staff-invite-expired-create-0001',
      now: 20_000,
    });
    database.raw.prepare(`
      UPDATE staff_binding_invitations
      SET status='EXPIRED',version=version+1,updated_at=expires_at
      WHERE id=?
    `).run(expired.invitation.invitation_id);
    const expiredToken = new URL(expired.invitation_path!, 'https://app.test')
      .searchParams.get('invite')!;
    const expiredStart = await app.request(
      'https://api.example.test/api/staff-auth/binding/start',
      bindingStartRequest(expiredToken),
      authEnv(database, 'expired-open', 'expired-user'),
    );
    expect(expiredStart.status).toBe(401);
  });

  it('changes another employee role/status, revokes sessions and protects self and final owner', async () => {
    database = createMigratedTestDatabase();
    seedEmployee(database);
    const role = await changeStaffRole(database, {
      staffId: 'managed-staff', roleCode: 'buyer_refund', expectedVersion: 1,
    }, {
      actor: ownerActor(), idempotencyKey: 'staff-role-test-0001',
      requestId: 'role-request', now: 2_000,
    });
    expect(role.employee).toMatchObject({
      staff_id: 'managed-staff', status: 'ACTIVE', version: 2,
      role: { code: 'buyer_refund' },
    });
    expect(database.raw.prepare(`
      SELECT authorization_version,session_version,version
      FROM staff_users WHERE id='managed-staff'
    `).get()).toEqual({ authorization_version: 2, session_version: 2, version: 2 });
    expect(database.raw.prepare(`
      SELECT status,revoked_reason FROM staff_sessions WHERE id='managed-session-1'
    `).get()).toEqual({ status: 'REVOKED', revoked_reason: 'STAFF_ACCESS_CHANGED' });
    const roleReplay = await changeStaffRole(database, {
      staffId: 'managed-staff', roleCode: 'buyer_refund', expectedVersion: 1,
    }, {
      actor: ownerActor(), idempotencyKey: 'staff-role-test-0001',
      requestId: 'role-request', now: 2_100,
    });
    expect(roleReplay.replayed).toBe(true);

    const disabled = await changeStaffAccessStatus(database, {
      staffId: 'managed-staff', status: 'DISABLED', expectedVersion: 2,
    }, {
      actor: ownerActor(), idempotencyKey: 'staff-status-test-0001',
      requestId: 'status-request', now: 3_000,
    });
    expect(disabled.employee).toMatchObject({ status: 'DISABLED', version: 3 });
    await expect(changeStaffAccessStatus(database, {
      staffId: 'managed-staff', status: 'ACTIVE', expectedVersion: 2,
    }, {
      actor: ownerActor(), idempotencyKey: 'staff-status-stale-0001', now: 3_100,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    const enabled = await changeStaffAccessStatus(database, {
      staffId: 'managed-staff', status: 'ACTIVE', expectedVersion: 3,
    }, {
      actor: ownerActor(), idempotencyKey: 'staff-status-enable-0001', now: 3_200,
    });
    expect(enabled.employee).toMatchObject({ status: 'ACTIVE', version: 4 });
    expect(Number((database.raw.prepare(`
      SELECT COUNT(*) AS total FROM staff_authorization_events
      WHERE staff_id='managed-staff'
    `).get() as { total: number }).total)).toBe(3);
    expect(Number((database.raw.prepare(`
      SELECT COUNT(*) AS total FROM integration_outbox
      WHERE aggregate_type='STAFF' AND aggregate_id='managed-staff'
    `).get() as { total: number }).total)).toBe(3);

    await expect(changeStaffAccessStatus(database, {
      staffId: 'zz-phase3h-test-owner', status: 'DISABLED', expectedVersion: 1,
    }, {
      actor: ownerActor(), idempotencyKey: 'staff-status-self-0001', now: 4_000,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT', status: 409 });

    const otherActor = { ...ownerActor(), staffId: 'another-owner' };
    await expect(changeStaffRole(database, {
      staffId: 'zz-phase3h-test-owner', roleCode: 'pre_sales', expectedVersion: 1,
    }, {
      actor: otherActor, idempotencyKey: 'staff-role-last-owner-0001', now: 5_000,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT', status: 409 });
  });
});

function ownerActor() {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set(['owner'] as const),
    grants: new Set<StaffPermissionCode>(),
    denies: new Set<StaffPermissionCode>(),
    memberTeamIds: [], leaderTeamIds: [],
  });
  return {
    staffId: 'zz-phase3h-test-owner', displayName: 'Phase 3H Test Owner',
    staffStatus: 'ACTIVE' as const, authorizationVersion: 1, ...effective,
  };
}

function bindingStartRequest(inviteToken: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      Origin: 'https://staff.example.test',
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ invite_token: inviteToken }),
  };
}

function authEnv(target: SqlDatabase, openId: string, userId: string) {
  return {
    DB: target,
    STAFF_AUTH_PROVIDER: 'FEISHU' as const,
    STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT:
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    STAFF_AUTH_FEISHU_TOKEN_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
    STAFF_AUTH_FEISHU_APP_ID: 'cli_staff_access_test',
    STAFF_AUTH_FEISHU_APP_SECRET: 'test-only-app-secret',
    STAFF_AUTH_FEISHU_SCOPE: 'contact:user.base:readonly',
    STAFF_AUTH_FEISHU_TENANT_KEY: 'tenant-staff-access',
    STAFF_AUTH_FEISHU_REDIRECT_URI:
      'https://api.example.test/api/staff-auth/feishu/callback',
    STAFF_AUTH_ALLOWED_ORIGINS: 'https://staff.example.test',
    STAFF_AUTH_ALLOWED_RETURN_TO: '/staff',
    STAFF_AUTH_HASH_SECRET: 'staff-access-test-hash-secret-at-least-32-chars',
    STAFF_AUTH_PROVIDER_ADAPTER: new FakeStaffAuthProvider({
      provider: 'FEISHU', tenantKey: 'tenant-staff-access', openId, userId,
    }),
  };
}

function seedEmployee(target: SqliteDatabase): void {
  target.exec(`
    INSERT INTO staff_users (
      id,display_name,status,authorization_version,version,
      created_at,updated_at,disabled_at,session_version
    ) VALUES ('managed-staff','受管员工','ACTIVE',1,1,10,10,NULL,1);
    INSERT INTO staff_role_assignments (
      staff_id,role_code,status,assigned_by_staff_id,assigned_at,
      revoked_at,created_at,updated_at
    ) VALUES ('managed-staff','pre_sales','ACTIVE','zz-phase3h-test-owner',
      10,NULL,10,10);
    INSERT INTO feishu_staff_identities (
      id,staff_id,tenant_key,open_id,user_id,status,verified_at,
      created_at,updated_at,revoked_at
    ) VALUES ('managed-identity','managed-staff','tenant-staff-access',
      'managed-open','managed-user','ACTIVE',10,10,10,NULL);
    INSERT INTO staff_team_memberships (
      staff_id,team_id,status,joined_at,ended_at,created_at,updated_at
    ) VALUES ('managed-staff','phase3h-test-team','ACTIVE',10,NULL,10,10);
    INSERT INTO staff_sessions (
      id,token_hash,staff_id,issued_session_version,
      issued_authorization_version,status,expires_at,revoked_at,
      revoked_reason,created_at,updated_at
    ) VALUES ('managed-session-1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'managed-staff',1,1,'ACTIVE',999999,NULL,NULL,10,10);
  `);
}
