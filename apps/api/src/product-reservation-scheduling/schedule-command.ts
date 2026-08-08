import type {
  ConfirmDemandScheduleResult,
  DemandOrderScheduleVersionDto,
  DemandSchedulePreviewDto,
  ReservationStatus,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { PRODUCT_SCHEDULE_TIMEZONE } from '@ygb/contracts';
import {
  beijingDateFromEpochMs,
  hashCanonicalJson,
  plannedOrderDate,
  theoreticalLastOrderDate,
  validateOrderCadence,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import {
  readDemandHeader,
  type DemandHeaderRow,
} from './read-model';
import {
  cleanDateOnly,
  cleanScheduleIdentifier,
  cleanScheduleReason,
  normalizeSchedulingError,
  positiveInteger,
  requireScheduleEdit,
  requireSellerScheduleScope,
  SchedulingError,
  type SchedulingStaffActor,
} from './shared';

interface QueueRow {
  id: string;
  status: ReservationStatus;
  submitted_at: number;
}

interface ScheduleProposal {
  demandBatchId: string;
  expectedVersion: number;
  firstOrderDate: string;
  orderIntervalDays: number;
  ordersPerRun: number;
  reason: string;
}

export async function previewDemandSchedule(
  database: SqlDatabase,
  actor: SchedulingStaffActor,
  input: {
    demandBatchId: string;
    expectedVersion: number;
    firstOrderDate: unknown;
    orderIntervalDays: unknown;
    ordersPerRun: unknown;
    reason: unknown;
  },
): Promise<DemandSchedulePreviewDto> {
  requireScheduleEdit(actor);
  const proposal = normalizeProposal(input);
  const header = await requireEditableDemand(database, actor, proposal);
  const queue = await readEffectiveQueue(database, proposal.demandBatchId);
  return buildPreview(header, queue, proposal);
}

export async function confirmDemandSchedule(
  database: SqlDatabase,
  actor: SchedulingStaffActor,
  input: {
    demandBatchId: string;
    expectedVersion: number;
    firstOrderDate: unknown;
    orderIntervalDays: unknown;
    ordersPerRun: unknown;
    reason: unknown;
    previewHash: unknown;
  },
  command: {
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ConfirmDemandScheduleResult> {
  requireScheduleEdit(actor);
  const proposal = normalizeProposal(input);
  const previewHash = cleanPreviewHash(input.previewHash);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new SchedulingError('VALIDATION_ERROR', 400);
  }
  const requestHash = await hashCanonicalJson({
    action: 'CONFIRM_DEMAND_ORDER_SCHEDULE',
    demand_batch_id: proposal.demandBatchId,
    expected_version: proposal.expectedVersion,
    first_order_date: proposal.firstOrderDate,
    order_interval_days: proposal.orderIntervalDays,
    orders_per_run: proposal.ordersPerRun,
    reason: proposal.reason,
    preview_hash: previewHash,
  });
  const acquired = await acquireIdempotency<ConfirmDemandScheduleResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: actor.staffId,
      action: 'CONFIRM_DEMAND_ORDER_SCHEDULE',
      targetType: 'DEMAND_BATCH',
      targetId: proposal.demandBatchId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const header = await requireEditableDemand(database, actor, proposal);
    const queue = await readEffectiveQueue(database, proposal.demandBatchId);
    const preview = await buildPreview(header, queue, proposal);
    if (preview.preview_hash !== previewHash) {
      throw new SchedulingError('SCHEDULE_PREVIEW_STALE', 409);
    }
    const nextDemandVersion = Number(header.demand_version) + 1;
    const nextScheduleVersion = (header.schedule_version ?? 0) + 1;
    const schedule: DemandOrderScheduleVersionDto = {
      schedule_version_id: crypto.randomUUID(),
      version_no: nextScheduleVersion,
      demand_version: nextDemandVersion,
      first_order_date: preview.first_order_date,
      order_interval_days: preview.order_interval_days,
      orders_per_run: preview.orders_per_run,
      theoretical_last_order_date: preview.theoretical_last_order_date,
      affected_reservation_count: preview.affected_reservation_count,
      preview_hash: preview.preview_hash,
      change_reason: proposal.reason,
      changed_by_staff_id: actor.staffId,
      created_at: now,
    };
    const response: ConfirmDemandScheduleResult = {
      demand_batch_id: proposal.demandBatchId,
      demand_version: nextDemandVersion,
      schedule,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey:
        `demand-order-schedule:${proposal.demandBatchId}:${nextScheduleVersion}`,
      eventType: 'DEMAND_ORDER_SCHEDULE_CHANGED',
      aggregateType: 'DEMAND_BATCH',
      aggregateId: proposal.demandBatchId,
      payload: {
        demand_batch_id: proposal.demandBatchId,
        demand_version: nextDemandVersion,
        schedule_version: nextScheduleVersion,
        first_order_date: schedule.first_order_date,
        order_interval_days: schedule.order_interval_days,
        orders_per_run: schedule.orders_per_run,
        theoretical_last_order_date: schedule.theoretical_last_order_date,
        affected_reservation_count: schedule.affected_reservation_count,
        reason: schedule.change_reason,
      },
      createdAt: now,
    });
    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE demand_batches
        SET version=version+1, updated_at=MAX(?, updated_at+1)
        WHERE id=? AND status='PUBLISHED' AND version=?
      `).bind(now, proposal.demandBatchId, proposal.expectedVersion),
      insertScheduleStatement(database, header, schedule),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'DEMAND_BATCH',
        aggregateId: proposal.demandBatchId,
        eventType: 'DEMAND_ORDER_SCHEDULE_CHANGED',
        actor: { type: 'STAFF', id: actor.staffId, roles: actor.roles },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: header.schedule_version === null ? null : {
          demand_version: header.demand_version,
          schedule_version: header.schedule_version,
          first_order_date: header.first_order_date,
          theoretical_last_order_date: header.theoretical_last_order_date,
          order_interval_days: header.order_interval_days,
          orders_per_run: header.orders_per_run,
        },
        nextState: response,
        metadata: {
          preview_hash: preview.preview_hash,
          affected_reservation_count: preview.affected_reservation_count,
          change_reason: proposal.reason,
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          demand_batch_id: proposal.demandBatchId,
          schedule_version_id: schedule.schedule_version_id,
        },
        now,
      }),
      assertScheduleCommittedStatement(
        database, acquired.claim, response,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeSchedulingError(error);
    await markIdempotencyFailed(
      database, acquired.claim, normalized.code, now,
    );
    throw normalized;
  }
}

async function requireEditableDemand(
  database: SqlDatabase,
  actor: SchedulingStaffActor,
  proposal: ScheduleProposal,
): Promise<DemandHeaderRow> {
  const header = await readDemandHeader(database, proposal.demandBatchId);
  if (!header) throw new SchedulingError('NOT_FOUND', 404);
  requireSellerScheduleScope(actor, header.seller_organization_id);
  if (header.status !== 'PUBLISHED') {
    throw new SchedulingError('VERSION_CONFLICT', 409);
  }
  if (Number(header.demand_version) !== proposal.expectedVersion) {
    throw new SchedulingError('VERSION_CONFLICT', 409);
  }
  return header;
}

async function readEffectiveQueue(
  database: SqlDatabase,
  demandBatchId: string,
): Promise<readonly QueueRow[]> {
  const rows = await database.prepare(`
    SELECT id, status, submitted_at
    FROM product_reservations
    WHERE demand_batch_id=?
      AND status IN ('PENDING_REVIEW','APPROVED')
    ORDER BY submitted_at ASC, id ASC
    LIMIT 100001
  `).bind(demandBatchId).all<QueueRow>();
  if (rows.results.length > 100_000) {
    throw new SchedulingError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return rows.results;
}

async function buildPreview(
  header: DemandHeaderRow,
  queue: readonly QueueRow[],
  proposal: ScheduleProposal,
): Promise<DemandSchedulePreviewDto> {
  const theoreticalLast = theoreticalLastOrderDate({
    firstOrderDate: proposal.firstOrderDate,
    targetQuantity: Number(header.target_quantity),
    orderIntervalDays: proposal.orderIntervalDays,
    ordersPerRun: proposal.ordersPerRun,
  });
  const deadlineDate = beijingDateFromEpochMs(Number(header.order_deadline));
  if (theoreticalLast > deadlineDate) {
    throw new SchedulingError('SCHEDULE_WINDOW_CONFLICT', 409);
  }
  const affected = queue.reduce((count, _row, index) => {
    const rank = index + 1;
    const after = plannedOrderDate({
      firstOrderDate: proposal.firstOrderDate,
      rank,
      orderIntervalDays: proposal.orderIntervalDays,
      ordersPerRun: proposal.ordersPerRun,
    });
    if (header.first_order_date === null
      || header.order_interval_days === null
      || header.orders_per_run === null) return count + 1;
    const before = plannedOrderDate({
      firstOrderDate: header.first_order_date,
      rank,
      orderIntervalDays: Number(header.order_interval_days),
      ordersPerRun: Number(header.orders_per_run),
    });
    return count + (before === after ? 0 : 1);
  }, 0);
  const previewHash = await hashCanonicalJson({
    action: 'PREVIEW_DEMAND_ORDER_SCHEDULE',
    demand_batch_id: proposal.demandBatchId,
    expected_version: proposal.expectedVersion,
    source_product_version_id: header.source_product_version_id,
    target_quantity: Number(header.target_quantity),
    order_deadline: Number(header.order_deadline),
    current_schedule: header.schedule_version === null ? null : {
      version_no: Number(header.schedule_version),
      first_order_date: header.first_order_date,
      order_interval_days: header.order_interval_days,
      orders_per_run: header.orders_per_run,
      theoretical_last_order_date: header.theoretical_last_order_date,
    },
    queue: queue.map((row) => ({
      id: row.id,
      status: row.status,
      submitted_at: Number(row.submitted_at),
    })),
    proposal: {
      first_order_date: proposal.firstOrderDate,
      order_interval_days: proposal.orderIntervalDays,
      orders_per_run: proposal.ordersPerRun,
      reason: proposal.reason,
    },
  });
  return {
    demand_batch_id: proposal.demandBatchId,
    expected_version: proposal.expectedVersion,
    current_schedule_version: header.schedule_version === null
      ? null : Number(header.schedule_version),
    first_order_date: proposal.firstOrderDate,
    theoretical_last_order_date: theoreticalLast,
    order_deadline_date: deadlineDate,
    order_interval_days: proposal.orderIntervalDays,
    orders_per_run: proposal.ordersPerRun,
    effective_reservation_count: queue.length,
    affected_reservation_count: affected,
    before_first_order_date: header.first_order_date,
    before_theoretical_last_order_date:
      header.theoretical_last_order_date,
    preview_hash: previewHash,
    timezone: PRODUCT_SCHEDULE_TIMEZONE,
    data_as_of: Date.now(),
  };
}

function normalizeProposal(input: {
  demandBatchId: string;
  expectedVersion: number;
  firstOrderDate: unknown;
  orderIntervalDays: unknown;
  ordersPerRun: unknown;
  reason: unknown;
}): ScheduleProposal {
  const proposal = {
    demandBatchId: cleanScheduleIdentifier(input.demandBatchId),
    expectedVersion: positiveInteger(input.expectedVersion),
    firstOrderDate: cleanDateOnly(input.firstOrderDate),
    orderIntervalDays: positiveInteger(input.orderIntervalDays, 36_500),
    ordersPerRun: positiveInteger(input.ordersPerRun),
    reason: cleanScheduleReason(input.reason),
  };
  try {
    validateOrderCadence(proposal);
  } catch {
    throw new SchedulingError('VALIDATION_ERROR', 400);
  }
  return proposal;
}

function cleanPreviewHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new SchedulingError('VALIDATION_ERROR', 400);
  }
  return value;
}

function insertScheduleStatement(
  database: SqlDatabase,
  header: DemandHeaderRow,
  schedule: DemandOrderScheduleVersionDto,
): SqlStatement {
  return database.prepare(`
    INSERT INTO demand_order_schedule_versions (
      id, demand_batch_id, version_no, demand_version,
      source_product_version_id, first_order_date,
      order_interval_days, orders_per_run,
      previous_first_order_date, previous_theoretical_last_order_date,
      theoretical_last_order_date, affected_reservation_count,
      preview_hash, change_reason, changed_by_staff_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    schedule.schedule_version_id,
    header.demand_batch_id,
    schedule.version_no,
    schedule.demand_version,
    header.source_product_version_id,
    schedule.first_order_date,
    schedule.order_interval_days,
    schedule.orders_per_run,
    header.first_order_date,
    header.theoretical_last_order_date,
    schedule.theoretical_last_order_date,
    schedule.affected_reservation_count,
    schedule.preview_hash,
    schedule.change_reason,
    schedule.changed_by_staff_id,
    schedule.created_at,
  );
}

function assertScheduleCommittedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: ConfirmDemandScheduleResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1 FROM demand_batches
        WHERE id=? AND status='PUBLISHED' AND version=?
      )
      AND EXISTS (
        SELECT 1 FROM demand_order_schedule_versions
        WHERE id=? AND demand_batch_id=? AND demand_version=?
          AND preview_hash=?
      )
      AND EXISTS (
        SELECT 1 FROM command_idempotency_records
        WHERE actor_type=? AND actor_id=? AND idempotency_key=?
          AND status='COMMITTED' AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    response.demand_batch_id,
    response.demand_version,
    response.schedule.schedule_version_id,
    response.demand_batch_id,
    response.demand_version,
    response.schedule.preview_hash,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
