import {
  isStaffRoleCode,
  type SqlDatabase,
  type SqlStatement,
  type StaffAccessEmployeeDto,
  type StaffAccessSellerOrganizationAssignmentDto,
  type StaffRoleCode,
} from '@ygb/contracts';
import { canonicalJson, hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  IdempotencyError,
  markIdempotencyFailed,
} from '../../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../../staff-assignment';
import {
  isStaffEligibleForFixedDuty,
  prepareStaffAssignmentOutboxStatements,
} from '../../staff-assignment';
import { normalizeStaffEmail } from '../../staff-auth/cloudflare-access';
import { StaffAccessManagementError } from './errors';
import { readStaffAccessEmployee, readStaffSellerOrganizationAssignment } from './read-model';

interface TargetRow {
  id: string;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  authorization_version: number;
  session_version: number;
  version: number;
  role_code: string | null;
  active_role_count: number;
  email: string | null;
}
interface ScopeRow {
  role_code: string;
  marketplace_code: string;
  scope_kind: 'PRIMARY' | 'SUPPORT';
}
interface ActiveSellerManagerRow {
  id: string;
  staff_id: string;
  version: number;
}
interface SellerOrganizationRow {
  id: string;
  organization_name: string;
  marketplace_code: string;
}

export async function createStaffAccount(
  database: SqlDatabase,
  input: {
    displayName: string;
    email: string;
    roleCode: StaffRoleCode;
    marketplaceCodes: readonly string[];
  },
  actor: AssignmentStaffAuthorization,
): Promise<StaffAccessEmployeeDto> {
  requireOwner(actor);
  const displayName = text(input.displayName, 100);
  const email = normalizeStaffEmail(input.email);
  if (!email || !isStaffRoleCode(input.roleCode)) validation();
  const markets = await normalizedMarkets(database, input.roleCode, input.marketplaceCodes);
  const now = Date.now();
  const staffId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  await assertEmailAvailable(database, email, null);
  const scopeKinds = await resolveScopeKinds(database, input.roleCode, markets, null);
  const statements: SqlStatement[] = [
    database
      .prepare(
        `INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
      VALUES(?,?,'ACTIVE',1,1,?,?,NULL)`,
      )
      .bind(staffId, displayName, now, now),
    database
      .prepare(
        `INSERT INTO staff_email_identities(id,staff_id,normalized_email,status,verified_at,last_login_at,created_at,updated_at,revoked_at)
      VALUES(?, ?, ?, 'ACTIVE', NULL, NULL, ?, ?, NULL)`,
      )
      .bind(identityId, staffId, email, now, now),
    database
      .prepare(
        `INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at)
      VALUES(?,?,?,'ACTIVE',?,?,NULL,NULL,NULL,?,?)`,
      )
      .bind(crypto.randomUUID(), staffId, input.roleCode, actor.staffId, now, now, now),
    ...markets.map((market) =>
      database
        .prepare(
          `INSERT INTO staff_marketplace_scopes(
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,
      revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES(?,?,?,?,'ACTIVE',?,?,NULL,'STAFF_ACCOUNT_CREATED',?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          staffId,
          input.roleCode,
          market,
          actor.staffId,
          now,
          now,
          now,
          scopeKinds.get(market) ?? 'SUPPORT',
        ),
    ),
    database
      .prepare(
        `INSERT INTO staff_authorization_events(id,staff_id,authorization_version,event_type,actor_staff_id,request_id,idempotency_key,change_summary_json,created_at)
      VALUES(?, ?, 1, 'STAFF_PROVISIONED', ?, NULL, NULL, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        staffId,
        actor.staffId,
        canonicalJson({
          email,
          role_code: input.roleCode,
          marketplace_codes: markets,
          scope_kinds: Object.fromEntries(scopeKinds),
        }),
        now,
      ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'STAFF',
      aggregateId: staffId,
      eventType: 'STAFF_EMAIL_ACCOUNT_CREATED',
      actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
      requestId: null,
      idempotencyKey: null,
      nextState: {
        display_name: displayName,
        email,
        role_code: input.roleCode,
        marketplace_codes: markets,
        scope_kinds: Object.fromEntries(scopeKinds),
        status: 'ACTIVE',
      },
      createdAt: now,
    }),
  ];
  await database.batch(statements);
  return readStaffAccessEmployee(database, staffId);
}

export async function updateStaffAccount(
  database: SqlDatabase,
  staffId: string,
  input: {
    displayName: string;
    email: string;
    roleCode: StaffRoleCode;
    marketplaceCodes: readonly string[];
    expectedVersion: number;
  },
  actor: AssignmentStaffAuthorization,
): Promise<StaffAccessEmployeeDto> {
  requireOwner(actor);
  if (staffId === actor.staffId) stateConflict();
  const target = await targetRow(database, staffId);
  if (!target) notFound();
  if (target.version !== input.expectedVersion) versionConflict();
  if (target.active_role_count !== 1 || !isStaffRoleCode(target.role_code)) dependency();
  const displayName = text(input.displayName, 100);
  const email = normalizeStaffEmail(input.email);
  if (!email || !isStaffRoleCode(input.roleCode)) validation();
  const markets = await normalizedMarkets(database, input.roleCode, input.marketplaceCodes);
  await assertEmailAvailable(database, email, staffId);
  if (
    target.role_code === 'owner' &&
    input.roleCode !== 'owner' &&
    (await activeOwnerCount(database)) <= 1
  )
    stateConflict();
  const scopeKinds = await resolveScopeKinds(database, input.roleCode, markets, staffId);
  const now = Date.now();
  const nextVersion = target.version + 1;
  const statements: SqlStatement[] = [
    database
      .prepare(
        `UPDATE staff_users SET display_name=?,authorization_version=authorization_version+1,
      session_version=session_version+1,version=version+1,updated_at=? WHERE id=? AND version=?`,
      )
      .bind(displayName, now, staffId, target.version),
    database
      .prepare(
        `UPDATE staff_sessions SET status='REVOKED',revoked_at=?,revoked_reason='STAFF_ACCESS_CHANGED',updated_at=?
      WHERE staff_id=? AND status='ACTIVE'`,
      )
      .bind(now, now, staffId),
  ];
  if (target.email === null) {
    statements.push(
      database
        .prepare(
          `INSERT INTO staff_email_identities(id,staff_id,normalized_email,status,verified_at,last_login_at,created_at,updated_at,revoked_at)
      VALUES(?,?,?,'ACTIVE',NULL,NULL,?,?,NULL)`,
        )
        .bind(crypto.randomUUID(), staffId, email, now, now),
    );
  } else {
    statements.push(
      database
        .prepare(
          `UPDATE staff_email_identities SET normalized_email=?,updated_at=? WHERE staff_id=? AND status='ACTIVE'`,
        )
        .bind(email, now, staffId),
    );
  }
  if (target.role_code !== input.roleCode) {
    statements.push(
      database
        .prepare(
          `UPDATE staff_role_assignments SET status='REVOKED',revoked_at=?,revoked_by_staff_id=?,revoked_reason='STAFF_ACCOUNT_ROLE_CHANGED',updated_at=?
      WHERE staff_id=? AND status='ACTIVE'`,
        )
        .bind(now, actor.staffId, now, staffId),
    );
    statements.push(
      database
        .prepare(
          `INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at)
      VALUES(?,?,?,'ACTIVE',?,?,NULL,NULL,NULL,?,?)`,
        )
        .bind(crypto.randomUUID(), staffId, input.roleCode, actor.staffId, now, now, now),
    );
  }
  statements.push(
    database
      .prepare(
        `UPDATE staff_marketplace_scopes SET status='REVOKED',revoked_at=?,reason='STAFF_ACCOUNT_SCOPE_CHANGED',updated_at=?
    WHERE staff_id=? AND status='ACTIVE'`,
      )
      .bind(now, now, staffId),
  );
  for (const market of markets)
    statements.push(
      database
        .prepare(
          `INSERT INTO staff_marketplace_scopes(
    id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,revoked_at,
    reason,created_at,updated_at,scope_kind
  ) VALUES(?,?,?,?,'ACTIVE',?,?,NULL,'STAFF_ACCOUNT_SCOPE_CHANGED',?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          staffId,
          input.roleCode,
          market,
          actor.staffId,
          now,
          now,
          now,
          scopeKinds.get(market) ?? 'SUPPORT',
        ),
    );
  statements.push(
    database
      .prepare(
        `INSERT INTO staff_authorization_events(id,staff_id,authorization_version,event_type,actor_staff_id,request_id,idempotency_key,change_summary_json,created_at)
    SELECT ?,id,authorization_version,'STAFF_ACCESS_PROFILE_CHANGED',?,NULL,NULL,?,? FROM staff_users WHERE id=?`,
      )
      .bind(
        crypto.randomUUID(),
        actor.staffId,
        canonicalJson({
          display_name: displayName,
          email,
          role_code: input.roleCode,
          marketplace_codes: markets,
          scope_kinds: Object.fromEntries(scopeKinds),
        }),
        now,
        staffId,
      ),
  );
  statements.push(
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'STAFF',
      aggregateId: staffId,
      eventType: 'STAFF_ACCESS_PROFILE_CHANGED',
      actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
      requestId: null,
      idempotencyKey: null,
      previousState: {
        display_name: target.display_name,
        email: target.email,
        role_code: target.role_code,
        version: target.version,
      },
      nextState: {
        display_name: displayName,
        email,
        role_code: input.roleCode,
        marketplace_codes: markets,
        scope_kinds: Object.fromEntries(scopeKinds),
        version: nextVersion,
      },
      createdAt: now,
    }),
  );
  await database.batch(statements);
  return readStaffAccessEmployee(database, staffId);
}

export async function changeStaffAccountStatus(
  database: SqlDatabase,
  staffId: string,
  input: { status: 'ACTIVE' | 'DISABLED'; expectedVersion: number },
  actor: AssignmentStaffAuthorization,
): Promise<StaffAccessEmployeeDto> {
  requireOwner(actor);
  if (staffId === actor.staffId) stateConflict();
  const target = await targetRow(database, staffId);
  if (!target) notFound();
  if (target.version !== input.expectedVersion || target.status === input.status) versionConflict();
  if (target.active_role_count !== 1 || !isStaffRoleCode(target.role_code)) dependency();
  if (
    input.status === 'DISABLED' &&
    target.role_code === 'owner' &&
    (await activeOwnerCount(database)) <= 1
  )
    stateConflict();
  if (input.status === 'ACTIVE') {
    if (!target.email) stateConflict();
    if (target.role_code !== 'owner') {
      const row = await database
        .prepare(
          `SELECT COUNT(*) AS total FROM staff_marketplace_scopes WHERE staff_id=? AND status='ACTIVE'`,
        )
        .bind(staffId)
        .first<{ total: number }>();
      if (Number(row?.total ?? 0) < 1) stateConflict();
    }
  }
  const scopes = target.role_code === 'owner' ? [] : await activeScopes(database, staffId);
  const now = Date.now();
  const statements: SqlStatement[] = [
    database
      .prepare(
        `UPDATE staff_users SET status=?,disabled_at=?,authorization_version=authorization_version+1,
      session_version=session_version+1,version=version+1,updated_at=? WHERE id=? AND version=?`,
      )
      .bind(input.status, input.status === 'DISABLED' ? now : null, now, staffId, target.version),
    database
      .prepare(
        `UPDATE staff_sessions SET status='REVOKED',revoked_at=?,revoked_reason='STAFF_ACCESS_STATUS_CHANGED',updated_at=?
      WHERE staff_id=? AND status='ACTIVE'`,
      )
      .bind(now, now, staffId),
  ];
  if (input.status === 'DISABLED') {
    statements.push(
      database
        .prepare(
          `UPDATE staff_marketplace_scopes SET scope_kind='SUPPORT',updated_at=?
      WHERE staff_id=? AND status='ACTIVE' AND scope_kind='PRIMARY'`,
        )
        .bind(now, staffId),
    );
    for (const scope of scopes) {
      if (scope.scope_kind !== 'PRIMARY') continue;
      statements.push(
        database
          .prepare(
            `UPDATE staff_marketplace_scopes SET scope_kind='PRIMARY',updated_at=?
        WHERE id=(
          SELECT candidate.id FROM staff_marketplace_scopes candidate
          JOIN staff_users staff ON staff.id=candidate.staff_id
          WHERE candidate.role_code=? AND candidate.marketplace_code=?
            AND candidate.status='ACTIVE' AND candidate.scope_kind='SUPPORT'
            AND candidate.staff_id<>? AND staff.status='ACTIVE'
          ORDER BY candidate.assigned_at,candidate.id LIMIT 1
        ) AND NOT EXISTS(
          SELECT 1 FROM staff_marketplace_scopes primary_scope
          JOIN staff_users primary_staff ON primary_staff.id=primary_scope.staff_id
          WHERE primary_scope.role_code=? AND primary_scope.marketplace_code=?
            AND primary_scope.status='ACTIVE' AND primary_scope.scope_kind='PRIMARY'
            AND primary_staff.status='ACTIVE'
        )`,
          )
          .bind(
            now,
            scope.role_code,
            scope.marketplace_code,
            staffId,
            scope.role_code,
            scope.marketplace_code,
          ),
      );
    }
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO staff_authorization_events(id,staff_id,authorization_version,event_type,actor_staff_id,request_id,idempotency_key,change_summary_json,created_at)
      SELECT ?,id,authorization_version,'STAFF_ACCESS_STATUS_CHANGED',?,NULL,NULL,?,? FROM staff_users WHERE id=?`,
      )
      .bind(
        crypto.randomUUID(),
        actor.staffId,
        canonicalJson({ status: input.status }),
        now,
        staffId,
      ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'STAFF',
      aggregateId: staffId,
      eventType: 'STAFF_ACCESS_STATUS_CHANGED',
      actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
      requestId: null,
      idempotencyKey: null,
      previousState: { status: target.status, version: target.version },
      nextState: { status: input.status, version: target.version + 1 },
      createdAt: now,
    }),
  );
  await database.batch(statements);
  return readStaffAccessEmployee(database, staffId);
}

/**
 * Replaces the immutable fixed seller-account manager relationship.  The
 * previous assignment is only revoked; a fresh active assignment, audit row
 * and outbox event are appended in the same D1 batch.  That keeps historic
 * work items and financial facts pointing to their original owner.
 */
export async function changeSellerOrganizationManager(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    assignedStaffId: string;
    expectedAssignmentVersion: number;
    idempotencyKey: string;
    requestId: string | null;
  },
  actor: AssignmentStaffAuthorization,
): Promise<{
  seller_organization: StaffAccessSellerOrganizationAssignmentDto;
  replayed: boolean;
}> {
  requireOwner(actor);
  if (!Number.isSafeInteger(input.expectedAssignmentVersion) || input.expectedAssignmentVersion < 0)
    validation();
  const organization = await database
    .prepare(
      `SELECT id,organization_name,marketplace_code FROM seller_organizations
      WHERE id=? AND status='ACTIVE'`,
    )
    .bind(input.sellerOrganizationId)
    .first<SellerOrganizationRow>();
  if (!organization) notFound();

  const candidate = await targetRow(database, input.assignedStaffId);
  if (!candidate) notFound();
  // This control is specifically for the seller-ops fixed owner.  Owner
  // fallback remains a system safety path, not a manual directory choice.
  if (
    candidate.status !== 'ACTIVE' ||
    candidate.active_role_count !== 1 ||
    candidate.role_code !== 'seller_ops'
  )
    stateConflict();
  if (
    !(await isStaffEligibleForFixedDuty(database, {
      staffId: input.assignedStaffId,
      dutyCode: 'SELLER_ACCOUNT_MANAGER',
      marketplaceCode: organization.marketplace_code,
    }))
  )
    stateConflict();

  const requestHash = await hashCanonicalJson({
    action: 'CHANGE_SELLER_ORGANIZATION_MANAGER',
    seller_organization_id: input.sellerOrganizationId,
    assigned_staff_id: input.assignedStaffId,
    expected_assignment_version: input.expectedAssignmentVersion,
  });
  let acquired;
  try {
    acquired = await acquireIdempotency<{
      seller_organization: StaffAccessSellerOrganizationAssignmentDto;
      replayed: boolean;
    }>(database, {
      actorType: 'STAFF',
      actorId: actor.staffId,
      action: 'CHANGE_SELLER_ORGANIZATION_MANAGER',
      targetType: 'SELLER_ORGANIZATION',
      targetId: organization.id,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });
  } catch (error) {
    throw normalizeIdempotencyError(error);
  }
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  const now = Date.now();
  try {
    const active = await database
      .prepare(
        `SELECT id,staff_id,version FROM seller_staff_assignments
        WHERE seller_organization_id=? AND duty_code='SELLER_ACCOUNT_MANAGER'
          AND status='ACTIVE'`,
      )
      .bind(organization.id)
      .first<ActiveSellerManagerRow>();
    const activeVersion = active?.version ?? 0;
    if (activeVersion !== input.expectedAssignmentVersion) versionConflict();

    // A command that was retried with a different idempotency key after its
    // first commit remains safe: it observes this exact manager/version and
    // returns a semantic replay rather than rotating ownership again.
    if (active?.staff_id === input.assignedStaffId) {
      const response = {
        seller_organization: await readStaffSellerOrganizationAssignment(database, organization.id),
        replayed: true,
      } as const;
      await database.batch([
        completeIdempotencyStatement(database, acquired.claim, response, {
          resultReferences: { assignment_id: active.id },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      return response;
    }

    const assignmentId = crypto.randomUUID();
    const response: {
      seller_organization: StaffAccessSellerOrganizationAssignmentDto;
      replayed: boolean;
    } = {
      seller_organization: {
        seller_organization_id: organization.id,
        seller_organization_name: organization.organization_name,
        marketplace_code: organization.marketplace_code,
        manager: {
          assignment_id: assignmentId,
          staff_id: input.assignedStaffId,
          staff_display_name: candidate.display_name,
          version: 1,
        },
      },
      replayed: false,
    };
    const outbox = await prepareStaffAssignmentOutboxStatements(database, {
      dedupKey: `staff-assignment:${assignmentId}:fixed-owner-changed`,
      eventType: 'FIXED_OWNER_CHANGED',
      aggregateType: 'STAFF_ASSIGNMENT',
      aggregateId: assignmentId,
      payload: {
        assignment_id: assignmentId,
        seller_organization_id: organization.id,
        duty_code: 'SELLER_ACCOUNT_MANAGER',
        previous_staff_id: active?.staff_id ?? null,
        assigned_staff_id: input.assignedStaffId,
        source: 'MANUAL_REASSIGN',
      },
      now,
    });
    const statements: SqlStatement[] = [];
    if (active) {
      statements.push(
        database
          .prepare(
            `UPDATE seller_staff_assignments
            SET status='REVOKED',revoked_at=?,version=version+1,updated_at=MAX(?,updated_at+1)
            WHERE id=? AND status='ACTIVE' AND version=?`,
          )
          .bind(now, now, active.id, active.version),
      );
    }
    statements.push(
      database
        .prepare(
          `INSERT INTO seller_staff_assignments(
            id,seller_organization_id,duty_code,staff_id,status,source,
            assigned_by_actor_type,assigned_by_actor_id,reason,version,
            created_at,updated_at,revoked_at
          ) VALUES(?,?,'SELLER_ACCOUNT_MANAGER',?,'ACTIVE','MANUAL_REASSIGN',
            'STAFF',?,'STAFF_ACCESS_MANAGEMENT',1,?,?,NULL)`,
        )
        .bind(assignmentId, organization.id, input.assignedStaffId, actor.staffId, now, now),
      database
        .prepare(
          `INSERT INTO staff_assignment_events(
            id,event_type,subject_type,subject_id,duty_code,assignment_id,
            work_item_id,batch_id,old_staff_id,new_staff_id,actor_type,actor_id,
            reason,request_id,idempotency_key,metadata_json,created_at
          ) VALUES(?,'FIXED_OWNER_CHANGED','SELLER_ORGANIZATION',?,
            'SELLER_ACCOUNT_MANAGER',?,NULL,NULL,?,?,'STAFF',?,
            'STAFF_ACCESS_MANAGEMENT',?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          organization.id,
          assignmentId,
          active?.staff_id ?? null,
          input.assignedStaffId,
          actor.staffId,
          input.requestId,
          acquired.claim.idempotencyKey,
          canonicalJson({ expected_assignment_version: input.expectedAssignmentVersion }),
          now,
        ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_ORGANIZATION',
        aggregateId: organization.id,
        eventType: 'SELLER_ACCOUNT_MANAGER_CHANGED',
        actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
        requestId: input.requestId,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          assignment_id: active?.id ?? null,
          staff_id: active?.staff_id ?? null,
          assignment_version: active?.version ?? 0,
        },
        nextState: {
          assignment_id: assignmentId,
          staff_id: input.assignedStaffId,
          assignment_version: 1,
        },
        createdAt: now,
      }),
      ...outbox,
      database
        .prepare(
          `INSERT INTO transaction_assertions(assertion_value)
        SELECT CASE WHEN EXISTS(
          SELECT 1 FROM seller_staff_assignments
          WHERE id=? AND seller_organization_id=? AND staff_id=?
            AND duty_code='SELLER_ACCOUNT_MANAGER' AND status='ACTIVE'
        ) THEN 1 ELSE 0 END`,
        )
        .bind(assignmentId, organization.id, input.assignedStaffId),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { assignment_id: assignmentId },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    );
    await database.batch(statements);
    const projected = await readStaffSellerOrganizationAssignment(database, organization.id);
    return { seller_organization: projected, replayed: false };
  } catch (error) {
    const normalized = normalizeIdempotencyError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

async function normalizedMarkets(
  database: SqlDatabase,
  role: StaffRoleCode,
  values: readonly string[],
): Promise<string[]> {
  if (role === 'owner') return [];
  const markets = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (markets.length < 1 || markets.length > 10) validation();
  const placeholders = markets.map(() => '?').join(',');
  const row = await database
    .prepare(`SELECT COUNT(*) AS total FROM marketplace_registry WHERE code IN (${placeholders})`)
    .bind(...markets)
    .first<{ total: number }>();
  if (Number(row?.total ?? 0) !== markets.length) validation();
  return markets;
}

async function resolveScopeKinds(
  database: SqlDatabase,
  role: StaffRoleCode,
  markets: readonly string[],
  excludeStaffId: string | null,
): Promise<Map<string, 'PRIMARY' | 'SUPPORT'>> {
  const result = new Map<string, 'PRIMARY' | 'SUPPORT'>();
  if (role === 'owner') return result;
  for (const market of markets) {
    const row = await database
      .prepare(
        `SELECT scope.staff_id FROM staff_marketplace_scopes scope
      JOIN staff_users staff ON staff.id=scope.staff_id
      WHERE scope.role_code=? AND scope.marketplace_code=? AND scope.status='ACTIVE'
        AND scope.scope_kind='PRIMARY' AND staff.status='ACTIVE'
        AND (? IS NULL OR scope.staff_id<>?) LIMIT 1`,
      )
      .bind(role, market, excludeStaffId, excludeStaffId)
      .first<{ staff_id: string }>();
    result.set(market, row ? 'SUPPORT' : 'PRIMARY');
  }
  return result;
}
async function activeScopes(database: SqlDatabase, staffId: string): Promise<ScopeRow[]> {
  const rows = await database
    .prepare(
      `SELECT role_code,marketplace_code,scope_kind FROM staff_marketplace_scopes
    WHERE staff_id=? AND status='ACTIVE' ORDER BY marketplace_code`,
    )
    .bind(staffId)
    .all<ScopeRow>();
  return rows.results;
}
async function assertEmailAvailable(
  database: SqlDatabase,
  email: string,
  excludeStaffId: string | null,
): Promise<void> {
  const row = await database
    .prepare(
      `SELECT staff_id FROM staff_email_identities WHERE normalized_email=? AND (? IS NULL OR staff_id<>?) LIMIT 1`,
    )
    .bind(email, excludeStaffId, excludeStaffId)
    .first<{ staff_id: string }>();
  if (row) stateConflict();
}
async function targetRow(database: SqlDatabase, staffId: string): Promise<TargetRow | null> {
  return database
    .prepare(
      `SELECT staff.id,staff.display_name,staff.status,staff.authorization_version,staff.session_version,staff.version,
    (SELECT role_code FROM staff_role_assignments WHERE staff_id=staff.id AND status='ACTIVE' LIMIT 1) AS role_code,
    (SELECT COUNT(*) FROM staff_role_assignments WHERE staff_id=staff.id AND status='ACTIVE') AS active_role_count,
    (SELECT normalized_email FROM staff_email_identities WHERE staff_id=staff.id AND status='ACTIVE' LIMIT 1) AS email
    FROM staff_users staff WHERE staff.id=?`,
    )
    .bind(staffId)
    .first<TargetRow>();
}
async function activeOwnerCount(database: SqlDatabase): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS total FROM staff_users staff JOIN staff_role_assignments role ON role.staff_id=staff.id AND role.status='ACTIVE' AND role.role_code='owner' WHERE staff.status='ACTIVE'`,
    )
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}
function requireOwner(actor: AssignmentStaffAuthorization): void {
  if (!actor.roles.has('owner') || !actor.permissions.has('STAFF_MANAGE'))
    throw new StaffAccessManagementError('FORBIDDEN', 403);
}
function text(value: string, max: number): string {
  const v = value.normalize('NFKC').trim();
  if (v.length < 1 || v.length > max || /[\u0000-\u001f\u007f]/u.test(v)) validation();
  return v;
}
function validation(): never {
  throw new StaffAccessManagementError('VALIDATION_ERROR', 400);
}
function stateConflict(): never {
  throw new StaffAccessManagementError('STATE_CONFLICT', 409);
}
function versionConflict(): never {
  throw new StaffAccessManagementError('VERSION_CONFLICT', 409);
}
function notFound(): never {
  throw new StaffAccessManagementError('NOT_FOUND', 404);
}
function dependency(): never {
  throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
}
function normalizeIdempotencyError(error: unknown): StaffAccessManagementError {
  if (error instanceof StaffAccessManagementError) return error;
  if (error instanceof IdempotencyError) {
    return new StaffAccessManagementError(error.code, error.status);
  }
  return new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
}
