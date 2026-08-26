import type {
  SqlDatabase,
  SqlStatement,
  StaffAssignmentDutyCode,
  StaffAssignmentSource,
  StaffWorkItemType,
} from '@ygb/contracts';
import { canonicalMarketplaceCode, dutyForWorkItem } from '@ygb/domain';
import { isStaffEligibleForDuty, isStaffEligibleForFixedDuty } from './candidate-resolver';
import {
  dutyOwnerNotAssignedErrorCode,
  normalizeStaffAssignmentError,
  StaffAssignmentError,
} from './errors';
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
    | 'ORDER_INSTRUCTION'
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
}

export interface PreparedDirectWorkItem {
  workItemId: string;
  assignmentId: string;
  assignedStaffId: string;
  assignmentSource: StaffAssignmentSource;
  statements: readonly SqlStatement[];
  replayedExisting: boolean;
}

/**
 * Fixed-duty assignment (D-056): a work item always resolves to the
 * subject's existing duty owner binding — the buyer's BUYER_PRE_SALES_OWNER,
 * the buyer's BUYER_REFUND_OWNER, or the seller organization's
 * SELLER_ACCOUNT_MANAGER. When the required binding is missing or its owner
 * is no longer eligible, the operation fails closed with a stable
 * `${duty}_NOT_ASSIGNED` error. There is no pool, no round-robin and no
 * automatic fallback.
 */
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
  if (!active || !await isStaffEligibleForDuty(database, {
    staffId: active.staff_id,
    dutyCode,
    workType: input.workType,
    marketplaceCode: input.marketplaceCode,
  })) {
    throw new StaffAssignmentError(
      dutyOwnerNotAssignedErrorCode(dutyCode),
      503,
    );
  }

  const workItemId = crypto.randomUUID();
  return {
    workItemId,
    assignmentId: active.id,
    assignedStaffId: active.staff_id,
    assignmentSource: active.source,
    replayedExisting: false,
    statements: createWorkItemStatements(database, {
      ...input,
      dutyCode,
      assignmentId: active.id,
      assignmentType: subjectType(dutyCode),
      assignedStaffId: active.staff_id,
      workItemId,
    }),
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
 * created seller organization, binding the creating staff member as the
 * initial fixed owner. It deliberately creates no Work Item. Fails closed
 * with SELLER_ACCOUNT_MANAGER_NOT_ASSIGNED when the creator cannot hold the
 * duty.
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
  },
): Promise<PreparedFixedAssignment> {
  const dutyCode: StaffAssignmentDutyCode = 'SELLER_ACCOUNT_MANAGER';
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
  const creatorStaffId = input.actorType === 'STAFF'
    ? (input.actorId ?? null)
    : null;
  if (!creatorStaffId
    || !await isStaffEligibleForFixedDuty(database, {
      staffId: creatorStaffId,
      dutyCode,
      marketplaceCode: input.marketplaceCode,
    })) {
    throw new StaffAssignmentError('SELLER_ACCOUNT_MANAGER_NOT_ASSIGNED', 503);
  }
  const directInput: DirectWorkItemInput = {
    workType: 'PRODUCT_APPLICATION_REVIEW',
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
  };
  const assignmentId = crypto.randomUUID();
  const statements: SqlStatement[] = [
    insertAssignmentStatement(database, {
      ...directInput,
      dutyCode,
      staffId: creatorStaffId,
      assignmentId,
      source: 'AUTO_INITIAL',
    }),
    assignmentEventStatement(database, {
      eventType: 'AUTO_INITIAL_ASSIGNMENT',
      input: directInput,
      dutyCode,
      assignmentId,
      oldStaffId: null,
      newStaffId: creatorStaffId,
    }),
    ...await prepareStaffAssignmentOutboxStatements(database, {
      dedupKey: `staff-assignment:${assignmentId}:created`,
      eventType: 'AUTO_INITIAL_ASSIGNMENT',
      aggregateType: 'STAFF_ASSIGNMENT',
      aggregateId: assignmentId,
      payload: {
        assignment_id: assignmentId,
        subject_type: 'SELLER',
        seller_organization_id: input.sellerOrganizationId,
        duty_code: dutyCode,
        previous_staff_id: null,
        assigned_staff_id: creatorStaffId,
        source: 'AUTO_INITIAL',
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
      creatorStaffId,
    ),
  ];
  return {
    assignmentId,
    assignedStaffId: creatorStaffId,
    assignmentSource: 'AUTO_INITIAL',
    statements,
    replayedExisting: false,
  };
}

/**
 * Creates the initial buyer duty binding (BUYER_PRE_SALES_OWNER) with the
 * creating staff member as the fixed owner. Fails closed with
 * BUYER_PRE_SALES_OWNER_NOT_ASSIGNED when the creator cannot hold the duty.
 */
export async function prepareInitialBuyerAssignment(
  database: SqlDatabase,
  input: {
    buyerCustomerId: string;
    marketplaceCode: string;
    actorType: 'STAFF' | 'SYSTEM';
    actorId?: string | null;
    requestId?: string | null;
    idempotencyKey?: string | null;
    reason?: string | null;
    now: number;
  },
): Promise<PreparedFixedAssignment> {
  const dutyCode: StaffAssignmentDutyCode = 'BUYER_PRE_SALES_OWNER';
  const existing = await database.prepare(`
    SELECT id, staff_id, source
    FROM buyer_staff_assignments
    WHERE buyer_customer_id=?
      AND duty_code='BUYER_PRE_SALES_OWNER'
      AND status='ACTIVE'
  `).bind(input.buyerCustomerId).first<ActiveAssignmentRow>();
  if (existing) {
    return {
      assignmentId: existing.id,
      assignedStaffId: existing.staff_id,
      assignmentSource: existing.source,
      statements: [],
      replayedExisting: true,
    };
  }
  const creatorStaffId = input.actorType === 'STAFF'
    ? (input.actorId ?? null)
    : null;
  if (!creatorStaffId
    || !await isStaffEligibleForFixedDuty(database, {
      staffId: creatorStaffId,
      dutyCode,
      marketplaceCode: input.marketplaceCode,
    })) {
    throw new StaffAssignmentError('BUYER_PRE_SALES_OWNER_NOT_ASSIGNED', 503);
  }
  const directInput: DirectWorkItemInput = {
    workType: 'RESERVATION_DECISION',
    sourceEntityType: 'RESERVATION',
    sourceEntityId: `buyer-customer:${input.buyerCustomerId}`,
    marketplaceCode: input.marketplaceCode,
    buyerCustomerId: input.buyerCustomerId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    requestId: input.requestId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    reason: input.reason ?? null,
    now: input.now,
  };
  const assignmentId = crypto.randomUUID();
  const statements: SqlStatement[] = [
    insertAssignmentStatement(database, {
      ...directInput,
      dutyCode,
      staffId: creatorStaffId,
      assignmentId,
      source: 'AUTO_INITIAL',
    }),
    assignmentEventStatement(database, {
      eventType: 'AUTO_INITIAL_ASSIGNMENT',
      input: directInput,
      dutyCode,
      assignmentId,
      oldStaffId: null,
      newStaffId: creatorStaffId,
    }),
    ...await prepareStaffAssignmentOutboxStatements(database, {
      dedupKey: `staff-assignment:${assignmentId}:created`,
      eventType: 'AUTO_INITIAL_ASSIGNMENT',
      aggregateType: 'STAFF_ASSIGNMENT',
      aggregateId: assignmentId,
      payload: {
        assignment_id: assignmentId,
        subject_type: 'BUYER',
        buyer_customer_id: input.buyerCustomerId,
        duty_code: dutyCode,
        previous_staff_id: null,
        assigned_staff_id: creatorStaffId,
        source: 'AUTO_INITIAL',
      },
      now: input.now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM buyer_staff_assignments
        WHERE id=? AND buyer_customer_id=?
          AND duty_code='BUYER_PRE_SALES_OWNER'
          AND staff_id=? AND status='ACTIVE'
      ) THEN 1 ELSE 0 END
    `).bind(
      assignmentId,
      input.buyerCustomerId,
      creatorStaffId,
    ),
  ];
  return {
    assignmentId,
    assignedStaffId: creatorStaffId,
    assignmentSource: 'AUTO_INITIAL',
    statements,
    replayedExisting: false,
  };
}

export async function batchWithFixedAssignmentRetry(
  database: SqlDatabase,
  prepare: () => Promise<PreparedFixedAssignment>,
  businessStatements: readonly SqlStatement[],
): Promise<PreparedFixedAssignment> {
  const prepared = await prepare();
  try {
    await database.batch([...businessStatements, ...prepared.statements]);
    return prepared;
  } catch (error) {
    throw normalizeStaffAssignmentError(error);
  }
}

export async function batchWithAssignmentRetry(
  database: SqlDatabase,
  prepare: () => Promise<PreparedDirectWorkItem>,
  businessStatements: readonly SqlStatement[],
): Promise<PreparedDirectWorkItem> {
  const prepared = await prepare();
  try {
    await database.batch([
      ...businessStatements,
      ...prepared.statements,
    ]);
    return prepared;
  } catch (error) {
    throw normalizeStaffAssignmentError(error);
  }
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
  dutyCode: StaffAssignmentDutyCode,
): 'BUYER' | 'SELLER' {
  return dutyCode === 'SELLER_ACCOUNT_MANAGER' ? 'SELLER' : 'BUYER';
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
  const marketplaceCode = canonicalMarketplaceCode(input.marketplaceCode);
  return [
    database.prepare(`
      INSERT INTO staff_work_items (
        id, work_type, source_entity_type, source_entity_id,
        buyer_customer_id, seller_organization_id, store_id,
        duty_code, fixed_assignment_type, fixed_assignment_id,
        assigned_staff_id, marketplace_code, status, version, created_at, updated_at,
        completed_at, cancelled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', 1, ?, ?, NULL, NULL)
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
      marketplaceCode,
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
    eventType: 'AUTO_INITIAL_ASSIGNMENT';
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
