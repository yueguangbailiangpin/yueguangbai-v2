import type { SqlDatabase } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import { prepareStaffAssignmentOutboxStatements } from './outbox';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  resolveAssignmentStaffAuthorization,
  type AssignmentStaffAuthorization,
} from './effective-authorization';
import { StaffAssignmentError, normalizeStaffAssignmentError } from './errors';
import { requirePermission } from './permission-policy';

export async function getAssignmentFallback(
  database: SqlDatabase,
  marketplaceCode: string,
  actor: AssignmentStaffAuthorization,
): Promise<{
  marketplace_code: string;
  staff_id: string;
  version: number;
} | null> {
  requirePermission(actor, 'STAFF_MANAGE');
  const fallback = await database.prepare(`
    SELECT marketplace_code, staff_id, version
    FROM staff_assignment_fallbacks
    WHERE marketplace_code=?
  `).bind(marketplaceCode).first<{
    marketplace_code: string;
    staff_id: string;
    version: number;
  }>();
  return fallback ?? null;
}

export async function configureAssignmentFallback(
  database: SqlDatabase,
  input: {
    marketplaceCode: string;
    staffId: string;
    expectedVersion: number;
  },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{
  marketplace_code: string;
  staff_id: string;
  version: number;
  replayed: boolean;
}> {
  requirePermission(command.actor, 'STAFF_MANAGE');
  const target = await resolveAssignmentStaffAuthorization(database, input.staffId);
  if (!target || !target.roles.has('owner')) {
    throw new StaffAssignmentError('OWNER_FALLBACK_INVALID', 409);
  }
  for (const permission of [
    'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
    'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
    'PRODUCT_VIEW',
    'PRODUCT_REVIEW',
    'DEMAND_VIEW',
    'DEMAND_PUBLISH',
    'BUYER_VIEW',
    'RESERVATION_VIEW',
    'RESERVATION_DECIDE',
    'ORDER_VIEW',
    'ORDER_CONFIRM',
    'REVIEW_VIEW',
    'REVIEW_DECIDE',
    'BUYER_REFUND_VIEW',
    'BUYER_REFUND_RECORD',
  ] as const) {
    if (!target.permissions.has(permission)) {
      throw new StaffAssignmentError('OWNER_FALLBACK_INVALID', 409);
    }
  }
  const availability = await database.prepare(`
    SELECT COALESCE(availability.availability_status, 'AVAILABLE') AS status
    FROM staff_users staff
    LEFT JOIN staff_availability availability ON availability.staff_id=staff.id
    WHERE staff.id=? AND staff.status='ACTIVE'
  `).bind(input.staffId).first<{ status: string }>();
  if (!availability || availability.status !== 'AVAILABLE') {
    throw new StaffAssignmentError('OWNER_FALLBACK_INVALID', 409);
  }
  const current = await database.prepare(`
    SELECT version FROM staff_assignment_fallbacks WHERE marketplace_code=?
  `).bind(input.marketplaceCode).first<{ version: number }>();
  if (Number(current?.version ?? 0) !== input.expectedVersion) {
    throw new StaffAssignmentError('VERSION_CONFLICT', 409);
  }
  const now = command.now ?? Date.now();
  const requestHash = await hashCanonicalJson({
    action: 'CONFIGURE_ASSIGNMENT_FALLBACK',
    marketplace_code: input.marketplaceCode,
    staff_id: input.staffId,
    expected_version: input.expectedVersion,
  });
  type Result = {
    marketplace_code: string;
    staff_id: string;
    version: number;
    replayed: boolean;
  };
  const acquired = await acquireIdempotency<Result>(database, {
    actorType: 'STAFF',
    actorId: command.actor.staffId,
    action: 'CONFIGURE_ASSIGNMENT_FALLBACK',
    targetType: 'MARKETPLACE',
    targetId: input.marketplaceCode,
    idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') return { ...acquired.response, replayed: true };
  try {
    const response: Result = {
      marketplace_code: input.marketplaceCode,
      staff_id: input.staffId,
      version: input.expectedVersion + 1,
      replayed: false,
    };
    const write = input.expectedVersion === 0
      ? database.prepare(`
          INSERT INTO staff_assignment_fallbacks (
            marketplace_code, staff_id, version,
            configured_by_staff_id, created_at, updated_at
          ) VALUES (?, ?, 1, ?, ?, ?)
        `).bind(
          input.marketplaceCode,
          input.staffId,
          command.actor.staffId,
          now,
          now,
        )
      : database.prepare(`
          UPDATE staff_assignment_fallbacks
          SET staff_id=?, version=version+1,
            configured_by_staff_id=?, updated_at=MAX(?, updated_at+1)
          WHERE marketplace_code=? AND version=?
        `).bind(
          input.staffId,
          command.actor.staffId,
          now,
          input.marketplaceCode,
          input.expectedVersion,
        );
    const outbox = await prepareStaffAssignmentOutboxStatements(database, {
      dedupKey: `staff-fallback:${input.marketplaceCode}:v${response.version}`,
      eventType: 'ASSIGNMENT_FALLBACK_CONFIGURED',
      aggregateType: 'STAFF_ASSIGNMENT_FALLBACK',
      aggregateId: input.marketplaceCode,
      payload: response,
      now,
    });
    await database.batch([
      write,
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'STAFF_ASSIGNMENT_FALLBACK',
        aggregateId: input.marketplaceCode,
        eventType: 'ASSIGNMENT_FALLBACK_CONFIGURED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: current,
        nextState: response,
        createdAt: now,
      }),
      ...outbox,
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { marketplace_code: input.marketplaceCode },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM staff_assignment_fallbacks
          WHERE marketplace_code=? AND staff_id=? AND version=?
        ) THEN 1 ELSE 0 END
      `).bind(input.marketplaceCode, input.staffId, response.version),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizeStaffAssignmentError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now)
      .catch(() => false);
    throw normalized;
  }
}
