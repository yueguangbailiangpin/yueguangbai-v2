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
  DEFAULT_EXPIRY_SCAN_BATCH_SIZE,
  MAX_EXPIRY_SCAN_BATCH_SIZE,
  normalizeOrderInstructionError,
  OrderInstructionError,
  requireInstructionPermission,
  validateTimestamp,
  type OrderInstructionStaffActor,
} from './shared';
import { expireOrderInstruction } from './expiry';

export interface OrderInstructionExpiryScanResult {
  marketplace_code: 'JP';
  attempted: number;
  expired: number;
  unchanged: number;
  failed: number;
  next_deadline_at: number | null;
  next_instruction_id: string | null;
  completed: boolean;
  replayed: boolean;
}

export async function runOrderInstructionExpiryScan(
  database: SqlDatabase,
  input: {
    marketplaceCode: 'JP';
    limit?: number;
  },
  command: {
    actor: OrderInstructionStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<OrderInstructionExpiryScanResult> {
  requireInstructionPermission(command.actor, 'ORDER_INSTRUCTION_EXPIRY_RUN');
  const now = validateTimestamp(command.now ?? Date.now());
  const limit = input.limit ?? DEFAULT_EXPIRY_SCAN_BATCH_SIZE;
  if (!Number.isSafeInteger(limit)
    || limit < 1
    || limit > MAX_EXPIRY_SCAN_BATCH_SIZE) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  const requestHash = await hashCanonicalJson({
    action: 'RUN_ORDER_INSTRUCTION_EXPIRY_SCAN',
    marketplace_code: input.marketplaceCode,
    limit,
  });
  const acquired = await acquireIdempotency<OrderInstructionExpiryScanResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'RUN_ORDER_INSTRUCTION_EXPIRY_SCAN',
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
    const cursor = await database.prepare(`
      SELECT deadline_at, instruction_id
      FROM order_instruction_expiry_scan_cursors
      WHERE marketplace_code=?
    `).bind(input.marketplaceCode).first<{
      deadline_at: number;
      instruction_id: string;
    }>();
    const rows = await database.prepare(`
      SELECT
        instruction.id AS instruction_id,
        instruction.version,
        CASE
          WHEN evidence.status='CHANGES_REQUESTED'
            THEN instruction.resubmission_deadline_at
          ELSE instruction.initial_deadline_at
        END AS deadline_at
      FROM order_instructions instruction
      LEFT JOIN order_evidence_submissions evidence
        ON evidence.reservation_id=instruction.reservation_id
      LEFT JOIN formal_orders formal_order
        ON formal_order.reservation_id=instruction.reservation_id
      WHERE instruction.marketplace_code=?
        AND instruction.status='ACTIVE'
        AND formal_order.id IS NULL
        AND (
          (evidence.id IS NULL
            AND instruction.initial_deadline_at IS NOT NULL
            AND instruction.initial_deadline_at<=?)
          OR
          (evidence.status='CHANGES_REQUESTED'
            AND instruction.resubmission_deadline_at IS NOT NULL
            AND instruction.resubmission_deadline_at<=?)
        )
        AND (
          ? IS NULL
          OR CASE
            WHEN evidence.status='CHANGES_REQUESTED'
              THEN instruction.resubmission_deadline_at
            ELSE instruction.initial_deadline_at
          END > ?
          OR (
            CASE
              WHEN evidence.status='CHANGES_REQUESTED'
                THEN instruction.resubmission_deadline_at
              ELSE instruction.initial_deadline_at
            END = ?
            AND instruction.id>?
          )
        )
      ORDER BY deadline_at, instruction.id
      LIMIT ?
    `).bind(
      input.marketplaceCode,
      now,
      now,
      cursor?.deadline_at ?? null,
      cursor?.deadline_at ?? 0,
      cursor?.deadline_at ?? 0,
      cursor?.instruction_id ?? '',
      limit,
    ).all<{
      instruction_id: string;
      version: number;
      deadline_at: number;
    }>();

    let expired = 0;
    let unchanged = 0;
    let failed = 0;
    for (const row of rows.results) {
      try {
        const result = await expireOrderInstruction(database, {
          instructionId: row.instruction_id,
          expectedVersion: Number(row.version),
        }, {
          actorType: 'STAFF',
          actorId: command.actor.staffId,
          idempotencyKey:
            `expiry-scan:${row.instruction_id}:${row.deadline_at}`,
          requestId: command.requestId ?? null,
          now,
        });
        if (result.status === 'EXPIRED') expired += 1;
        else unchanged += 1;
      } catch {
        failed += 1;
      }
    }
    const last = rows.results.at(-1);
    const response: OrderInstructionExpiryScanResult = {
      marketplace_code: input.marketplaceCode,
      attempted: rows.results.length,
      expired,
      unchanged,
      failed,
      next_deadline_at: last?.deadline_at ?? null,
      next_instruction_id: last?.instruction_id ?? null,
      completed: rows.results.length < limit,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `order-instruction-expiry-scan:${acquired.claim.idempotencyKey}`,
      eventType: 'ORDER_INSTRUCTION_EXPIRY_SCAN_COMPLETED',
      aggregateType: 'MARKETPLACE',
      aggregateId: input.marketplaceCode,
      payload: response,
      createdAt: now,
    });
    const statements: SqlStatement[] = [];
    if (last) {
      statements.push(database.prepare(`
        INSERT INTO order_instruction_expiry_scan_cursors (
          marketplace_code, deadline_at, instruction_id,
          scanned_at, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(marketplace_code) DO UPDATE SET
          deadline_at=excluded.deadline_at,
          instruction_id=excluded.instruction_id,
          scanned_at=excluded.scanned_at,
          version=order_instruction_expiry_scan_cursors.version+1,
          updated_at=excluded.updated_at
      `).bind(
        input.marketplaceCode,
        last.deadline_at,
        last.instruction_id,
        now,
        now,
        now,
      ));
    }
    statements.push(
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'MARKETPLACE',
        aggregateId: input.marketplaceCode,
        eventType: 'ORDER_INSTRUCTION_EXPIRY_SCAN_COMPLETED',
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
          next_instruction_id: last?.instruction_id ?? null,
        },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    );
    await database.batch(statements);
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

export async function getOrderInstructionExpiryScanCursor(
  database: SqlDatabase,
  actor: OrderInstructionStaffActor,
  marketplaceCode: 'JP',
): Promise<Record<string, unknown> | null> {
  requireInstructionPermission(actor, 'ORDER_INSTRUCTION_EXPIRY_RUN');
  return database.prepare(`
    SELECT marketplace_code, deadline_at, instruction_id,
           scanned_at, version, created_at, updated_at
    FROM order_instruction_expiry_scan_cursors
    WHERE marketplace_code=?
  `).bind(marketplaceCode).first<Record<string, unknown>>();
}
