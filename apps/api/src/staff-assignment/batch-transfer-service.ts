import type {
  SqlDatabase,
  SqlStatement,
  StaffAssignmentDutyCode,
  StaffAssignmentSubjectType,
  StaffReassignmentBatchDto,
} from '@ygb/contracts';
import {
  cleanAssignmentIdentifier,
  cleanAssignmentReason,
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
  createCursorAdvanceStatements,
} from './assignment-service';
import {
  resolveOwnerFallbackForFixedDuty,
  resolveRoundRobinFixedDutyCandidate,
  type ResolvedRoundRobinCandidate,
} from './candidate-resolver';
import type { AssignmentStaffAuthorization } from './effective-authorization';
import {
  StaffAssignmentError,
  normalizeStaffAssignmentError,
} from './errors';
import { requirePermission } from './permission-policy';
import {
  assignmentSubjectColumn,
  assignmentTable,
  requireEligibleFixedAssignmentTarget,
  workItemSubjectColumnFor,
} from './reassignment-service';

interface BatchRow {
  id: string;
  source_staff_id: string;
  target_mode: 'STAFF' | 'AUTO_SELECT';
  target_staff_id: string | null;
  duty_code: StaffAssignmentDutyCode;
  subject_type: StaffAssignmentSubjectType;
  status: StaffReassignmentBatchDto['status'];
  reason: string;
  version: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

interface BatchItemRow {
  id: string;
  subject_id: string;
  old_assignment_id: string;
  status: 'PENDING' | 'FAILED';
}

interface AssignmentRow {
  id: string;
  staff_id: string;
  version: number;
}

interface BatchCommand {
  actor: AssignmentStaffAuthorization;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
}

export async function createReassignmentBatch(
  database: SqlDatabase,
  input: {
    sourceStaffId: string;
    targetStaffId?: string | null;
    dutyCode: StaffAssignmentDutyCode;
    subjectType: StaffAssignmentSubjectType;
    reason: string;
  },
  command: BatchCommand,
): Promise<StaffReassignmentBatchDto & { replayed: boolean }> {
  requireBatchPermission(command.actor);
  const sourceStaffId = cleanAssignmentIdentifier(input.sourceStaffId);
  const targetStaffId = input.targetStaffId == null
    ? null
    : cleanAssignmentIdentifier(input.targetStaffId);
  const reason = cleanAssignmentReason(input.reason);
  validateSubjectDuty(input.subjectType, input.dutyCode);
  if (targetStaffId === sourceStaffId) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();
  validateTime(now);
  if (targetStaffId) {
    await requireEligibleFixedAssignmentTarget(database, {
      targetStaffId,
      dutyCode: input.dutyCode,
    });
  }

  const requestHash = await hashCanonicalJson({
    action: 'CREATE_STAFF_REASSIGNMENT_BATCH',
    source_staff_id: sourceStaffId,
    target_staff_id: targetStaffId,
    duty_code: input.dutyCode,
    subject_type: input.subjectType,
    reason,
  });
  type Result = StaffReassignmentBatchDto & { replayed: boolean };
  const acquired = await acquireIdempotency<Result>(database, {
    actorType: 'STAFF',
    actorId: command.actor.staffId,
    action: 'CREATE_STAFF_REASSIGNMENT_BATCH',
    targetType: 'STAFF',
    targetId: `${sourceStaffId}:${input.dutyCode}`,
    idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const batchId = crypto.randomUUID();
    const table = assignmentTable(input.subjectType);
    const subjectColumn = assignmentSubjectColumn(input.subjectType);
    const assignments = await database.prepare(`
      SELECT id, ${subjectColumn} AS subject_id
      FROM ${table}
      WHERE staff_id=? AND duty_code=? AND status='ACTIVE'
      ORDER BY ${subjectColumn}, id
    `).bind(sourceStaffId, input.dutyCode).all<{
      id: string;
      subject_id: string;
    }>();
    const response: Result = {
      batch_id: batchId,
      source_staff_id: sourceStaffId,
      target_mode: targetStaffId ? 'STAFF' : 'AUTO_SELECT',
      target_staff_id: targetStaffId,
      duty_code: input.dutyCode,
      subject_type: input.subjectType,
      status: 'PENDING',
      reason,
      version: 1,
      total_items: assignments.results.length,
      completed_items: 0,
      failed_items: 0,
      created_at: now,
      started_at: null,
      completed_at: null,
      replayed: false,
    };
    const outbox = await prepareStaffAssignmentOutboxStatements(database, {
      dedupKey: `staff-reassignment-batch:${batchId}:created`,
      eventType: 'STAFF_REASSIGNMENT_BATCH_CREATED',
      aggregateType: 'STAFF_REASSIGNMENT_BATCH',
      aggregateId: batchId,
      payload: response,
      now,
    });
    await database.batch([
      database.prepare(`
        INSERT INTO staff_reassignment_batches (
          id, source_staff_id, target_mode, target_staff_id,
          duty_code, subject_type, status, reason, created_by_staff_id,
          version, created_at, updated_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 1, ?, ?, NULL, NULL)
      `).bind(
        batchId,
        sourceStaffId,
        response.target_mode,
        targetStaffId,
        input.dutyCode,
        input.subjectType,
        reason,
        command.actor.staffId,
        now,
        now,
      ),
      ...assignments.results.map((assignment) => database.prepare(`
        INSERT INTO staff_reassignment_batch_items (
          id, batch_id, subject_id, old_assignment_id,
          new_assignment_id, status, error_code, attempt_count,
          created_at, updated_at, processed_at
        ) VALUES (?, ?, ?, ?, NULL, 'PENDING', NULL, 0, ?, ?, NULL)
      `).bind(
        crypto.randomUUID(),
        batchId,
        assignment.subject_id,
        assignment.id,
        now,
        now,
      )),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'STAFF_REASSIGNMENT_BATCH',
        aggregateId: batchId,
        eventType: 'STAFF_REASSIGNMENT_BATCH_CREATED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
        nextState: response,
        reason,
        createdAt: now,
      }),
      ...outbox,
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { batch_id: batchId },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM staff_reassignment_batches
          WHERE id=? AND status='PENDING' AND version=1
        ) AND (
          SELECT COUNT(*) FROM staff_reassignment_batch_items
          WHERE batch_id=?
        )=? THEN 1 ELSE 0 END
      `).bind(batchId, batchId, assignments.results.length),
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

export async function runReassignmentBatchChunk(
  database: SqlDatabase,
  input: {
    batchId: string;
    expectedVersion: number;
    limit?: number;
    marketplaceCode?: string;
  },
  command: BatchCommand,
): Promise<StaffReassignmentBatchDto> {
  requireBatchPermission(command.actor);
  const batchId = cleanAssignmentIdentifier(input.batchId);
  const marketplaceCode = cleanAssignmentIdentifier(
    input.marketplaceCode ?? 'JP',
    20,
  );
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();
  validateTime(now);
  const requestHash = await hashCanonicalJson({
    action: 'RUN_STAFF_REASSIGNMENT_BATCH_CHUNK',
    batch_id: batchId,
    expected_version: input.expectedVersion,
    limit,
    marketplace_code: marketplaceCode,
  });
  const acquired = await acquireIdempotency<StaffReassignmentBatchDto>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'RUN_STAFF_REASSIGNMENT_BATCH_CHUNK',
      targetType: 'STAFF_REASSIGNMENT_BATCH',
      targetId: batchId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') return acquired.response;

  try {
    let batch = await readBatch(database, batchId);
    if (!batch) throw new StaffAssignmentError('NOT_FOUND', 404);
    if (Number(batch.version) !== input.expectedVersion
      || !['PENDING', 'RUNNING', 'PARTIALLY_FAILED'].includes(batch.status)) {
      throw new StaffAssignmentError('BATCH_STATE_CONFLICT', 409);
    }
    if (batch.status !== 'RUNNING') {
      const nextVersion = Number(batch.version) + 1;
      const startedOutbox = await prepareStaffAssignmentOutboxStatements(database, {
        dedupKey: `staff-reassignment-batch:${batchId}:started:v${nextVersion}`,
        eventType: 'BATCH_TRANSFER_STARTED',
        aggregateType: 'STAFF_REASSIGNMENT_BATCH',
        aggregateId: batchId,
        payload: {
          batch_id: batchId,
          status: 'RUNNING',
          version: nextVersion,
          source_staff_id: batch.source_staff_id,
          target_staff_id: batch.target_staff_id,
          duty_code: batch.duty_code,
        },
        now,
      });
      await database.batch([
        database.prepare(`
          UPDATE staff_reassignment_batches
          SET status='RUNNING', started_at=COALESCE(started_at, ?),
            completed_at=NULL, version=version+1,
            updated_at=MAX(?, updated_at+1)
          WHERE id=? AND version=?
            AND status IN ('PENDING', 'PARTIALLY_FAILED')
        `).bind(now, now, batchId, batch.version),
        database.prepare(`
          INSERT INTO staff_assignment_events (
            id, event_type, subject_type, subject_id,
            duty_code, assignment_id, work_item_id, batch_id,
            old_staff_id, new_staff_id, actor_type, actor_id,
            reason, request_id, idempotency_key, metadata_json, created_at
          ) VALUES (?, 'BATCH_TRANSFER_STARTED', 'REASSIGNMENT_BATCH', ?,
            ?, NULL, NULL, ?, ?, ?, 'STAFF', ?, ?, ?, ?, '{}', ?)
        `).bind(
          crypto.randomUUID(),
          batchId,
          batch.duty_code,
          batchId,
          batch.source_staff_id,
          batch.target_staff_id,
          command.actor.staffId,
          batch.reason,
          command.requestId ?? null,
          acquired.claim.idempotencyKey,
          now,
        ),
        ...startedOutbox,
        database.prepare(`
          INSERT INTO transaction_assertions (assertion_value)
          SELECT CASE WHEN EXISTS (
            SELECT 1 FROM staff_reassignment_batches
            WHERE id=? AND status='RUNNING' AND version=?
          ) THEN 1 ELSE 0 END
        `).bind(batchId, nextVersion),
      ]);
      batch = { ...batch, status: 'RUNNING', version: nextVersion };
    }

    const items = await database.prepare(`
      SELECT id, subject_id, old_assignment_id, status
      FROM staff_reassignment_batch_items
      WHERE batch_id=? AND status IN ('PENDING', 'FAILED')
      ORDER BY id
      LIMIT ?
    `).bind(batchId, limit).all<BatchItemRow>();
    for (const item of items.results) {
      await processBatchItemWithRetry(database, {
        batch,
        item,
        marketplaceCode,
        actor: command.actor,
        requestId: command.requestId ?? null,
        idempotencyKey: `${acquired.claim.idempotencyKey}:${item.id}`,
        now,
      });
    }
    await finalizeBatchStatus(database, batch, now, command, acquired.claim.idempotencyKey);
    const response = await getReassignmentBatch(database, batchId);
    await database.batch([
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { batch_id: batchId },
        now,
      }),
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

export async function getReassignmentBatch(
  database: SqlDatabase,
  batchId: string,
): Promise<StaffReassignmentBatchDto> {
  const normalizedId = cleanAssignmentIdentifier(batchId);
  const batch = await readBatch(database, normalizedId);
  if (!batch) throw new StaffAssignmentError('NOT_FOUND', 404);
  const counts = await database.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed
    FROM staff_reassignment_batch_items WHERE batch_id=?
  `).bind(normalizedId).first<{
    total: number;
    completed: number | null;
    failed: number | null;
  }>();
  return {
    batch_id: batch.id,
    source_staff_id: batch.source_staff_id,
    target_mode: batch.target_mode,
    target_staff_id: batch.target_staff_id,
    duty_code: batch.duty_code,
    subject_type: batch.subject_type,
    status: batch.status,
    reason: batch.reason,
    version: Number(batch.version),
    total_items: Number(counts?.total ?? 0),
    completed_items: Number(counts?.completed ?? 0),
    failed_items: Number(counts?.failed ?? 0),
    created_at: Number(batch.created_at),
    started_at: batch.started_at === null ? null : Number(batch.started_at),
    completed_at: batch.completed_at === null ? null : Number(batch.completed_at),
  };
}

async function processBatchItemWithRetry(
  database: SqlDatabase,
  input: {
    batch: BatchRow;
    item: BatchItemRow;
    marketplaceCode: string;
    actor: AssignmentStaffAuthorization;
    requestId: string | null;
    idempotencyKey: string;
    now: number;
  },
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await processBatchItem(database, input);
      return;
    } catch (error) {
      lastError = error;
      if (!String(error).includes('staff_assignment_cursor_version_conflict')) {
        break;
      }
    }
  }
  const normalized = normalizeStaffAssignmentError(lastError);
  await database.prepare(`
    UPDATE staff_reassignment_batch_items
    SET status='FAILED', error_code=?, attempt_count=attempt_count+1,
      processed_at=?, updated_at=MAX(?, updated_at+1)
    WHERE id=? AND status IN ('PENDING', 'FAILED')
  `).bind(
    normalized.code,
    input.now,
    input.now,
    input.item.id,
  ).run();
}

async function processBatchItem(
  database: SqlDatabase,
  input: {
    batch: BatchRow;
    item: BatchItemRow;
    marketplaceCode: string;
    actor: AssignmentStaffAuthorization;
    requestId: string | null;
    idempotencyKey: string;
    now: number;
  },
): Promise<void> {
  const table = assignmentTable(input.batch.subject_type);
  const subjectColumn = assignmentSubjectColumn(input.batch.subject_type);
  const workItemSubjectColumn = workItemSubjectColumnFor(input.batch.subject_type);
  const oldAssignment = await database.prepare(`
    SELECT id, staff_id, version
    FROM ${table}
    WHERE id=? AND ${subjectColumn}=? AND duty_code=? AND status='ACTIVE'
  `).bind(
    input.item.old_assignment_id,
    input.item.subject_id,
    input.batch.duty_code,
  ).first<AssignmentRow>();
  if (!oldAssignment
    || oldAssignment.staff_id !== input.batch.source_staff_id) {
    throw new StaffAssignmentError('VERSION_CONFLICT', 409);
  }

  const target = await resolveBatchTarget(database, input.batch, input.marketplaceCode);
  await requireEligibleFixedAssignmentTarget(database, {
    targetStaffId: target.staffId,
    dutyCode: input.batch.duty_code,
  });
  const newAssignmentId = crypto.randomUUID();
  const itemOutbox = await prepareStaffAssignmentOutboxStatements(database, {
    dedupKey: `staff-reassignment-item:${input.item.id}:completed`,
    eventType: 'BATCH_TRANSFER_ITEM_COMPLETED',
    aggregateType: 'STAFF_ASSIGNMENT',
    aggregateId: newAssignmentId,
    payload: {
      batch_id: input.batch.id,
      batch_item_id: input.item.id,
      subject_type: input.batch.subject_type,
      subject_id: input.item.subject_id,
      duty_code: input.batch.duty_code,
      old_assignment_id: oldAssignment.id,
      new_assignment_id: newAssignmentId,
      previous_staff_id: oldAssignment.staff_id,
      assigned_staff_id: target.staffId,
    },
    now: input.now,
  });
  const statements: SqlStatement[] = [
    database.prepare(`
      UPDATE ${table}
      SET status='REVOKED', revoked_at=?, version=version+1,
        updated_at=MAX(?, updated_at+1)
      WHERE id=? AND status='ACTIVE' AND version=?
    `).bind(input.now, input.now, oldAssignment.id, oldAssignment.version),
    database.prepare(`
      INSERT INTO ${table} (
        id, ${subjectColumn}, duty_code, staff_id, status, source,
        assigned_by_actor_type, assigned_by_actor_id, reason,
        version, created_at, updated_at, revoked_at
      ) VALUES (?, ?, ?, ?, 'ACTIVE', 'BATCH_TRANSFER',
        'STAFF', ?, ?, 1, ?, ?, NULL)
    `).bind(
      newAssignmentId,
      input.item.subject_id,
      input.batch.duty_code,
      target.staffId,
      input.actor.staffId,
      input.batch.reason,
      input.now,
      input.now,
    ),
    database.prepare(`
      UPDATE staff_work_items
      SET assigned_staff_id=?, fixed_assignment_id=?,
        version=version+1, updated_at=MAX(?, updated_at+1)
      WHERE status='OPEN' AND duty_code=?
        AND ${workItemSubjectColumn}=?
    `).bind(
      target.staffId,
      newAssignmentId,
      input.now,
      input.batch.duty_code,
      input.item.subject_id,
    ),
  ];
  if (target.candidate) {
    statements.push(...createCursorAdvanceStatements(
      database,
      target.candidate,
      target.staffId,
      input.now,
    ));
  }
  statements.push(
    database.prepare(`
      UPDATE staff_reassignment_batch_items
      SET new_assignment_id=?, status='COMPLETED', error_code=NULL,
        attempt_count=attempt_count+1, processed_at=?,
        updated_at=MAX(?, updated_at+1)
      WHERE id=? AND status IN ('PENDING', 'FAILED')
    `).bind(newAssignmentId, input.now, input.now, input.item.id),
    database.prepare(`
      INSERT INTO staff_assignment_events (
        id, event_type, subject_type, subject_id,
        duty_code, assignment_id, work_item_id, batch_id,
        old_staff_id, new_staff_id, actor_type, actor_id,
        reason, request_id, idempotency_key, metadata_json, created_at
      ) VALUES (?, 'FIXED_OWNER_CHANGED', ?, ?, ?, ?, NULL, ?,
        ?, ?, 'STAFF', ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.batch.subject_type,
      input.item.subject_id,
      input.batch.duty_code,
      newAssignmentId,
      input.batch.id,
      oldAssignment.staff_id,
      target.staffId,
      input.actor.staffId,
      input.batch.reason,
      input.requestId,
      input.idempotencyKey,
      JSON.stringify({ assignment_source: 'BATCH_TRANSFER' }),
      input.now,
    ),
    database.prepare(`
      INSERT INTO staff_assignment_events (
        id, event_type, subject_type, subject_id,
        duty_code, assignment_id, work_item_id, batch_id,
        old_staff_id, new_staff_id, actor_type, actor_id,
        reason, request_id, idempotency_key, metadata_json, created_at
      ) VALUES (?, 'BATCH_TRANSFER_ITEM_COMPLETED', ?, ?, ?, ?, NULL, ?,
        ?, ?, 'STAFF', ?, ?, ?, ?, '{}', ?)
    `).bind(
      crypto.randomUUID(),
      input.batch.subject_type,
      input.item.subject_id,
      input.batch.duty_code,
      newAssignmentId,
      input.batch.id,
      oldAssignment.staff_id,
      target.staffId,
      input.actor.staffId,
      input.batch.reason,
      input.requestId,
      input.idempotencyKey,
      input.now,
    ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'STAFF_ASSIGNMENT',
      aggregateId: newAssignmentId,
      eventType: 'BATCH_TRANSFER_ITEM_COMPLETED',
      actor: {
        type: 'STAFF',
        id: input.actor.staffId,
        roles: [...input.actor.roles],
      },
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      previousState: oldAssignment,
      nextState: {
        subject_type: input.batch.subject_type,
        subject_id: input.item.subject_id,
        assignment_id: newAssignmentId,
        assigned_staff_id: target.staffId,
        source: 'BATCH_TRANSFER',
      },
      reason: input.batch.reason,
      createdAt: input.now,
    }),
    ...itemOutbox,
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN
        EXISTS (
          SELECT 1 FROM ${table}
          WHERE id=? AND status='REVOKED' AND version=?
        )
        AND EXISTS (
          SELECT 1 FROM ${table}
          WHERE id=? AND status='ACTIVE' AND staff_id=? AND source='BATCH_TRANSFER'
        )
        AND EXISTS (
          SELECT 1 FROM staff_reassignment_batch_items
          WHERE id=? AND status='COMPLETED' AND new_assignment_id=?
        )
      THEN 1 ELSE 0 END
    `).bind(
      oldAssignment.id,
      Number(oldAssignment.version) + 1,
      newAssignmentId,
      target.staffId,
      input.item.id,
      newAssignmentId,
    ),
  );
  await database.batch(statements);
}

async function resolveBatchTarget(
  database: SqlDatabase,
  batch: BatchRow,
  marketplaceCode: string,
): Promise<{
  staffId: string;
  candidate: ResolvedRoundRobinCandidate | null;
}> {
  if (batch.target_mode === 'STAFF') {
    if (!batch.target_staff_id) {
      throw new StaffAssignmentError('BATCH_STATE_CONFLICT', 409);
    }
    return { staffId: batch.target_staff_id, candidate: null };
  }
  const candidate = await resolveRoundRobinFixedDutyCandidate(database, {
    dutyCode: batch.duty_code,
    marketplaceCode,
    excludedStaffIds: [batch.source_staff_id],
  });
  if (candidate) {
    return { staffId: candidate.staff.staffId, candidate };
  }
  const fallback = await resolveOwnerFallbackForFixedDuty(database, {
    marketplaceCode,
    dutyCode: batch.duty_code,
  });
  if (fallback.staffId === batch.source_staff_id) {
    throw new StaffAssignmentError('NO_ELIGIBLE_ASSIGNEE', 503);
  }
  return { staffId: fallback.staffId, candidate: null };
}

async function finalizeBatchStatus(
  database: SqlDatabase,
  batch: BatchRow,
  now: number,
  command: BatchCommand,
  idempotencyKey: string,
): Promise<void> {
  const counts = await database.prepare(`
    SELECT
      SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed
    FROM staff_reassignment_batch_items WHERE batch_id=?
  `).bind(batch.id).first<{
    pending: number | null;
    failed: number | null;
    completed: number | null;
  }>();
  const pending = Number(counts?.pending ?? 0);
  const failed = Number(counts?.failed ?? 0);
  const completed = Number(counts?.completed ?? 0);
  if (pending > 0) return;
  const status: 'COMPLETED' | 'PARTIALLY_FAILED' | 'FAILED' = failed === 0
    ? 'COMPLETED'
    : completed > 0
      ? 'PARTIALLY_FAILED'
      : 'FAILED';
  const completedOutbox = await prepareStaffAssignmentOutboxStatements(database, {
    dedupKey: `staff-reassignment-batch:${batch.id}:completed:${status}`,
    eventType: 'BATCH_TRANSFER_COMPLETED',
    aggregateType: 'STAFF_REASSIGNMENT_BATCH',
    aggregateId: batch.id,
    payload: { batch_id: batch.id, status, completed, failed },
    now,
  });
  await database.batch([
    database.prepare(`
      UPDATE staff_reassignment_batches
      SET status=?, completed_at=?, version=version+1,
        updated_at=MAX(?, updated_at+1)
      WHERE id=? AND status='RUNNING'
    `).bind(status, now, now, batch.id),
    database.prepare(`
      INSERT INTO staff_assignment_events (
        id, event_type, subject_type, subject_id,
        duty_code, assignment_id, work_item_id, batch_id,
        old_staff_id, new_staff_id, actor_type, actor_id,
        reason, request_id, idempotency_key, metadata_json, created_at
      ) VALUES (?, 'BATCH_TRANSFER_COMPLETED', 'REASSIGNMENT_BATCH', ?,
        ?, NULL, NULL, ?, ?, ?, 'STAFF', ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      batch.id,
      batch.duty_code,
      batch.id,
      batch.source_staff_id,
      batch.target_staff_id,
      command.actor.staffId,
      batch.reason,
      command.requestId ?? null,
      idempotencyKey,
      JSON.stringify({ status, completed, failed }),
      now,
    ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'STAFF_REASSIGNMENT_BATCH',
      aggregateId: batch.id,
      eventType: 'BATCH_TRANSFER_COMPLETED',
      actor: {
        type: 'STAFF',
        id: command.actor.staffId,
        roles: [...command.actor.roles],
      },
      requestId: command.requestId ?? null,
      idempotencyKey,
      previousState: { status: 'RUNNING' },
      nextState: { status, completed, failed },
      createdAt: now,
    }),
    ...completedOutbox,
  ]);
}

function requireBatchPermission(actor: AssignmentStaffAuthorization): void {
  requirePermission(actor, 'ASSIGNMENT_BATCH_TRANSFER');
}

async function readBatch(
  database: SqlDatabase,
  batchId: string,
): Promise<BatchRow | null> {
  return database.prepare(`
    SELECT id, source_staff_id, target_mode, target_staff_id,
      duty_code, subject_type, status, reason, version,
      created_at, started_at, completed_at
    FROM staff_reassignment_batches WHERE id=?
  `).bind(batchId).first<BatchRow>();
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

function validateTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
}
