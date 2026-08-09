import {
  STAFF_BINDING_STATE_TTL_MS,
  type SqlDatabase,
  type StaffAuthProviderAdapter,
  type VerifiedStaffProviderIdentity,
} from '@ygb/contracts';
import { provisionStaff } from '../staff/provision-staff';
import { resolveAssignmentStaffAuthorization } from '../staff-assignment';
import type { StaffAuthRuntimeConfig } from '../staff-auth/provider';
import {
  generateStaffOpaqueToken,
  hashStaffOpaqueToken,
} from '../staff-auth/crypto';
import { StaffAuthError } from '../staff-auth/errors';
import {
  resolveVerifiedStaffIdentity,
  type StaffIdentityRow,
} from '../staff-auth/repository';
import { createAuditEventStatement } from '../foundation/audit';
import { requireStaffAccessManager } from './authorization';

interface BindingInvitationRow {
  id: string;
  display_name: string;
  role_code: 'owner' | 'pre_sales' | 'seller_ops' | 'buyer_refund';
  team_id: string | null;
  issued_by_staff_id: string;
  status: 'ISSUED' | 'CONSUMED' | 'CANCELLED' | 'EXPIRED';
  expires_at: number;
  version: number;
}

export interface StaffBindingLoginStateRow {
  id: string;
  invitation_id: string;
  provider: 'FEISHU';
  tenant_key: string;
  status: 'ISSUED' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED';
  expires_at: number;
  consumed_at: number | null;
  cancelled_at: number | null;
  created_at: number;
  updated_at: number;
}

export async function startStaffBinding(
  database: SqlDatabase,
  input: {
    inviteToken: string;
    config: StaffAuthRuntimeConfig;
    provider: StaffAuthProviderAdapter;
    requestId: string;
    now?: number;
  },
): Promise<{
  authorizationUrl: string;
  expiresAt: number;
}> {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) validation();
  let tokenHash: string;
  try {
    tokenHash = await hashStaffOpaqueToken(input.inviteToken);
  } catch {
    throw new StaffAuthError('UNAUTHENTICATED', 401);
  }
  const invitation = await database.prepare(`
    SELECT id,display_name,role_code,team_id,issued_by_staff_id,status,expires_at,version
    FROM staff_binding_invitations WHERE token_hash=?
  `).bind(tokenHash).first<BindingInvitationRow>();
  if (!invitation || invitation.status !== 'ISSUED'
    || Number(invitation.expires_at) <= now) {
    throw new StaffAuthError('UNAUTHENTICATED', 401);
  }
  const state = generateStaffOpaqueToken();
  const stateHash = await hashStaffOpaqueToken(state);
  const expiresAt = Math.min(
    now + STAFF_BINDING_STATE_TTL_MS,
    Number(invitation.expires_at),
  );
  await database.prepare(`
    INSERT INTO staff_binding_login_states (
      id,state_hash,invitation_id,provider,tenant_key,status,request_id,
      expires_at,consumed_at,cancelled_at,created_at,updated_at
    ) VALUES (?, ?, ?, 'FEISHU', ?, 'ISSUED', ?, ?, NULL, NULL, ?, ?)
  `).bind(
    crypto.randomUUID(),
    stateHash,
    invitation.id,
    input.config.tenantKey,
    input.requestId,
    expiresAt,
    now,
    now,
  ).run();
  return {
    authorizationUrl: input.provider.createAuthorizationUrl({
      state,
      redirectUri: input.config.redirectUri,
      scope: input.config.scope,
    }),
    expiresAt,
  };
}

export async function isStaffBindingState(
  database: SqlDatabase,
  stateHash: string,
): Promise<boolean> {
  const row = await database.prepare(`
    SELECT 1 AS found FROM staff_binding_login_states WHERE state_hash=?
  `).bind(stateHash).first<{ found: number }>();
  return row !== null;
}

export async function consumeStaffBindingState(
  database: SqlDatabase,
  input: { stateHash: string; expectedTenantKey: string; now: number },
): Promise<StaffBindingLoginStateRow> {
  const row = await database.prepare(`
    SELECT id,invitation_id,provider,tenant_key,status,expires_at,
      consumed_at,cancelled_at,created_at,updated_at
    FROM staff_binding_login_states WHERE state_hash=?
  `).bind(input.stateHash).first<StaffBindingLoginStateRow>();
  if (!row || row.provider !== 'FEISHU'
    || row.tenant_key !== input.expectedTenantKey) {
    stateConflict('INVALID');
  }
  if (row.status !== 'ISSUED') stateConflict('REPLAYED');
  if (Number(row.expires_at) <= input.now) {
    await database.prepare(`
      UPDATE staff_binding_login_states
      SET status='EXPIRED',updated_at=?
      WHERE id=? AND status='ISSUED' AND expires_at<=?
    `).bind(input.now, row.id, input.now).run();
    stateConflict('EXPIRED');
  }
  const updated = await database.prepare(`
    UPDATE staff_binding_login_states
    SET status='CONSUMED',consumed_at=?,updated_at=?
    WHERE id=? AND status='ISSUED' AND expires_at>?
  `).bind(input.now, input.now, row.id, input.now).run();
  if (Number(updated.meta.changes) !== 1) stateConflict('REPLAYED');
  return {
    ...row,
    status: 'CONSUMED',
    consumed_at: input.now,
    updated_at: input.now,
  };
}

export async function provisionStaffFromBindingInvitation(
  database: SqlDatabase,
  input: {
    state: StaffBindingLoginStateRow;
    verifiedIdentity: VerifiedStaffProviderIdentity;
    requestId: string;
    now: number;
  },
): Promise<StaffIdentityRow> {
  const invitation = await database.prepare(`
    SELECT id,display_name,role_code,team_id,issued_by_staff_id,status,expires_at,version
    FROM staff_binding_invitations WHERE id=?
  `).bind(input.state.invitation_id).first<BindingInvitationRow>();
  if (!invitation || invitation.status !== 'ISSUED'
    || Number(invitation.expires_at) <= input.now) {
    throw new StaffAuthError('STATE_CONFLICT', 409, {
      reason: 'INVITATION_UNAVAILABLE',
    });
  }
  const issuer = requireStaffAccessManager(
    await resolveAssignmentStaffAuthorization(
      database,
      invitation.issued_by_staff_id,
    ),
  );
  let result;
  try {
    result = await provisionStaff(database, {
      displayName: invitation.display_name,
      feishu: {
        tenantKey: input.verifiedIdentity.tenantKey,
        openId: input.verifiedIdentity.openId,
        userId: input.verifiedIdentity.userId,
      },
      roles: [invitation.role_code],
      teamIds: invitation.team_id === null ? [] : [invitation.team_id],
      leaderTeamIds: [],
      permissionOverrides: [],
    }, {
      actor: {
        staffId: issuer.staffId,
        displayName: issuer.displayName,
        roles: ['owner'],
      },
      idempotencyKey: `staff-bind:${invitation.id}`,
      requestId: input.requestId,
      now: input.now,
    });
  } catch (error) {
    const candidate = error as { code?: unknown; status?: unknown };
    if (candidate.code === 'IDENTITY_CONFLICT') {
      throw new StaffAuthError('STATE_CONFLICT', 409, {
        reason: 'IDENTITY_ALREADY_BOUND',
      });
    }
    if (candidate.code === 'FORBIDDEN') {
      throw new StaffAuthError('FORBIDDEN', 403);
    }
    throw new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
  }
  try {
    await database.batch([
      database.prepare(`
        UPDATE staff_binding_invitations
        SET status='CONSUMED',consumed_staff_id=?,consumed_at=?,
          version=version+1,updated_at=?
        WHERE id=? AND status='ISSUED' AND expires_at>?
          AND version=?
      `).bind(
        result.staff_id,
        input.now,
        input.now,
        invitation.id,
        input.now,
        invitation.version,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'STAFF_BINDING_INVITATION',
        aggregateId: invitation.id,
        eventType: 'STAFF_BINDING_INVITATION_CONSUMED',
        actor: {
          type: 'STAFF',
          id: result.staff_id,
          roles: [invitation.role_code],
        },
        requestId: input.requestId,
        idempotencyKey: `staff-bind:${invitation.id}`,
        previousState: {
          status: 'ISSUED',
          version: invitation.version,
        },
        nextState: {
          status: 'CONSUMED',
          version: Number(invitation.version) + 1,
          staff_id: result.staff_id,
        },
        createdAt: input.now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM staff_binding_invitations
          WHERE id=? AND status='CONSUMED' AND consumed_staff_id=?
            AND version=?
        ) THEN 1 ELSE 0 END
      `).bind(
        invitation.id,
        result.staff_id,
        Number(invitation.version) + 1,
      ),
    ]);
  } catch {
    throw new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return resolveVerifiedStaffIdentity(database, {
    tenantKey: input.verifiedIdentity.tenantKey,
    openId: input.verifiedIdentity.openId,
    userId: input.verifiedIdentity.userId,
  });
}

function validation(): never {
  throw new StaffAuthError('VALIDATION_ERROR', 400);
}

function stateConflict(reason: string): never {
  throw new StaffAuthError('STATE_CONFLICT', 409, { reason });
}
