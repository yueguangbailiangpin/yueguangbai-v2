import type {
  SqlDatabase,
  StaffAvailabilityDto,
  StaffAvailabilityStatus,
} from '@ygb/contracts';
import { createAuditEventStatement } from '../foundation/audit';
import { prepareStaffAssignmentOutboxStatements } from './outbox';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import { hashCanonicalJson } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from './effective-authorization';
import { StaffAssignmentError, normalizeStaffAssignmentError } from './errors';
import { requirePermission } from './permission-policy';

interface AvailabilityRow {
  staff_id: string;
  availability_status: StaffAvailabilityStatus;
  reason: string | null;
  version: number;
  updated_at: number;
}

export async function getStaffAvailability(
  database: SqlDatabase,
  staffId: string,
): Promise<StaffAvailabilityDto> {
  const staff = await database.prepare(`
    SELECT id FROM staff_users WHERE id=?
  `).bind(staffId).first<{ id: string }>();
  if (!staff) throw new StaffAssignmentError('NOT_FOUND', 404);
  const row = await database.prepare(`
    SELECT staff_id, availability_status, reason, version, updated_at
    FROM staff_availability WHERE staff_id=?
  `).bind(staffId).first<AvailabilityRow>();
  if (!row) {
    return {
      staff_id: staffId,
      availability_status: 'AVAILABLE',
      reason: null,
      version: 0,
      effective_default: true,
      updated_at: null,
    };
  }
  return {
    staff_id: row.staff_id,
    availability_status: row.availability_status,
    reason: row.reason,
    version: Number(row.version),
    effective_default: false,
    updated_at: Number(row.updated_at),
  };
}

export async function setStaffAvailability(
  database: SqlDatabase,
  input: {
    staffId: string;
    availabilityStatus: StaffAvailabilityStatus;
    reason?: string | null;
    expectedVersion: number;
  },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<StaffAvailabilityDto & { replayed: boolean }> {
  if (input.staffId !== command.actor.staffId) {
    requirePermission(command.actor, 'ASSIGNMENT_AVAILABILITY_MANAGE');
  }
  if (input.availabilityStatus !== 'AVAILABLE'
    && input.availabilityStatus !== 'UNAVAILABLE') {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  const reason = cleanReason(input.reason);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 0) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  const target = await database.prepare(`
    SELECT status FROM staff_users WHERE id=?
  `).bind(input.staffId).first<{ status: string }>();
  if (!target) throw new StaffAssignmentError('NOT_FOUND', 404);

  const requestHash = await hashCanonicalJson({
    action: 'SET_STAFF_AVAILABILITY',
    staff_id: input.staffId,
    availability_status: input.availabilityStatus,
    reason,
    expected_version: input.expectedVersion,
  });
  const acquired = await acquireIdempotency<
    StaffAvailabilityDto & { replayed: boolean }
  >(database, {
    actorType: 'STAFF',
    actorId: command.actor.staffId,
    action: 'SET_STAFF_AVAILABILITY',
    targetType: 'STAFF',
    targetId: input.staffId,
    idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const current = await getStaffAvailability(database, input.staffId);
    if (current.version !== input.expectedVersion) {
      throw new StaffAssignmentError('VERSION_CONFLICT', 409);
    }
    const response = {
      staff_id: input.staffId,
      availability_status: input.availabilityStatus,
      reason,
      version: input.expectedVersion + 1,
      effective_default: false,
      updated_at: now,
      replayed: false,
    } as const;
    const write = input.expectedVersion === 0
      ? database.prepare(`
          INSERT INTO staff_availability (
            staff_id, availability_status, reason, changed_by_staff_id,
            version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?)
        `).bind(
          input.staffId,
          input.availabilityStatus,
          reason,
          command.actor.staffId,
          now,
          now,
        )
      : database.prepare(`
          UPDATE staff_availability
          SET availability_status=?, reason=?, changed_by_staff_id=?,
            version=version+1, updated_at=MAX(?, updated_at+1)
          WHERE staff_id=? AND version=?
        `).bind(
          input.availabilityStatus,
          reason,
          command.actor.staffId,
          now,
          input.staffId,
          input.expectedVersion,
        );
    const outbox = await prepareStaffAssignmentOutboxStatements(database, {
      dedupKey: `staff-availability:${input.staffId}:v${response.version}`,
      eventType: 'AVAILABILITY_CHANGED',
      aggregateType: 'STAFF_AVAILABILITY',
      aggregateId: input.staffId,
      payload: response,
      now,
    });
    await database.batch([
      write,
      database.prepare(`
        INSERT INTO staff_assignment_events (
          id, event_type, subject_type, subject_id,
          duty_code, assignment_id, work_item_id, batch_id,
          old_staff_id, new_staff_id, actor_type, actor_id,
          reason, request_id, idempotency_key, metadata_json, created_at
        ) VALUES (?, 'AVAILABILITY_CHANGED', 'STAFF', ?,
          NULL, NULL, NULL, NULL, ?, ?, 'STAFF', ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        input.staffId,
        input.staffId,
        input.staffId,
        command.actor.staffId,
        reason,
        command.requestId ?? null,
        acquired.claim.idempotencyKey,
        JSON.stringify({
          previous_status: current.availability_status,
          next_status: input.availabilityStatus,
          target_staff_status: target.status,
        }),
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'STAFF_AVAILABILITY',
        aggregateId: input.staffId,
        eventType: 'AVAILABILITY_CHANGED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: current,
        nextState: response,
        reason,
        createdAt: now,
      }),
      ...outbox,
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { staff_id: input.staffId },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM staff_availability
          WHERE staff_id=? AND availability_status=? AND version=?
        ) THEN 1 ELSE 0 END
      `).bind(
        input.staffId,
        input.availabilityStatus,
        response.version,
      ),
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

function cleanReason(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  if (normalized.length > 1000
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  return normalized;
}
