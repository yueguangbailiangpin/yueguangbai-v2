import type {
  StaffDataScope,
  SqlDatabase,
} from '@ygb/contracts';
import {
  resolveAssignmentStaffAuthorization,
  resolveStaffDataScope,
  type AssignmentStaffAuthorization,
} from '../staff-assignment';
import { StaffAuthError } from './errors';
import {
  findStaffSessionByToken,
  type StaffSessionRow,
} from './repository';

interface StaffVersionRow {
  id: string;
  status: 'ACTIVE' | 'DISABLED';
  authorization_version: number;
  session_version: number;
}

export interface TrustedStaffSessionContext {
  session: StaffSessionRow;
  authorization: AssignmentStaffAuthorization;
  dataScope: StaffDataScope;
}

export async function resolveTrustedStaffSession(
  database: SqlDatabase,
  token: string,
  now: number = Date.now(),
): Promise<TrustedStaffSessionContext> {
  const session = await findStaffSessionByToken(database, token);
  if (!session) {
    throw new StaffAuthError('UNAUTHENTICATED', 401, {
      reason: 'SESSION_INVALID',
    });
  }
  if (session.status !== 'ACTIVE') {
    throw new StaffAuthError('UNAUTHENTICATED', 401, {
      reason: 'SESSION_REVOKED',
      session_id: session.id,
    });
  }
  if (session.expires_at <= now) {
    await database.prepare(`
      UPDATE staff_sessions
      SET status='EXPIRED', updated_at=?
      WHERE id=? AND status='ACTIVE' AND expires_at<=?
    `).bind(now, session.id, now).run();
    throw new StaffAuthError('UNAUTHENTICATED', 401, {
      reason: 'SESSION_EXPIRED',
      session_id: session.id,
    });
  }
  const staff = await database.prepare(`
    SELECT id, status, authorization_version, session_version
    FROM staff_users WHERE id=?
  `).bind(session.staff_id).first<StaffVersionRow>();
  if (!staff || staff.status !== 'ACTIVE') {
    throw new StaffAuthError('UNAUTHENTICATED', 401, {
      reason: 'STAFF_INACTIVE',
      session_id: session.id,
    });
  }
  if (Number(staff.session_version) !== session.issued_session_version) {
    throw new StaffAuthError('UNAUTHENTICATED', 401, {
      reason: 'SESSION_VERSION_CHANGED',
      session_id: session.id,
    });
  }
  if (Number(staff.authorization_version)
    !== session.issued_authorization_version) {
    throw new StaffAuthError('UNAUTHENTICATED', 401, {
      reason: 'AUTHORIZATION_CHANGED',
      session_id: session.id,
      reauthenticate: true,
    });
  }
  const authorization = await resolveAssignmentStaffAuthorization(
    database,
    session.staff_id,
  );
  if (!authorization) {
    throw new StaffAuthError('UNAUTHENTICATED', 401, {
      reason: 'AUTHORIZATION_UNAVAILABLE',
      session_id: session.id,
    });
  }
  if (authorization.authorizationVersion
    !== session.issued_authorization_version) {
    throw new StaffAuthError('UNAUTHENTICATED', 401, {
      reason: 'AUTHORIZATION_CHANGED',
      session_id: session.id,
      reauthenticate: true,
    });
  }
  const dataScope = await resolveStaffDataScope(database, authorization);
  return Object.freeze({
    session,
    authorization,
    dataScope,
  });
}
