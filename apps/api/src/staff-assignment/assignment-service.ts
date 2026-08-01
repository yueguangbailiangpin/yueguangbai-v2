import type {
  SqlDatabase,
  SqlStatement,
  StaffAssignmentDutyCode,
  StaffAssignmentSource,
  StaffWorkItemType,
} from '@ygb/contracts';
import { dutyForWorkItem } from '@ygb/domain';
import {
  isStaffAvailableForDuty,
  resolveOwnerFallback,
  resolveOwnerFallbackForFixedDuty,
  resolveRoundRobinCandidate,
  resolveRoundRobinFixedDutyCandidate,
  type ResolvedRoundRobinCandidate,
} from './candidate-resolver';
import { StaffAssignmentError } from './errors';
import { prepareStaffAssignmentOutboxStatements } from './outbox';

interface ActiveAssignmentRow {
  id: string;
  staff_id: string;
  source: StaffAssignmentSource;
}
interface ExistingWorkItemRow {
  id: string;
  assigned_staff_id: string;
  fixed_assignment_id: string;
}

export interface DirectWorkItemInput {
  workType: StaffWorkItemType;
  sourceEntityType:
    | 'PRODUCT_APPLICATION'
    | 'DEMAND_BATCH'
    | 'RESERVATION'
    | 'ORDER_EVIDENCE'
    | 'REVIEW_CASE'
    | 'BUYER_REFUND_OBLIGATION';
  sourceEntityId: string;
  marketplaceCode: string;
  buyerCustomerId?: string | null;
  sellerOrganizationId?: string | null;
  storeId?: string | null;
  actorType: 'STAFF' | 'SYSTEM';
  actorId?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  reason?: string | null;
  now: number;
  teamId?: string | null;
}

export interface PreparedDirectWorkItem {
  workItemId: string;
  assignmentId: string;
  assignedStaffId: string;
  assignmentSource: StaffAssignmentSource;
  statements: readonly SqlStatement[];
  replayedExisting: boolean;
}

export async function prepareDirectWorkItem(
  database: SqlDatabase,
  input: DirectWorkItemInput,
): Promise<PreparedDirectWorkItem> {
  const dutyCode = dutyForWorkItem(input.workType);
  validateSubject(input, dutyCode);
  const existing = await database.prepare(`
    SELECT id, assigned_staff_id, fixed_assignment_id
    FROM staff_work_items
    WHERE source_entity_type=? AND source_entity_id=?
      AND work_type=? AND status='OPEN'
  `).bind(
    input.sourceEntityType,
    input.sourceEntityId,
    input.workType,
  ).first<ExistingWorkItemRow>();
  if (existing) {
    return {
      workItemId: existing.id,
      assignmentId: existing.fixed_assignment_id,
      assignedStaffId: existing.assigned_staff_id,
      assignmentSource: 'AUTO_INITIAL',
      statements: [],
      replayedExisting: true,
    };
  }

  const active = await readActiveAssignment(database, input, dutyCode);
  if (active && await isStaffAvailableForDuty(database, {
    staffId: active.staff_id,
    dutyCode,
    workType: input.workType,
  })) {
    const workItemId = crypto.randomUUID();
    const workItemPayload = {
      work_item_id: workItemId,
      work_type: input.workType,
      source_entity_type: input.sourceEntityType,
      source_entity_id: input.sourceEntityId,
      duty_code: dutyCode,
      assignment_id: active.id,
      assigned_staff_id: active.staff_id,
      status: 'OPEN',
    } as const;
    return {
      workItemId,
      assignmentId: active.id,
      assignedStaffId: active.staff_id,
      assignmentSource: active.source,
      replayedExisting: false,
      statements: [
        ...createWorkItemStatements(database, {
          ...input,
          dutyCode,
          assignmentId: active.id,
          assignmentType: subjectType(input, dutyCode),
          assignedStaffId: active.staff_id,
          workItemId,
        }),
        ...await prepareStaffAssignmentOutboxStatements(database, {
          dedupKey: `staff-work-item:${workItemId}:created`,
          eventType: 'WORK_ITEM_CREATED',
          aggregateType: 'STAFF_WORK_ITEM',
          aggregateId: workItemId,
          payload: workItemPayload,
          now: input.now,
        }),
      ],
    };
  }

  const candidate = await resolveRoundRobinCandidate(database, {
    dutyCode,
    workType: input.workType,
    marketplaceCode: input.marketplaceCode,
    teamId: input.teamId ?? null,
  });
  const fallback = candidate === null
    ? await resolveFallbackWithFailureEvent(database, {
        marketplaceCode: input.marketplaceCode,
        dutyCode,
        workType: input.workType,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        requestId: input.requestId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        now: input.now,
      })
    : null;
  const assignedStaffId = candidate?.staff.staffId ?? fallback?.staffId;
  if (!assignedStaffId) {
    throw new StaffAssignmentError('NO_ELIGIBLE_ASSIGNEE', 503);
  }

  const assignmentSource: StaffAssignmentSource = active
    ? (candidate ? 'AUTO_REPLACEMENT' : 'OWNER_FALLBACK')
    : (candidate ? 'AUTO_INITIAL' : 'OWNER_FALLBACK');
  const assignmentId = crypto.randomUUID();
  const workItemId = crypto.randomUUID();
  const statements: SqlStatement[] = [];
  if (active) {
    statements.push(revokeAssignmentStatement(database, input, dutyCode, active.id));
  }
  statements.push(
    insertAssignmentStatement(database, {
      ...input,
      dutyCode,
      staffId: assignedStaffId,
      assignmentId,
      source: assignmentSource,
    }),
  );
  if (candidate) {
    statements.push(...createCursorAdvanceStatements(
      database,
      candidate,
      assignedStaffId,
      input.now,
    ));
  }
  const assignmentEventType = active
    ? 'AUTO_REPLACEMENT'
    : assignmentSource === 'OWNER_FALLBACK'
      ? 'OWNER_FALLBACK'
      : 'AUTO_INITIAL_ASSIGNMENT';
  const assignmentPayload = {
    assignment_id: assignmentId,
    subject_type: subjectType(input, dutyCode),
    buyer_customer_id: input.buyerCustomerId ?? null,
    seller_organization_id: input.sellerOrganizationId ?? null,
    duty_code: dutyCode,
    previous_staff_id: active?.staff_id ?? null,
    assigned_staff_id: assignedStaffId,
    source: assignmentSource,
  } as const;
  const workItemPayload = {
    work_item_id: workItemId,
    work_type: input.workType,
    source_entity_type: input.sourceEntityType,
    source_entity_id: input.sourceEntityId,
    duty_code: dutyCode,
    assignment_id: assignmentId,
    assigned_staff_id: assignedStaffId,
    status: 'OPEN',
  } as const;
  statements.push(
    assignmentEventStatement(database, {
      eventType: assignmentEventType,
      input,
      dutyCode,
      assignmentId,
      oldStaffId: active?.staff_id ?? null,
      newStaffId: assignedStaffId,
    }),
    ...createWorkItemStatements(database, {
      ...input,
      dutyCode,
      assignmentId,
      assignmentType: subjectType(input, dutyCode),
      assignedStaffId,
      workItemId,
    }),
    ...await prepareStaffAssignmentOutboxStatements(database, {
      dedupKey: `staff-assignment:${assignmentId}:created`,
      eventType: assignmentEventType,
      aggregateType: 'STAFF_ASSIGNMENT',
      aggregateId: assignmentId,
      payload: assignmentPayload,
      now: input.now,
    }),
    ...await prepareStaffAssignmentOutboxStatements(database, {
      dedupKey: `staff-work-item:${workItemId}:created`,
      eventType: 'WORK_ITEM_CREATED',
      aggregateType: 'STAFF_WORK_ITEM',
      aggregateId: workItemId,
      payload: workItemPayload,
      now: input.now,
    }),
  );
  return {
    workItemId,
    assignmentId,
    assignedStaffId,
    assignmentSource,
    statements,
    replayedExisting: false,
  };
}


export interface PreparedFixedAssignment {
  assignmentId: string;
  assignedStaffId: string;
  assignmentSource: StaffAssignmentSource;
  statements: readonly SqlStatement[];
  replayedExisting: boolean;
}

/**
 * Creates the mandatory SELLER_ACCOUNT_MANAGER relationship for a newly
 * created seller organization. It deliberately creates no Work Item.
 */
export async function prepareInitialSellerAssignment(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    marketplaceCode: string;
    actorType: 'STAFF' | 'SYSTEM';
    actorId?: string | null;
    requestId?: string | null;
    idempotencyKey?: string | null;
    reason?: string | null;
    now: number;
    teamId?: string | null;
  },
): Promise<PreparedFixedAssignment> {
  const existing = await database.prepare(`
    SELECT id, staff_id, source
    FROM seller_staff_assignments
    WHERE seller_organization_id=?
      AND duty_code='SELLER_ACCOUNT_MANAGER'
      AND status='ACTIVE'
  `).bind(input.sellerOrganizationId).first<ActiveAssignmentRow>();
  if (existing) {
    return {
      assignmentId: existing.id,
      assignedStaffId: existing.staff_id,
      assignmentSource: existing.source,
      statements: [],
      replayedExisting: true,
    };
  }
  const workType: StaffWorkItemType = 'PRODUCT_APPLICATION_REVIEW';
  const dutyCode: StaffAssignmentDutyCode = 'SELLER_ACCOUNT_MANAGER';
  const candidate = await resolveRoundRobinFixedDutyCandidate(database, {
    dutyCode,
    marketplaceCode: input.marketplaceCode,
    teamId: input.teamId ?? null,
  });
  const fallback = candidate === null
    ? await resolveFixedFallbackWithFailureEvent(database, {
        marketplaceCode: input.marketplaceCode,
        dutyCode,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        requestId: input.requestId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        now: input.now,
      })
    : null;
  const assignedStaffId = candidate?.staff.staffId ?? fallback?.staffId;
  if (!assignedStaffId) {
    throw new StaffAssignmentError('NO_ELIGIBLE_ASSIGNEE', 503);
  }
  const assignmentId = crypto.randomUUID();
  const assignmentSource: StaffAssignmentSource = candidate
    ? 'AUTO_INITIAL'
    : 'OWNER_FALLBACK';
  const directInput: DirectWorkItemInput = {
    workType,
    sourceEntityType: 'PRODUCT_APPLICATION',
    sourceEntityId: `seller-organization:${input.sellerOrganizationId}`,
    marketplaceCode: input.marketplaceCode,
    sellerOrganizationId: input.sellerOrganizationId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    requestId: input.requestId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    reason: input.reason ?? null,
    now: input.now,
    teamId: input.teamId ?? null,
  };
  const statements: SqlStatement[] = [
    insertAssignmentStatement(database, {
      ...directInput,
      dutyCode,
      staffId: assignedStaffId,
      assignmentId,
      source: assignmentSource,
    }),
  ];
  if (candidate) {
    statements.push(...createCursorAdvanceStatements(
      database,
      candidate,
      assignedStaffId,
      input.now,
    ));
  }
  const assignmentEventType = assignmentSource === 'OWNER_FALLBACK'
    ? 'OWNER_FALLBACK'
    : 'AUTO_INITIAL_ASSIGNMENT';
  statements.push(
    assignmentEventStatement(database, {
      eventType: assignmentEventType,
      input: directInput,
      dutyCode,
      assignmentId,
      oldStaffId: null,
      newStaffId: assignedStaffId,
    }),
    ...await prepareStaffAssignmentOutboxStatements(database, {
      dedupKey: `staff-assignment:${assignmentId}:created`,
      eventType: assignmentEventType,
      aggregateType: 'STAFF_ASSIGNMENT',
      aggregateId: assignmentId,
      payload: {
        assignment_id: assignmentId,
        subject_type: 'SELLER',
        seller_organization_id: input.sellerOrganizationId,
        duty_code: dutyCode,
        previous_staff_id: null,
        assigned_staff_id: assignedStaffId,
        source: assignmentSource,
      },
      now: input.now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM seller_staff_assignments
        WHERE id=? AND seller_organization_id=?
          AND duty_code='SELLER_ACCOUNT_MANAGER'
          AND staff_id=? AND status='ACTIVE'
      ) THEN 1 ELSE 0 END
    `).bind(
      assignmentId,
      input.sellerOrganizationId,
      assignedStaffId,
    ),
  );
  return {
    assignmentId,
    assignedStaffId,
    assignmentSource,
    statements,
    replayedExisting: false,
  };
}

export async function batchWithFixedAssignmentRetry(
  database: SqlDatabase,
  prepare: () => Promise<PreparedFixedAssignment>,
  businessStatements: readonly SqlStatement[],
  maximumAttempts = 3,
): Promise<PreparedFixedAssignment> {
  let last: unknown;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const prepared = await prepare();
    try {
      await database.batch([...businessStatements, ...prepared.statements]);
      return prepared;
    } catch (error) {
      last = error;
      if (!String(error).includes('staff_assignment_cursor_version_conflict')) throw error;
    }
  }
  throw new StaffAssignmentError(
    String(last).includes('staff_assignment_cursor_version_conflict')
      ? 'VERSION_CONFLICT' : 'DEPENDENCY_UNAVAILABLE',
    String(last).includes('staff_assignment_cursor_version_conflict') ? 409 : 503,
  );
}

export async function batchWithAssignmentRetry(
  database: SqlDatabase,
  prepare: () => Promise<PreparedDirectWorkItem>,
  businessStatements: readonly SqlStatement[],
  maximumAttempts = 3,
): Promise<PreparedDirectWorkItem> {
  let last: unknown;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const prepared = await prepare();
    try {
      await database.batch([
        ...businessStatements,
        ...prepared.statements,
      ]);
      return prepared;
    } catch (error) {
      last = error;
      if (!String(error).includes(
        'staff_assignment_cursor_version_conflict',
      )) {
        throw error;
      }
    }
  }
  throw new StaffAssignmentError(
    String(last).includes('staff_assignment_cursor_version_conflict')
      ? 'VERSION_CONFLICT'
      : 'DEPENDENCY_UNAVAILABLE',
    String(last).includes('staff_assignment_cursor_version_conflict')
      ? 409
      : 503,
  );
}

export async function prepareWorkItemCompletionStatements(
  database: SqlDatabase,
  input: {
    workType: StaffWorkItemType;
    sourceEntityType: DirectWorkItemInput['sourceEntityType'];
    sourceEntityId: string;
    outcome: 'COMPLETED' | 'CANCELLED';
    actorType: 'STAFF' | 'SYSTEM';
    actorId?: string | null;
    requestId?: string | null;
    idempotencyKey?: string | null;
    reason?: string | null;
    now: number;
  },
): Promise<readonly SqlStatement[]> {
  const item = await database.prepare(`
    SELECT id, duty_code, fixed_assignment_id, assigned_staff_id
    FROM staff_work_items
    WHERE source_entity_type=? AND source_entity_id=?
      AND work_type=? AND status='OPEN'
  `).bind(
    input.sourceEntityType,
    input.sourceEntityId,
    input.workType,
  ).first<{
    id: string;
    duty_code: StaffAssignmentDutyCode;
    fixed_assignment_id: string;
    assigned_staff_id: string;
  }>();
  if (!item) return [];
  const terminalColumn = input.outcome === 'COMPLETED'
    ? 'completed_at'
    : 'cancelled_at';
  const eventType = input.outcome === 'COMPLETED'
    ? 'WORK_ITEM_COMPLETED'
    : 'WORK_ITEM_CANCELLED';
  const outbox = await prepareStaffAssignmentOutboxStatements(database, {
    dedupKey: `staff-work-item:${item.id}:${input.outcome.toLowerCase()}`,
    eventType,
    aggregateType: 'STAFF_WORK_ITEM',
    aggregateId: item.id,
    payload: {
      work_item_id: item.id,
      work_type: input.workType,
      source_entity_type: input.sourceEntityType,
      source_entity_id: input.sourceEntityId,
      duty_code: item.duty_code,
      assignment_id: item.fixed_assignment_id,
      assigned_staff_id: item.assigned_staff_id,
      status: input.outcome,
      reason: input.reason ?? null,
    },
    now: input.now,
  });
  return [
    database.prepare(`
      UPDATE staff_work_items
      SET status=?, version=version+1,
        updated_at=MAX(?, updated_at+1),
        ${terminalColumn}=?
      WHERE id=? AND status='OPEN'
    `).bind(input.outcome, input.now, input.now, item.id),
    database.prepare(`
      INSERT INTO staff_assignment_events (
        id, event_type, subject_type, subject_id,
        duty_code, assignment_id, work_item_id, batch_id,
        old_staff_id, new_staff_id, actor_type, actor_id,
        reason, request_id, idempotency_key, metadata_json, created_at
      ) VALUES (?, ?, 'WORK_ITEM', ?, ?, ?, ?, NULL,
        ?, ?, ?, ?, ?, ?, ?, '{}', ?)
    `).bind(
      crypto.randomUUID(),
      eventType,
      item.id,
      item.duty_code,
      item.fixed_assignment_id,
      item.id,
      item.assigned_staff_id,
      item.assigned_staff_id,
      input.actorType,
      input.actorId ?? null,
      input.reason ?? null,
      input.requestId ?? null,
      input.idempotencyKey ?? null,
      input.now,
    ),
    ...outbox,
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN
        EXISTS (
          SELECT 1 FROM staff_work_items
          WHERE id=? AND status=?
        )
        AND EXISTS (
          SELECT 1 FROM staff_assignment_events
          WHERE work_item_id=? AND event_type=?
        )
      THEN 1 ELSE 0 END
    `).bind(item.id, input.outcome, item.id, eventType),
  ];
}


async function resolveFallbackWithFailureEvent(
  database: SqlDatabase,
  input: {
    marketplaceCode: string;
    dutyCode: StaffAssignmentDutyCode;
    workType: StaffWorkItemType;
    actorType: 'STAFF' | 'SYSTEM';
    actorId: string | null;
    requestId: string | null;
    idempotencyKey: string | null;
    now: number;
  },
) {
  try {
    return await resolveOwnerFallback(database, input);
  } catch (error) {
    await recordAssignmentFailure(database, {
      ...input,
      errorCode: error instanceof StaffAssignmentError
        ? error.code : 'DEPENDENCY_UNAVAILABLE',
    });
    throw error;
  }
}

async function resolveFixedFallbackWithFailureEvent(
  database: SqlDatabase,
  input: {
    marketplaceCode: string;
    dutyCode: StaffAssignmentDutyCode;
    actorType: 'STAFF' | 'SYSTEM';
    actorId: string | null;
    requestId: string | null;
    idempotencyKey: string | null;
    now: number;
  },
) {
  try {
    return await resolveOwnerFallbackForFixedDuty(database, input);
  } catch (error) {
    await recordAssignmentFailure(database, {
      ...input,
      workType: null,
      errorCode: error instanceof StaffAssignmentError
        ? error.code : 'DEPENDENCY_UNAVAILABLE',
    });
    throw error;
  }
}

async function recordAssignmentFailure(
  database: SqlDatabase,
  input: {
    marketplaceCode: string;
    dutyCode: StaffAssignmentDutyCode;
    workType: StaffWorkItemType | null;
    actorType: 'STAFF' | 'SYSTEM';
    actorId: string | null;
    requestId: string | null;
    idempotencyKey: string | null;
    now: number;
    errorCode: string;
  },
): Promise<void> {
  const failureKey = input.idempotencyKey ?? crypto.randomUUID();
  const outbox = await prepareStaffAssignmentOutboxStatements(database, {
    dedupKey: `failure:${input.dutyCode}:${failureKey}`,
    eventType: 'ASSIGNMENT_FAILED',
    aggregateType: 'STAFF_ASSIGNMENT_FALLBACK',
    aggregateId: input.marketplaceCode,
    payload: {
      marketplace_code: input.marketplaceCode,
      duty_code: input.dutyCode,
      work_type: input.workType,
      error_code: input.errorCode,
      request_id: input.requestId,
      idempotency_key: input.idempotencyKey,
    },
    now: input.now,
  });
  await database.batch([
    database.prepare(`
      INSERT OR IGNORE INTO staff_assignment_events (
        id, event_type, subject_type, subject_id,
        duty_code, assignment_id, work_item_id, batch_id,
        old_staff_id, new_staff_id, actor_type, actor_id,
        reason, request_id, idempotency_key, metadata_json, created_at
      ) VALUES (?, 'ASSIGNMENT_FAILED', 'MARKETPLACE', ?, ?, NULL, NULL, NULL,
        NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.marketplaceCode,
      input.dutyCode,
      input.actorType,
      input.actorId,
      input.errorCode,
      input.requestId,
      input.idempotencyKey,
      JSON.stringify({
        work_type: input.workType,
        error_code: input.errorCode,
      }),
      input.now,
    ),
    ...outbox,
  ]);
}

async function readActiveAssignment(
  database: SqlDatabase,
  input: DirectWorkItemInput,
  dutyCode: StaffAssignmentDutyCode,
): Promise<ActiveAssignmentRow | null> {
  if (dutyCode === 'SELLER_ACCOUNT_MANAGER') {
    return database.prepare(`
      SELECT id, staff_id, source FROM seller_staff_assignments
      WHERE seller_organization_id=? AND duty_code=? AND status='ACTIVE'
    `).bind(
      input.sellerOrganizationId ?? '',
      dutyCode,
    ).first<ActiveAssignmentRow>();
  }
  return database.prepare(`
    SELECT id, staff_id, source FROM buyer_staff_assignments
    WHERE buyer_customer_id=? AND duty_code=? AND status='ACTIVE'
  `).bind(
    input.buyerCustomerId ?? '',
    dutyCode,
  ).first<ActiveAssignmentRow>();
}

function validateSubject(
  input: DirectWorkItemInput,
  dutyCode: StaffAssignmentDutyCode,
): void {
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  if (dutyCode === 'SELLER_ACCOUNT_MANAGER') {
    if (!input.sellerOrganizationId) {
      throw new StaffAssignmentError('VALIDATION_ERROR', 400);
    }
  } else if (!input.buyerCustomerId) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
}

function subjectType(
  input: DirectWorkItemInput,
  dutyCode: StaffAssignmentDutyCode,
): 'BUYER' | 'SELLER' {
  return dutyCode === 'SELLER_ACCOUNT_MANAGER' ? 'SELLER' : 'BUYER';
}

function revokeAssignmentStatement(
  database: SqlDatabase,
  input: DirectWorkItemInput,
  dutyCode: StaffAssignmentDutyCode,
  assignmentId: string,
): SqlStatement {
  const table = dutyCode === 'SELLER_ACCOUNT_MANAGER'
    ? 'seller_staff_assignments'
    : 'buyer_staff_assignments';
  return database.prepare(`
    UPDATE ${table}
    SET status='REVOKED', revoked_at=?,
      version=version+1, updated_at=MAX(?, updated_at+1)
    WHERE id=? AND status='ACTIVE'
  `).bind(input.now, input.now, assignmentId);
}

function insertAssignmentStatement(
  database: SqlDatabase,
  input: DirectWorkItemInput & {
    dutyCode: StaffAssignmentDutyCode;
    staffId: string;
    assignmentId: string;
    source: StaffAssignmentSource;
  },
): SqlStatement {
  if (input.dutyCode === 'SELLER_ACCOUNT_MANAGER') {
    return database.prepare(`
      INSERT INTO seller_staff_assignments (
        id, seller_organization_id, duty_code, staff_id, status, source,
        assigned_by_actor_type, assigned_by_actor_id, reason,
        version, created_at, updated_at, revoked_at
      ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, 1, ?, ?, NULL)
    `).bind(
      input.assignmentId,
      input.sellerOrganizationId,
      input.dutyCode,
      input.staffId,
      input.source,
      input.actorType,
      input.actorId ?? null,
      input.reason ?? null,
      input.now,
      input.now,
    );
  }
  return database.prepare(`
    INSERT INTO buyer_staff_assignments (
      id, buyer_customer_id, duty_code, staff_id, status, source,
      assigned_by_actor_type, assigned_by_actor_id, reason,
      version, created_at, updated_at, revoked_at
    ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, 1, ?, ?, NULL)
  `).bind(
    input.assignmentId,
    input.buyerCustomerId,
    input.dutyCode,
    input.staffId,
    input.source,
    input.actorType,
    input.actorId ?? null,
    input.reason ?? null,
    input.now,
    input.now,
  );
}

export function createCursorAdvanceStatements(
  database: SqlDatabase,
  candidate: ResolvedRoundRobinCandidate,
  staffId: string,
  now: number,
): readonly SqlStatement[] {
  const cursor = candidate.cursor;
  if (!cursor.exists) {
    return [
      database.prepare(`
        INSERT INTO staff_assignment_cursors (
          duty_code, marketplace_code, candidate_pool_key, team_id,
          last_assigned_staff_id, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).bind(
        cursor.dutyCode,
        cursor.marketplaceCode,
        cursor.candidatePoolKey,
        cursor.teamId,
        staffId,
        now,
        now,
      ),
      database.prepare(`
        INSERT INTO staff_assignment_cursor_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM staff_assignment_cursors
          WHERE duty_code=? AND marketplace_code=?
            AND candidate_pool_key=?
            AND last_assigned_staff_id=? AND version=1
        ) THEN 1 ELSE 0 END
      `).bind(
        cursor.dutyCode,
        cursor.marketplaceCode,
        cursor.candidatePoolKey,
        staffId,
      ),
    ];
  }
  return [
    database.prepare(`
      UPDATE staff_assignment_cursors
      SET last_assigned_staff_id=?, version=version+1,
        updated_at=MAX(?, updated_at+1)
      WHERE duty_code=? AND marketplace_code=?
        AND candidate_pool_key=? AND version=?
    `).bind(
      staffId,
      now,
      cursor.dutyCode,
      cursor.marketplaceCode,
      cursor.candidatePoolKey,
      cursor.expectedVersion,
    ),
    database.prepare(`
      INSERT INTO staff_assignment_cursor_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM staff_assignment_cursors
        WHERE duty_code=? AND marketplace_code=?
          AND candidate_pool_key=?
          AND last_assigned_staff_id=? AND version=?
      ) THEN 1 ELSE 0 END
    `).bind(
      cursor.dutyCode,
      cursor.marketplaceCode,
      cursor.candidatePoolKey,
      staffId,
      cursor.expectedVersion + 1,
    ),
  ];
}

function createWorkItemStatements(
  database: SqlDatabase,
  input: DirectWorkItemInput & {
    dutyCode: StaffAssignmentDutyCode;
    assignmentId: string;
    assignmentType: 'BUYER' | 'SELLER';
    assignedStaffId: string;
    workItemId: string;
  },
): readonly SqlStatement[] {
  return [
    database.prepare(`
      INSERT INTO staff_work_items (
        id, work_type, source_entity_type, source_entity_id,
        buyer_customer_id, seller_organization_id, store_id,
        duty_code, fixed_assignment_type, fixed_assignment_id,
        assigned_staff_id, status, version, created_at, updated_at,
        completed_at, cancelled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', 1, ?, ?, NULL, NULL)
    `).bind(
      input.workItemId,
      input.workType,
      input.sourceEntityType,
      input.sourceEntityId,
      input.buyerCustomerId ?? null,
      input.sellerOrganizationId ?? null,
      input.storeId ?? null,
      input.dutyCode,
      input.assignmentType,
      input.assignmentId,
      input.assignedStaffId,
      input.now,
      input.now,
    ),
    database.prepare(`
      INSERT INTO staff_assignment_events (
        id, event_type, subject_type, subject_id,
        duty_code, assignment_id, work_item_id, batch_id,
        old_staff_id, new_staff_id, actor_type, actor_id,
        reason, request_id, idempotency_key, metadata_json, created_at
      ) VALUES (?, 'WORK_ITEM_CREATED', 'WORK_ITEM', ?, ?, ?, ?, NULL,
        NULL, ?, ?, ?, ?, ?, ?, '{}', ?)
    `).bind(
      crypto.randomUUID(),
      input.workItemId,
      input.dutyCode,
      input.assignmentId,
      input.workItemId,
      input.assignedStaffId,
      input.actorType,
      input.actorId ?? null,
      input.reason ?? null,
      input.requestId ?? null,
      input.idempotencyKey ?? null,
      input.now,
    ),
     database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM staff_work_items
        WHERE id=? AND status='OPEN' AND assigned_staff_id=?
          AND fixed_assignment_id=? AND duty_code=?
      ) THEN 1 ELSE 0 END
    `).bind(
      input.workItemId,
      input.assignedStaffId,
      input.assignmentId,
      input.dutyCode,
    ),
  ];
}

function assignmentEventStatement(
  database: SqlDatabase,
  input: {
    eventType: 'AUTO_INITIAL_ASSIGNMENT' | 'AUTO_REPLACEMENT' | 'OWNER_FALLBACK';
    input: DirectWorkItemInput;
    dutyCode: StaffAssignmentDutyCode;
    assignmentId: string;
    oldStaffId: string | null;
    newStaffId: string;
  },
): SqlStatement {
  const isSeller = input.dutyCode === 'SELLER_ACCOUNT_MANAGER';
  return database.prepare(`
    INSERT INTO staff_assignment_events (
      id, event_type, subject_type, subject_id,
      duty_code, assignment_id, work_item_id, batch_id,
      old_staff_id, new_staff_id, actor_type, actor_id,
      reason, request_id, idempotency_key, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
  `).bind(
    crypto.randomUUID(),
    input.eventType,
    isSeller ? 'SELLER_ORGANIZATION' : 'BUYER_CUSTOMER',
    input.input.sellerOrganizationId ?? input.input.buyerCustomerId,
    input.dutyCode,
    input.assignmentId,
    input.oldStaffId,
    input.newStaffId,
    input.input.actorType,
    input.input.actorId ?? null,
    input.input.reason ?? null,
    input.input.requestId ?? null,
    input.input.idempotencyKey ?? null,
    input.input.now,
  );
}
