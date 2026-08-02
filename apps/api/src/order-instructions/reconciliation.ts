import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
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
  batchWithAssignmentRetry,
  prepareDirectWorkItem,
} from '../staff-assignment';
import { cancelOrderInstruction } from './cancel';
import {
  insertInstructionEventStatement,
  normalizeOrderInstructionError,
  OrderInstructionError,
  requireInstructionPermission,
  SIX_HOURS_MS,
  validateTimestamp,
  type OrderInstructionStaffActor,
} from './shared';
import { createInstructionForApprovedReservationStatement } from './workflow-integration';

export interface OrderInstructionReconciliationResult {
  processed: number;
  created_unpublished: number;
  historical_evidence_context: number;
  skipped_formal_orders: number;
  cancelled_insufficient_window: number;
  failures: number;
  next_reservation_id: string | null;
  replayed: boolean;
}

export async function reconcileApprovedReservations(
  database: SqlDatabase,
  input: {
    marketplaceCode: 'JP';
    afterReservationId?: string | null;
    limit?: number;
  },
  command: {
    actor: OrderInstructionStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<OrderInstructionReconciliationResult> {
  requireInstructionPermission(command.actor, 'ORDER_INSTRUCTION_MANAGE');
  const now = validateTimestamp(command.now ?? Date.now());
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  const requestHash = await hashCanonicalJson({
    action: 'RECONCILE_APPROVED_RESERVATIONS_FOR_ORDER_INSTRUCTIONS',
    marketplace_code: input.marketplaceCode,
    after_reservation_id: input.afterReservationId ?? null,
    limit,
  });
  const acquired = await acquireIdempotency<OrderInstructionReconciliationResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'RECONCILE_APPROVED_RESERVATIONS_FOR_ORDER_INSTRUCTIONS',
      targetType: 'MARKETPLACE',
      targetId: input.marketplaceCode,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const rows = await database.prepare(`
      SELECT
        reservation.id AS reservation_id,
        reservation.buyer_customer_id,
        reservation.marketplace_code,
        reservation.demand_batch_id,
        reservation.version AS reservation_version,
        demand.organization_id,
        demand.store_id,
        demand.order_deadline,
        evidence.id AS evidence_submission_id,
        evidence.current_version_no AS evidence_current_version_no,
        formal_order.id AS formal_order_id,
        instruction.id AS existing_instruction_id,
        instruction.status AS existing_instruction_status
      FROM product_reservations reservation
      JOIN demand_batches demand ON demand.id=reservation.demand_batch_id
      LEFT JOIN order_evidence_submissions evidence
        ON evidence.reservation_id=reservation.id
      LEFT JOIN formal_orders formal_order
        ON formal_order.reservation_id=reservation.id
      LEFT JOIN order_instructions instruction
        ON instruction.reservation_id=reservation.id
      LEFT JOIN order_instruction_reconciliation_markers marker
        ON marker.reservation_id=reservation.id
      WHERE reservation.marketplace_code=?
        AND reservation.status='APPROVED'
        AND reservation.id>?
        AND marker.reservation_id IS NULL
        AND (instruction.id IS NULL OR instruction.status IN ('UNPUBLISHED','CANCELLED'))
      ORDER BY reservation.id
      LIMIT ?
    `).bind(
      input.marketplaceCode,
      input.afterReservationId ?? '',
      limit,
    ).all<{
      reservation_id: string;
      buyer_customer_id: string;
      marketplace_code: 'JP';
      demand_batch_id: string;
      reservation_version: number;
      organization_id: string;
      store_id: string;
      order_deadline: number;
      evidence_submission_id: string | null;
      evidence_current_version_no: number | null;
      formal_order_id: string | null;
      existing_instruction_id: string | null;
      existing_instruction_status: string | null;
    }>();

    let created = 0;
    let historical = 0;
    let skipped = 0;
    let cancelled = 0;
    let failures = 0;
    for (const row of rows.results) {
      try {
        if (row.formal_order_id !== null) {
          await insertReconciliationMarker(database, {
            reservationId: row.reservation_id,
            instructionId: null,
            disposition: 'FORMAL_ORDER_EXISTS_SKIPPED',
            metadata: { formal_order_id: row.formal_order_id },
            now,
          });
          skipped += 1;
          continue;
        }
        if (row.evidence_submission_id !== null) {
          const instructionId = row.existing_instruction_id ?? crypto.randomUUID();
          if (row.existing_instruction_id === null) {
            await database.batch([
            database.prepare(`
              INSERT INTO order_instructions (
                id, reservation_id, buyer_customer_id, marketplace_code,
                status, current_version_no, version, published_at,
                initial_deadline_at, resubmission_deadline_at,
                expired_at, cancelled_at, completed_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, 'CANCELLED', 0, 1,
                NULL, NULL, NULL, NULL, ?, NULL, ?, ?)
            `).bind(
              instructionId,
              row.reservation_id,
              row.buyer_customer_id,
              row.marketplace_code,
              now,
              now,
              now,
            ),
            insertInstructionEventStatement(database, {
              instructionId,
              reservationId: row.reservation_id,
              eventType: 'INSTRUCTION_RECONCILED',
              actorType: 'STAFF',
              actorId: command.actor.staffId,
              previousStatus: null,
              nextStatus: 'CANCELLED',
              instructionVersion: 1,
              reason: 'HISTORICAL_EVIDENCE_CONTEXT',
              metadata: {
                evidence_submission_id: row.evidence_submission_id,
                evidence_version_no: row.evidence_current_version_no,
                buyer_assets_exposed: false,
              },
              idempotencyKey:
                `reconcile-evidence:${row.reservation_id}`,
              createdAt: now,
            }),
            markerStatement(database, {
              reservationId: row.reservation_id,
              instructionId,
              disposition: 'HISTORICAL_EVIDENCE_CONTEXT',
              metadata: {
                evidence_submission_id: row.evidence_submission_id,
                evidence_version_no: row.evidence_current_version_no,
                buyer_assets_exposed: false,
              },
              now,
            }),
          ]);
          } else {
            await insertReconciliationMarker(database, {
              reservationId: row.reservation_id,
              instructionId,
              disposition: 'HISTORICAL_EVIDENCE_CONTEXT',
              metadata: {
                evidence_submission_id: row.evidence_submission_id,
                evidence_version_no: row.evidence_current_version_no,
                buyer_assets_exposed: false,
              },
              now,
            });
          }
          historical += 1;
          continue;
        }

        const instructionId = row.existing_instruction_id ?? crypto.randomUUID();
        if (row.order_deadline - now < SIX_HOURS_MS) {
          if (row.existing_instruction_id === null) {
            await database.batch([
            createInstructionForApprovedReservationStatement(database, {
              instructionId,
              reservationId: row.reservation_id,
              buyerCustomerId: row.buyer_customer_id,
              marketplaceCode: row.marketplace_code,
              now,
            }),
          ]);
          }
          if (row.existing_instruction_status !== 'CANCELLED') {
          await cancelOrderInstruction(database, {
            instructionId,
            expectedVersion: 1,
            reason: 'INSUFFICIENT_PUBLISH_WINDOW',
          }, {
            actor: command.actor,
            idempotencyKey:
              `reconcile-cancel:${row.reservation_id}:insufficient-window`,
            requestId: command.requestId ?? null,
            now,
          });
          }
          await insertReconciliationMarker(database, {
            reservationId: row.reservation_id,
            instructionId,
            disposition: 'INSUFFICIENT_PUBLISH_WINDOW',
            metadata: {
              reason: 'INSUFFICIENT_PUBLISH_WINDOW',
              released_capacity: true,
            },
            now,
          });
          cancelled += 1;
          continue;
        }

        const statements: SqlStatement[] = [];
        if (row.existing_instruction_id === null) {
          statements.push(createInstructionForApprovedReservationStatement(database, {
            instructionId,
            reservationId: row.reservation_id,
            buyerCustomerId: row.buyer_customer_id,
            marketplaceCode: row.marketplace_code,
            now,
          }));
        }
        statements.push(
          insertInstructionEventStatement(database, {
            instructionId,
            reservationId: row.reservation_id,
            eventType: 'INSTRUCTION_RECONCILED',
            actorType: 'STAFF',
            actorId: command.actor.staffId,
            previousStatus: null,
            nextStatus: 'UNPUBLISHED',
            instructionVersion: 1,
            reason: 'HISTORICAL_APPROVED_RESERVATION',
            metadata: { publish_window_available: true },
            idempotencyKey: `reconcile-create:${row.reservation_id}`,
            createdAt: now,
          }),
          markerStatement(database, {
            reservationId: row.reservation_id,
            instructionId,
            disposition: 'UNPUBLISHED_CREATED',
            metadata: {},
            now,
          }),
        );
        await batchWithAssignmentRetry(
          database,
          () => prepareDirectWorkItem(database, {
            workType: 'ORDER_INSTRUCTION_PUBLISH',
            sourceEntityType: 'ORDER_INSTRUCTION',
            sourceEntityId: instructionId,
            marketplaceCode: row.marketplace_code,
            buyerCustomerId: row.buyer_customer_id,
            actorType: 'SYSTEM',
            actorId: command.actor.staffId,
            requestId: command.requestId ?? null,
            idempotencyKey: `reconcile:${row.reservation_id}`,
            reason: 'historical approved reservation reconciliation',
            now,
          }),
          statements,
        );
        created += 1;
      } catch {
        failures += 1;
      }
    }

    const response: OrderInstructionReconciliationResult = {
      processed: rows.results.length,
      created_unpublished: created,
      historical_evidence_context: historical,
      skipped_formal_orders: skipped,
      cancelled_insufficient_window: cancelled,
      failures,
      next_reservation_id: rows.results.at(-1)?.reservation_id ?? null,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `order-instruction-reconciliation:${acquired.claim.idempotencyKey}`,
      eventType: 'ORDER_INSTRUCTION_RECONCILIATION_COMPLETED',
      aggregateType: 'MARKETPLACE',
      aggregateId: input.marketplaceCode,
      payload: response,
      createdAt: now,
    });
    await database.batch([
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'MARKETPLACE',
        aggregateId: input.marketplaceCode,
        eventType: 'ORDER_INSTRUCTION_RECONCILIATION_COMPLETED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: response,
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          marketplace_code: input.marketplaceCode,
          next_reservation_id: response.next_reservation_id,
        },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizeOrderInstructionError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

type ReconciliationDisposition =
  | 'FORMAL_ORDER_EXISTS_SKIPPED'
  | 'HISTORICAL_EVIDENCE_CONTEXT'
  | 'UNPUBLISHED_CREATED'
  | 'INSUFFICIENT_PUBLISH_WINDOW';

function markerStatement(
  database: SqlDatabase,
  input: {
    reservationId: string;
    instructionId: string | null;
    disposition: ReconciliationDisposition;
    metadata: unknown;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO order_instruction_reconciliation_markers (
      id, reservation_id, instruction_id, disposition,
      metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.reservationId,
    input.instructionId,
    input.disposition,
    JSON.stringify(input.metadata),
    input.now,
  );
}

async function insertReconciliationMarker(
  database: SqlDatabase,
  input: {
    reservationId: string;
    instructionId: string | null;
    disposition: ReconciliationDisposition;
    metadata: unknown;
    now: number;
  },
): Promise<void> {
  await database.batch([markerStatement(database, input)]);
}
