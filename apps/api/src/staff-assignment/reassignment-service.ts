import type {
  SqlDatabase,
  SqlStatement,
  StaffAssignmentDutyCode,
  StaffAssignmentSubjectType,
  StaffWorkItemType,
} from '@ygb/contracts';
import {
  businessPermissionsForDuty,
  cleanAssignmentIdentifier,
  cleanAssignmentReason,
  eligibilityPermissionForDuty,
  hashCanonicalJson,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import { prepareStaffAssignmentOutboxStatements } from './outbox';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  isStaffAvailableForDuty,
  isStaffAvailableForFixedDuty,
} from './candidate-resolver';
import {
  resolveAssignmentStaffAuthorization,
  type AssignmentStaffAuthorization,
} from './effective-authorization';
import {
  StaffAssignmentError,
  normalizeStaffAssignmentError,
} from './errors';
import { isOwner, requirePermission } from './permission-policy';

interface WorkItemRow {
  id: string;
  work_type: StaffWorkItemType;
  assigned_staff_id: string;
  duty_code: StaffAssignmentDutyCode;
  version: number;
}
interface AssignmentRow {
  id: string;
  staff_id: string;
  version: number;
}

export interface ReassignmentCommand {
  actor: AssignmentStaffAuthorization;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
}

interface WorkItemReassignmentResult {
  work_item_id: string;
  previous_staff_id: string;
  assigned_staff_id: string;
  version: number;
  replayed: boolean;
}

export async function reassignWorkItem(
  database: SqlDatabase,
  input: {
    workItemId: string;
    targetStaffId: string;
    expectedVersion: number;
    reason: string;
  },
  command: ReassignmentCommand,
): Promise<WorkItemReassignmentResult> {
  const workItemId = cleanAssignmentIdentifier(input.workItemId);
  const targetStaffId = cleanAssignmentIdentifier(input.targetStaffId);
  const reason = cleanAssignmentReason(input.reason);
  validateVersion(input.expectedVersion);
  const now = command.now ?? Date.now();
  validateTime(now);
  const requestHash = await hashCanonicalJson({
    action: 'REASSIGN_STAFF_WORK_ITEM',
    work_item_id: workItemId,
    target_staff_id: targetStaffId,
    expected_version: input.expectedVersion,
    reason,
  });
  const acquired = await acquireIdempotency<WorkItemReassignmentResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'REASSIGN_STAFF_WORK_ITEM',
      targetType: 'STAFF_WORK_ITEM',
      targetId: workItemId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const item = await database.prepare(`
      SELECT id, work_type, assigned_staff_id, duty_code, version
      FROM staff_work_items
      WHERE id=? AND status='OPEN'
    `).bind(workItemId).first<WorkItemRow>();
    if (!item) throw new StaffAssignmentError('NOT_FOUND', 404);
    if (Number(item.version) !== input.expectedVersion
      || item.assigned_staff_id === targetStaffId) {
      throw new StaffAssignmentError('VERSION_CONFLICT', 409);
    }
    await requireActorCanManageAssignee(
      database,
      command.actor,
      item.assigned_staff_id,
    );
    await requireEligibleAssignmentTarget(database, {
      targetStaffId,
      dutyCode: item.duty_code,
      workType: item.work_type,
    });

    const response: WorkItemReassignmentResult = {
      work_item_id: workItemId,
      previous_staff_id: item.assigned_staff_id,
      assigned_staff_id: targetStaffId,
      version: Number(item.version) + 1,
      replayed: false,
    };
    const outbox = await prepareStaffAssignmentOutboxStatements(database, {
      dedupKey: `staff-work-item:${workItemId}:reassign:v${response.version}`,
      eventType: 'MANUAL_WORK_ITEM_REASSIGN',
      aggregateType: 'STAFF_WORK_ITEM',
      aggregateId: workItemId,
      payload: response,
      now,
    });
    await database.batch([
      database.prepare(`
        UPDATE staff_work_items
        SET assigned_staff_id=?, version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=? AND status='OPEN' AND version=?
      `).bind(targetStaffId, now, workItemId, item.version),
      database.prepare(`
        INSERT INTO staff_assignment_events (
          id, event_type, subject_type, subject_id,
          duty_code, assignment_id, work_item_id, batch_id,
          old_staff_id, new_staff_id, actor_type, actor_id,
          reason, request_id, idempotency_key, metadata_json, created_at
        ) SELECT ?, 'MANUAL_WORK_ITEM_REASSIGN', 'WORK_ITEM', id,
          duty_code, fixed_assignment_id, id, NULL, ?, ?, 'STAFF', ?,
          ?, ?, ?, '{}', ?
        FROM staff_work_items WHERE id=?
      `).bind(
        crypto.randomUUID(),
        item.assigned_staff_id,
        targetStaffId,
        command.actor.staffId,
        reason,
        command.requestId ?? null,
        acquired.claim.idempotencyKey,
        now,
        workItemId,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'STAFF_WORK_ITEM',
        aggregateId: workItemId,
        eventType: 'MANUAL_WORK_ITEM_REASSIGN',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          assigned_staff_id: item.assigned_staff_id,
          version: item.version,
        },
        nextState: response,
        reason,
        createdAt: now,
      }),
      ...outbox,
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { work_item_id: workItemId },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM staff_work_items
          WHERE id=? AND status='OPEN'
            AND assigned_staff_id=? AND version=?
        ) THEN 1 ELSE 0 END
      `).bind(workItemId, targetStaffId, response.version),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizeStaffAssignmentError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

interface FixedAssignmentChangeResult {
  old_assignment_id: string;
  new_assignment_id: string;
  previous_staff_id: string;
  assigned_staff_id: string;
  transferred_open_work_items: number;
  replayed: boolean;
}

export async function changeFixedAssignment(
  database: SqlDatabase,
  input: {
    subjectType: StaffAssignmentSubjectType;
    subjectId: string;
    dutyCode: StaffAssignmentDutyCode;
    targetStaffId: string;
    expectedAssignmentVersion: number;
    transferOpenWorkItems?: boolean;
    reason: string;
    marketplaceCode?: string;
  },
  command: ReassignmentCommand,
): Promise<FixedAssignmentChangeResult> {
  const subjectId = cleanAssignmentIdentifier(input.subjectId);
  const targetStaffId = cleanAssignmentIdentifier(input.targetStaffId);
  const reason = cleanAssignmentReason(input.reason);
  validateSubjectDuty(input.subjectType, input.dutyCode);
  validateVersion(input.expectedAssignmentVersion);
  const now = command.now ?? Date.now();
  validateTime(now);
  const requestHash = await hashCanonicalJson({
    action: 'CHANGE_FIXED_STAFF_ASSIGNMENT',
    subject_type: input.subjectType,
    subject_id: subjectId,
    duty_code: input.dutyCode,
    target_staff_id: targetStaffId,
    expected_assignment_version: input.expectedAssignmentVersion,
    transfer_open_work_items: input.transferOpenWorkItems === true,
    reason,
  });
  const acquired = await acquireIdempotency<FixedAssignmentChangeResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'CHANGE_FIXED_STAFF_ASSIGNMENT',
      targetType: input.subjectType,
      targetId: `${subjectId}:${input.dutyCode}`,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const oldAssignment = await readAssignment(
      database,
      input.subjectType,
      subjectId,
      input.dutyCode,
    );
    if (!oldAssignment) throw new StaffAssignmentError('NOT_FOUND', 404);
    if (Number(oldAssignment.version) !== input.expectedAssignmentVersion
      || oldAssignment.staff_id === targetStaffId) {
      throw new StaffAssignmentError('VERSION_CONFLICT', 409);
    }
    await requireActorCanManageAssignee(
      database,
      command.actor,
      oldAssignment.staff_id,
    );
    await requireEligibleFixedAssignmentTarget(database, {
      targetStaffId,
      dutyCode: input.dutyCode,
    });

    const newAssignmentId = crypto.randomUUID();
    const table = assignmentTable(input.subjectType);
    const subjectColumn = assignmentSubjectColumn(input.subjectType);
    const workItemSubjectColumn = workItemSubjectColumnFor(input.subjectType);
    const transferCount = input.transferOpenWorkItems
      ? Number((await database.prepare(`
          SELECT COUNT(*) AS count
          FROM staff_work_items
          WHERE status='OPEN' AND duty_code=?
            AND ${workItemSubjectColumn}=?
        `).bind(input.dutyCode, subjectId).first<{ count: number }>())?.count ?? 0)
      : 0;
    const response: FixedAssignmentChangeResult = {
      old_assignment_id: oldAssignment.id,
      new_assignment_id: newAssignmentId,
      previous_staff_id: oldAssignment.staff_id,
      assigned_staff_id: targetStaffId,
      transferred_open_work_items: transferCount,
      replayed: false,
    };

    const outbox = await prepareStaffAssignmentOutboxStatements(database, {
      dedupKey: `staff-assignment:${newAssignmentId}:fixed-owner-changed`,
      eventType: 'FIXED_OWNER_CHANGED',
      aggregateType: 'STAFF_ASSIGNMENT',
      aggregateId: newAssignmentId,
      payload: response,
      now,
    });
    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE ${table}
        SET status='REVOKED', revoked_at=?, version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=? AND status='ACTIVE' AND version=?
      `).bind(now, now, oldAssignment.id, oldAssignment.version),
      database.prepare(`
        INSERT INTO ${table} (
          id, ${subjectColumn}, duty_code, staff_id, status, source,
          assigned_by_actor_type, assigned_by_actor_id, reason,
          version, created_at, updated_at, revoked_at
        ) VALUES (?, ?, ?, ?, 'ACTIVE', 'MANUAL_REASSIGN',
          'STAFF', ?, ?, 1, ?, ?, NULL)
      `).bind(
        newAssignmentId,
        subjectId,
        input.dutyCode,
        targetStaffId,
        command.actor.staffId,
        reason,
        now,
        now,
      ),
    ];
    if (input.transferOpenWorkItems) {
      statements.push(database.prepare(`
        UPDATE staff_work_items
        SET assigned_staff_id=?, fixed_assignment_id=?,
          version=version+1, updated_at=MAX(?, updated_at+1)
        WHERE status='OPEN' AND duty_code=?
          AND ${workItemSubjectColumn}=?
      `).bind(
        targetStaffId,
        newAssignmentId,
        now,
        input.dutyCode,
        subjectId,
      ));
    }
    statements.push(
      database.prepare(`
        INSERT INTO staff_assignment_events (
          id, event_type, subject_type, subject_id,
          duty_code, assignment_id, work_item_id, batch_id,
          old_staff_id, new_staff_id, actor_type, actor_id,
          reason, request_id, idempotency_key, metadata_json, created_at
        ) VALUES (?, 'FIXED_OWNER_CHANGED', ?, ?, ?, ?, NULL, NULL,
          ?, ?, 'STAFF', ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        input.subjectType,
        subjectId,
        input.dutyCode,
        newAssignmentId,
        oldAssignment.staff_id,
        targetStaffId,
        command.actor.staffId,
        reason,
        command.requestId ?? null,
        acquired.claim.idempotencyKey,
        JSON.stringify({
          assignment_source: 'MANUAL_REASSIGN',
          transfer_open_work_items: input.transferOpenWorkItems === true,
          transferred_open_work_items: transferCount,
        }),
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'STAFF_ASSIGNMENT',
        aggregateId: newAssignmentId,
        eventType: 'FIXED_OWNER_CHANGED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: oldAssignment,
        nextState: response,
        reason,
        createdAt: now,
      }),
      ...outbox,
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { assignment_id: newAssignmentId },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (
            SELECT 1 FROM ${table}
            WHERE id=? AND status='REVOKED' AND version=?
          )
          AND EXISTS (
            SELECT 1 FROM ${table}
            WHERE id=? AND status='ACTIVE' AND staff_id=? AND version=1
          )
        THEN 1 ELSE 0 END
      `).bind(
        oldAssignment.id,
        Number(oldAssignment.version) + 1,
        newAssignmentId,
        targetStaffId,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    );
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeStaffAssignmentError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

export async function requireEligibleFixedAssignmentTarget(
  database: SqlDatabase,
  input: {
    targetStaffId: string;
    dutyCode: StaffAssignmentDutyCode;
  },
): Promise<AssignmentStaffAuthorization> {
  const target = await resolveAssignmentStaffAuthorization(database, input.targetStaffId);
  if (!target
    || !target.permissions.has(eligibilityPermissionForDuty(input.dutyCode))
    || !businessPermissionsForDuty(input.dutyCode)
      .every((permission) => target.permissions.has(permission))
    || !await isStaffAvailableForFixedDuty(database, {
      staffId: input.targetStaffId,
      dutyCode: input.dutyCode,
    })) throw new StaffAssignmentError('FORBIDDEN', 403);
  return target;
}

export async function requireEligibleAssignmentTarget(
  database: SqlDatabase,
  input: {
    targetStaffId: string;
    dutyCode: StaffAssignmentDutyCode;
    workType: StaffWorkItemType;
  },
): Promise<AssignmentStaffAuthorization> {
  const target = await resolveAssignmentStaffAuthorization(
    database,
    input.targetStaffId,
  );
  if (!target
    || !target.permissions.has(eligibilityPermissionForDuty(input.dutyCode))
    || !businessPermissionsForDuty(input.dutyCode)
      .every((permission) => target.permissions.has(permission))
    || !await isStaffAvailableForDuty(database, {
      staffId: input.targetStaffId,
      dutyCode: input.dutyCode,
      workType: input.workType,
    })) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
  return target;
}

export async function requireActorCanManageAssignee(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  assigneeStaffId: string,
): Promise<void> {
  // Owner receives this permission by default, but an explicit personal DENY
  // removes it and must continue to win.
  requirePermission(actor, 'TASK_REASSIGN_TEAM');
  if (isOwner(actor)) return;
  if (actor.leaderTeamIds.length < 1) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
  const placeholders = actor.leaderTeamIds.map(() => '?').join(', ');
  const row = await database.prepare(`
    SELECT 1 AS allowed
    FROM staff_team_memberships membership
    JOIN staff_teams team ON team.id=membership.team_id
      AND team.status='ACTIVE'
    JOIN staff_departments department ON department.id=team.department_id
      AND department.status='ACTIVE'
    WHERE membership.staff_id=? AND membership.status='ACTIVE'
      AND membership.team_id IN (${placeholders})
    LIMIT 1
  `).bind(assigneeStaffId, ...actor.leaderTeamIds)
    .first<{ allowed: number }>();
  if (!row) throw new StaffAssignmentError('FORBIDDEN', 403);
}

export function representativeWorkType(
  dutyCode: StaffAssignmentDutyCode,
): StaffWorkItemType {
  switch (dutyCode) {
    case 'SELLER_ACCOUNT_MANAGER': return 'PRODUCT_APPLICATION_REVIEW';
    case 'BUYER_PRE_SALES_OWNER': return 'RESERVATION_DECISION';
    case 'BUYER_AFTER_SALES_OWNER': return 'REVIEW_DECISION';
    case 'BUYER_REFUND_OWNER': return 'BUYER_REFUND_PROCESSING';
  }
}

export function assignmentTable(
  subjectType: StaffAssignmentSubjectType,
): 'buyer_staff_assignments' | 'seller_staff_assignments' {
  return subjectType === 'BUYER_CUSTOMER'
    ? 'buyer_staff_assignments'
    : 'seller_staff_assignments';
}

export function assignmentSubjectColumn(
  subjectType: StaffAssignmentSubjectType,
): 'buyer_customer_id' | 'seller_organization_id' {
  return subjectType === 'BUYER_CUSTOMER'
    ? 'buyer_customer_id'
    : 'seller_organization_id';
}

export function workItemSubjectColumnFor(
  subjectType: StaffAssignmentSubjectType,
): 'buyer_customer_id' | 'seller_organization_id' {
  return assignmentSubjectColumn(subjectType);
}

async function readAssignment(
  database: SqlDatabase,
  subjectType: StaffAssignmentSubjectType,
  subjectId: string,
  dutyCode: StaffAssignmentDutyCode,
): Promise<AssignmentRow | null> {
  const table = assignmentTable(subjectType);
  const column = assignmentSubjectColumn(subjectType);
  return database.prepare(`
    SELECT id, staff_id, version
    FROM ${table}
    WHERE ${column}=? AND duty_code=? AND status='ACTIVE'
  `).bind(subjectId, dutyCode).first<AssignmentRow>();
}

function validateSubjectDuty(
  subjectType: StaffAssignmentSubjectType,
  dutyCode: StaffAssignmentDutyCode,
): void {
  if ((subjectType === 'SELLER_ORGANIZATION')
      !== (dutyCode === 'SELLER_ACCOUNT_MANAGER')) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
}

function validateVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
}

function validateTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
}
