import type {
  SellerSettlementBatchDetailDto,
  SellerSettlementBatchDto,
  SellerSettlementBatchMemberDto,
  SellerSettlementBatchStatus,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { fixedInteger, SellerSettlementError } from './shared';

/**
 * Stage 7.5 batch 3: immutable seller settlement batches. Commands are
 * idempotent (key + request hash), version-guarded (expected_version),
 * state-machine-checked (database triggers), audited twice (audit_events +
 * seller_settlement_batch_events) and finish with transaction assertions.
 * Payment progress is always derived from the live payable balances.
 */

const BATCH_PAGE_LIMIT_MAX = 100;
const MEMBER_PAGE = 200;

interface BatchRow {
  id: string;
  seller_organization_id: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  frozen_total_cny_fen: number;
  frozen_payable_count: number;
  frozen_at: number | null;
  cancelled_at: number | null;
  cancel_reason: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  paid_amount_cny_fen: number;
  outstanding_amount_cny_fen: number;
}

interface MemberRow {
  id: string;
  payable_id: string;
  formal_order_id: string;
  amazon_order_number_normalized: string;
  payable_type: 'SELLER_PRINCIPAL' | 'SELLER_SERVICE_FEE';
  frozen_amount_cny_fen: number;
  paid_amount_cny_fen: number;
  outstanding_amount_cny_fen: number;
}

function batchStatus(row: Pick<
  BatchRow,
  'status' | 'frozen_total_cny_fen' | 'paid_amount_cny_fen'
>): SellerSettlementBatchStatus {
  if (row.status === 'DRAFT') return 'DRAFT';
  if (row.status === 'CANCELLED') return 'CANCELLED';
  if (row.paid_amount_cny_fen <= 0) return 'CONFIRMED';
  return row.paid_amount_cny_fen >= row.frozen_total_cny_fen
    ? 'PAID'
    : 'PARTIALLY_PAID';
}

function projectBatch(row: BatchRow): SellerSettlementBatchDto {
  return Object.freeze({
    batch_id: row.id,
    seller_organization_id: row.seller_organization_id,
    status: batchStatus(row),
    frozen_total_cny_fen: fixedInteger(row.frozen_total_cny_fen),
    frozen_payable_count: Number(row.frozen_payable_count),
    paid_amount_cny_fen: fixedInteger(row.paid_amount_cny_fen),
    outstanding_amount_cny_fen: fixedInteger(row.outstanding_amount_cny_fen),
    version: Number(row.version),
    created_at: Number(row.created_at),
    confirmed_at: row.frozen_at === null ? null : Number(row.frozen_at),
    cancelled_at: row.cancelled_at === null ? null : Number(row.cancelled_at),
    cancel_reason: row.cancel_reason,
  });
}

const BATCH_SELECT = `
  SELECT batch.id, batch.seller_organization_id, batch.status,
    batch.frozen_total_cny_fen, batch.frozen_payable_count, batch.frozen_at,
    batch.cancelled_at, batch.cancel_reason, batch.version,
    batch.created_at, batch.updated_at,
    COALESCE((
      SELECT SUM(balance.paid_amount_cny_fen)
      FROM seller_settlement_batch_members member
      JOIN seller_payable_balances balance ON balance.payable_id=member.payable_id
      WHERE member.batch_id=batch.id AND member.active=1
    ),0) AS paid_amount_cny_fen,
    COALESCE((
      SELECT SUM(balance.outstanding_amount_cny_fen)
      FROM seller_settlement_batch_members member
      JOIN seller_payable_balances balance ON balance.payable_id=member.payable_id
      WHERE member.batch_id=batch.id AND member.active=1
    ),0) AS outstanding_amount_cny_fen
  FROM seller_settlement_batches batch
`;

async function readBatch(
  database: SqlDatabase,
  batchId: string,
): Promise<BatchRow> {
  const row = await database
    .prepare(`${BATCH_SELECT} WHERE batch.id=?`)
    .bind(batchId)
    .first<BatchRow>();
  if (!row) throw new SellerSettlementError('NOT_FOUND', 404);
  return row;
}

export async function listBatches(
  database: SqlDatabase,
  sellerOrganizationId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<{ batches: SellerSettlementBatchDto[]; next_cursor: string | null }> {
  const limit = Math.min(options.limit ?? 25, BATCH_PAGE_LIMIT_MAX);
  const clauses = ['batch.seller_organization_id=?'];
  const params: unknown[] = [sellerOrganizationId];
  if (options.cursor !== null && options.cursor !== undefined) {
    clauses.push('(batch.created_at<? OR (batch.created_at=? AND batch.id<?))');
    const decoded = decodeCursor(options.cursor);
    params.push(decoded.createdAt, decoded.createdAt, decoded.id);
  }
  const rows = await database
    .prepare(
      `${BATCH_SELECT} WHERE ${clauses.join(' AND ')}
       ORDER BY batch.created_at DESC, batch.id DESC LIMIT ?`,
    )
    .bind(...params, limit + 1)
    .all<BatchRow>();
  const hasMore = rows.results.length > limit;
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return {
    batches: page.map(projectBatch),
    next_cursor: hasMore && last
      ? encodeCursor(Number(last.created_at), last.id)
      : null,
  };
}

export async function readBatchDetail(
  database: SqlDatabase,
  sellerOrganizationId: string,
  batchId: string,
): Promise<SellerSettlementBatchDetailDto> {
  const batch = await readBatch(database, batchId);
  if (batch.seller_organization_id !== sellerOrganizationId) {
    throw new SellerSettlementError('NOT_FOUND', 404);
  }
  const members = await database
    .prepare(
      `SELECT member.id, member.payable_id, member.formal_order_id,
        member.amazon_order_number_normalized, member.payable_type,
        member.frozen_amount_cny_fen,
        COALESCE(balance.paid_amount_cny_fen,0) AS paid_amount_cny_fen,
        COALESCE(balance.outstanding_amount_cny_fen,
          member.frozen_amount_cny_fen) AS outstanding_amount_cny_fen
      FROM seller_settlement_batch_members member
      JOIN seller_payable_balances balance ON balance.payable_id=member.payable_id
      WHERE member.batch_id=? AND member.active=1
      ORDER BY member.payable_type, member.amazon_order_number_normalized, member.id
      LIMIT ?`,
    )
    .bind(batchId, MEMBER_PAGE)
    .all<MemberRow>();
  return Object.freeze({
    ...projectBatch(batch),
    members: members.results.map((row) => Object.freeze({
      member_id: row.id,
      payable_id: row.payable_id,
      formal_order_id: row.formal_order_id,
      amazon_order_number: row.amazon_order_number_normalized,
      payable_type: row.payable_type,
      frozen_amount_cny_fen: fixedInteger(row.frozen_amount_cny_fen),
      paid_amount_cny_fen: fixedInteger(row.paid_amount_cny_fen),
      outstanding_amount_cny_fen: fixedInteger(row.outstanding_amount_cny_fen),
    })),
    members_next_cursor: null,
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type BatchAction =
  | 'CREATE_SELLER_SETTLEMENT_BATCH'
  | 'ADD_SELLER_SETTLEMENT_BATCH_MEMBERS'
  | 'REMOVE_SELLER_SETTLEMENT_BATCH_MEMBER'
  | 'CONFIRM_SELLER_SETTLEMENT_BATCH'
  | 'CANCEL_SELLER_SETTLEMENT_BATCH';

async function beginIdempotency(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  action: BatchAction,
  targetId: string,
  payload: unknown,
  idempotencyKey: string,
  now: number,
) {
  const requestHash = await hashCanonicalJson({ action, target: targetId, payload });
  try {
    return await acquireIdempotency(database, {
      actorType: 'STAFF',
      actorId: actor.staffId,
      action,
      targetType: 'SELLER_SETTLEMENT_BATCH',
      targetId,
      idempotencyKey,
      requestHash,
    }, { now });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (message.includes('IDEMPOTENCY_CONFLICT')) {
      throw new SellerSettlementError('IDEMPOTENCY_CONFLICT', 409);
    }
    if (message.includes('REQUEST_IN_PROGRESS')) {
      throw new SellerSettlementError('REQUEST_IN_PROGRESS', 409);
    }
    throw error;
  }
}

function batchEventStatement(
  database: SqlDatabase,
  input: {
    batchId: string;
    eventType: 'BATCH_CREATED' | 'MEMBER_ADDED' | 'MEMBER_REMOVED'
      | 'BATCH_CONFIRMED' | 'BATCH_CANCELLED' | 'BATCH_EXPORTED';
    actorStaffId: string;
    detail: unknown;
    now: number;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO seller_settlement_batch_events(
        id,batch_id,event_type,actor_staff_id,detail_json,created_at)
      VALUES(?,?,?,?,?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.batchId,
      input.eventType,
      input.actorStaffId,
      JSON.stringify(input.detail),
      input.now,
    );
}

function auditStatement(
  database: SqlDatabase,
  input: {
    batchId: string;
    eventType: string;
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId: string | null;
    previousState: unknown;
    nextState: unknown;
    now: number;
  },
): SqlStatement {
  return createAuditEventStatement(database, {
    id: crypto.randomUUID(),
    aggregateType: 'SELLER_SETTLEMENT_BATCH',
    aggregateId: input.batchId,
    eventType: input.eventType,
    actor: { type: 'STAFF', id: input.actor.staffId, roles: [...input.actor.roles] },
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    previousState: input.previousState,
    nextState: input.nextState,
    createdAt: input.now,
  });
}

export async function createBatch(
  database: SqlDatabase,
  input: { sellerOrganizationId: string; reason: string | null },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{ batch: SellerSettlementBatchDto; replayed: boolean; batchId: string }> {
  const now = command.now ?? Date.now();
  const reason = input.reason === null ? null : cleanReason(input.reason);
  const acquired = await beginIdempotency(
    database,
    command.actor,
    'CREATE_SELLER_SETTLEMENT_BATCH',
    input.sellerOrganizationId,
    { organization: input.sellerOrganizationId, reason },
    command.idempotencyKey,
    now,
  );
  if (acquired.kind === 'REPLAY') {
    const replayed = acquired.response as {
      batch: SellerSettlementBatchDto;
      replayed: boolean;
      batchId: string;
    };
    return { ...replayed, replayed: true };
  }
  try {
    const batchId = crypto.randomUUID();
    const batch: SellerSettlementBatchDto = Object.freeze({
      batch_id: batchId,
      seller_organization_id: input.sellerOrganizationId,
      status: 'DRAFT',
      frozen_total_cny_fen: '0',
      frozen_payable_count: 0,
      paid_amount_cny_fen: '0',
      outstanding_amount_cny_fen: '0',
      version: 1,
      created_at: now,
      confirmed_at: null,
      cancelled_at: null,
      cancel_reason: null,
    });
    const response = { batch, replayed: false, batchId };
    await database.batch([
      database
        .prepare(
          `INSERT INTO seller_settlement_batches(
            id,seller_organization_id,status,frozen_total_cny_fen,
            frozen_payable_count,version,created_by_staff_id,created_at,updated_at)
          VALUES(?,?,'DRAFT',0,0,1,?,?,?)`,
        )
        .bind(batchId, input.sellerOrganizationId, command.actor.staffId, now, now),
      batchEventStatement(database, {
        batchId,
        eventType: 'BATCH_CREATED',
        actorStaffId: command.actor.staffId,
        detail: { reason },
        now,
      }),
      auditStatement(database, {
        batchId,
        eventType: 'SELLER_SETTLEMENT_BATCH_CREATED',
        actor: command.actor,
        idempotencyKey: command.idempotencyKey,
        requestId: command.requestId ?? null,
        previousState: null,
        nextState: { status: 'DRAFT', reason },
        now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { batch_id: batchId },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    await markFailed(database, acquired.claim, error, now);
    throw error;
  }
}

export async function addMembers(
  database: SqlDatabase,
  input: { batchId: string; payableIds: string[]; expectedVersion: number; reason: string },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{ batch: SellerSettlementBatchDto; replayed: boolean }> {
  const now = command.now ?? Date.now();
  const reason = cleanReason(input.reason);
  if (
    !Array.isArray(input.payableIds)
    || input.payableIds.length < 1
    || input.payableIds.length > 100
    || input.payableIds.some((id) => typeof id !== 'string' || id.length < 1)
  ) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const acquired = await beginIdempotency(
    database,
    command.actor,
    'ADD_SELLER_SETTLEMENT_BATCH_MEMBERS',
    input.batchId,
    { payable_ids: input.payableIds, expected_version: input.expectedVersion, reason },
    command.idempotencyKey,
    now,
  );
  if (acquired.kind === 'REPLAY') {
    const replayed = acquired.response as {
      batch: SellerSettlementBatchDto;
      replayed: boolean;
    };
    return { ...replayed, replayed: true };
  }
  try {
    const batch = await readBatch(database, input.batchId);
    if (batch.status !== 'DRAFT') {
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    if (Number(batch.version) !== input.expectedVersion) {
      throw new SellerSettlementError('VERSION_CONFLICT', 409);
    }
    const statements: SqlStatement[] = [];
    for (const payableId of input.payableIds) {
      const payable = await database
        .prepare(
          `SELECT payable.id AS payable_id,
            payable.seller_organization_id,
            payable.formal_order_id,
            payable.payable_type,
            payable.financial_snapshot_id,
            payable.amount_cny_fen,
            formal_order.amazon_order_number_normalized
          FROM seller_payables payable
          JOIN formal_orders formal_order ON formal_order.id=payable.formal_order_id
          WHERE payable.id=?`,
        )
        .bind(payableId)
        .first<{
          payable_id: string;
          seller_organization_id: string;
          formal_order_id: string;
          payable_type: 'SELLER_PRINCIPAL' | 'SELLER_SERVICE_FEE';
          financial_snapshot_id: string;
          amount_cny_fen: number;
          amazon_order_number_normalized: string;
        }>();
      if (
        !payable
        || payable.seller_organization_id !== batch.seller_organization_id
      ) {
        throw new SellerSettlementError('NOT_FOUND', 404);
      }
      statements.push(
        database
          .prepare(
            `INSERT INTO seller_settlement_batch_members(
              id,batch_id,payable_id,seller_organization_id,formal_order_id,
              amazon_order_number_normalized,payable_type,financial_snapshot_id,
              frozen_amount_cny_fen,active,added_by_staff_id,added_at)
            VALUES(?,?,?,?,?,?,?,?,?,1,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            input.batchId,
            payable.payable_id,
            batch.seller_organization_id,
            payable.formal_order_id,
            payable.amazon_order_number_normalized,
            payable.payable_type,
            payable.financial_snapshot_id,
            payable.amount_cny_fen,
            command.actor.staffId,
            now,
          ),
        batchEventStatement(database, {
          batchId: input.batchId,
          eventType: 'MEMBER_ADDED',
          actorStaffId: command.actor.staffId,
          detail: { payable_id: payable.payable_id, reason },
          now,
        }),
      );
    }
    statements.push(
      auditStatement(database, {
        batchId: input.batchId,
        eventType: 'SELLER_SETTLEMENT_BATCH_MEMBERS_ADDED',
        actor: command.actor,
        idempotencyKey: command.idempotencyKey,
        requestId: command.requestId ?? null,
        previousState: { version: Number(batch.version) },
        nextState: { added: input.payableIds.length, reason },
        now,
      }),
    );
    const response = { batch: null, replayed: false } as unknown as {
      batch: SellerSettlementBatchDto;
      replayed: boolean;
    };
    const projected = await (async () => {
      await database.batch([
        ...statements,
        completeIdempotencyStatement(database, acquired.claim, { batch: null, replayed: false }, {
          resultReferences: { batch_id: input.batchId },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      void response;
      return await readBatch(database, input.batchId);
    })();
    const finalResponse = { batch: projectBatch(projected), replayed: false };
    return finalResponse;
  } catch (error) {
    await markFailed(database, acquired.claim, error, now);
    throw error;
  }
}

export async function removeMember(
  database: SqlDatabase,
  input: { batchId: string; payableId: string; expectedVersion: number; reason: string },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{ batch: SellerSettlementBatchDto; replayed: boolean }> {
  const now = command.now ?? Date.now();
  const reason = cleanReason(input.reason);
  const acquired = await beginIdempotency(
    database,
    command.actor,
    'REMOVE_SELLER_SETTLEMENT_BATCH_MEMBER',
    `${input.batchId}:${input.payableId}`,
    { expected_version: input.expectedVersion, reason },
    command.idempotencyKey,
    now,
  );
  if (acquired.kind === 'REPLAY') {
    const replayed = acquired.response as {
      batch: SellerSettlementBatchDto;
      replayed: boolean;
    };
    return { ...replayed, replayed: true };
  }
  try {
    const batch = await readBatch(database, input.batchId);
    if (batch.status !== 'DRAFT') {
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    if (Number(batch.version) !== input.expectedVersion) {
      throw new SellerSettlementError('VERSION_CONFLICT', 409);
    }
    await database.batch([
      database
        .prepare(
          `UPDATE seller_settlement_batch_members
          SET active=0, removed_at=?, removal_reason=?
          WHERE batch_id=? AND payable_id=? AND active=1`,
        )
        .bind(now, reason, input.batchId, input.payableId),
      batchEventStatement(database, {
        batchId: input.batchId,
        eventType: 'MEMBER_REMOVED',
        actorStaffId: command.actor.staffId,
        detail: { payable_id: input.payableId, reason },
        now,
      }),
      auditStatement(database, {
        batchId: input.batchId,
        eventType: 'SELLER_SETTLEMENT_BATCH_MEMBER_REMOVED',
        actor: command.actor,
        idempotencyKey: command.idempotencyKey,
        requestId: command.requestId ?? null,
        previousState: { version: Number(batch.version) },
        nextState: { removed: input.payableId, reason },
        now,
      }),
      completeIdempotencyStatement(database, acquired.claim, { batch: null, replayed: false }, {
        resultReferences: { batch_id: input.batchId },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    const projected = await readBatch(database, input.batchId);
    return { batch: projectBatch(projected), replayed: false };
  } catch (error) {
    await markFailed(database, acquired.claim, error, now);
    throw error;
  }
}

export async function confirmBatch(
  database: SqlDatabase,
  input: { batchId: string; expectedVersion: number; reason: string },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{ batch: SellerSettlementBatchDto; replayed: boolean }> {
  const now = command.now ?? Date.now();
  const reason = cleanReason(input.reason);
  const acquired = await beginIdempotency(
    database,
    command.actor,
    'CONFIRM_SELLER_SETTLEMENT_BATCH',
    input.batchId,
    { expected_version: input.expectedVersion, reason },
    command.idempotencyKey,
    now,
  );
  if (acquired.kind === 'REPLAY') {
    const replayed = acquired.response as {
      batch: SellerSettlementBatchDto;
      replayed: boolean;
    };
    return { ...replayed, replayed: true };
  }
  try {
    const batch = await readBatch(database, input.batchId);
    if (batch.status !== 'DRAFT') {
      // Confirming an already-confirmed batch with identical totals is a
      // semantic replay; anything else is a state conflict.
      if (batch.status === 'CONFIRMED') {
        const response = { batch: projectBatch(batch), replayed: true };
        await database.batch([
          completeIdempotencyStatement(database, acquired.claim, response, {
            resultReferences: { batch_id: input.batchId },
            now,
          }),
          assertIdempotencyCompletionStatement(database, acquired.claim),
        ]);
        return response;
      }
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    if (Number(batch.version) !== input.expectedVersion) {
      throw new SellerSettlementError('VERSION_CONFLICT', 409);
    }
    if (Number(batch.frozen_payable_count ?? 0) >= 0) {
      const members = await database
        .prepare(
          `SELECT COUNT(*) AS c, COALESCE(SUM(frozen_amount_cny_fen),0) AS total
          FROM seller_settlement_batch_members WHERE batch_id=? AND active=1`,
        )
        .bind(input.batchId)
        .first<{ c: number; total: number }>();
      if (!members || members.c < 1) {
        throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
      }
      await database.batch([
        database
          .prepare(
            `UPDATE seller_settlement_batches
            SET status='CONFIRMED', frozen_total_cny_fen=?, frozen_payable_count=?,
              frozen_at=?, version=version+1, updated_at=?
            WHERE id=? AND version=? AND status='DRAFT'`,
          )
          .bind(
            members.total,
            members.c,
            now,
            now,
            input.batchId,
            input.expectedVersion,
          ),
        database
          .prepare(
            `INSERT INTO transaction_assertions(assertion_value)
            SELECT CASE WHEN
              (SELECT status FROM seller_settlement_batches WHERE id=?)='CONFIRMED'
              AND (SELECT frozen_total_cny_fen FROM seller_settlement_batches WHERE id=?)=
                (SELECT COALESCE(SUM(frozen_amount_cny_fen),0)
                 FROM seller_settlement_batch_members WHERE batch_id=? AND active=1)
            THEN 1 ELSE 0 END`,
          )
          .bind(input.batchId, input.batchId, input.batchId),
        batchEventStatement(database, {
          batchId: input.batchId,
          eventType: 'BATCH_CONFIRMED',
          actorStaffId: command.actor.staffId,
          detail: {
            frozen_total_cny_fen: members.total,
            frozen_payable_count: members.c,
            reason,
          },
          now,
        }),
        auditStatement(database, {
          batchId: input.batchId,
          eventType: 'SELLER_SETTLEMENT_BATCH_CONFIRMED',
          actor: command.actor,
          idempotencyKey: command.idempotencyKey,
          requestId: command.requestId ?? null,
          previousState: { status: 'DRAFT', version: Number(batch.version) },
          nextState: {
            status: 'CONFIRMED',
            version: Number(batch.version) + 1,
            frozen_total_cny_fen: members.total,
            frozen_payable_count: members.c,
            reason,
          },
          now,
        }),
        completeIdempotencyStatement(database, acquired.claim, { batch: null, replayed: false }, {
          resultReferences: { batch_id: input.batchId },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
    }
    const projected = await readBatch(database, input.batchId);
    return { batch: projectBatch(projected), replayed: false };
  } catch (error) {
    await markFailed(database, acquired.claim, error, now);
    throw error;
  }
}

export async function cancelBatch(
  database: SqlDatabase,
  input: { batchId: string; expectedVersion: number; reason: string },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{ batch: SellerSettlementBatchDto; replayed: boolean }> {
  const now = command.now ?? Date.now();
  const reason = cleanReason(input.reason);
  const acquired = await beginIdempotency(
    database,
    command.actor,
    'CANCEL_SELLER_SETTLEMENT_BATCH',
    input.batchId,
    { expected_version: input.expectedVersion, reason },
    command.idempotencyKey,
    now,
  );
  if (acquired.kind === 'REPLAY') {
    const replayed = acquired.response as {
      batch: SellerSettlementBatchDto;
      replayed: boolean;
    };
    return { ...replayed, replayed: true };
  }
  try {
    const batch = await readBatch(database, input.batchId);
    if (batch.status !== 'DRAFT' && batch.status !== 'CONFIRMED') {
      if (batch.status === 'CANCELLED') {
        const response = { batch: projectBatch(batch), replayed: true };
        await database.batch([
          completeIdempotencyStatement(database, acquired.claim, response, {
            resultReferences: { batch_id: input.batchId },
            now,
          }),
          assertIdempotencyCompletionStatement(database, acquired.claim),
        ]);
        return response;
      }
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    if (Number(batch.version) !== input.expectedVersion) {
      throw new SellerSettlementError('VERSION_CONFLICT', 409);
    }
    await database.batch([
      database
        .prepare(
          `UPDATE seller_settlement_batches
          SET status='CANCELLED', cancelled_at=?, cancel_reason=?,
            version=version+1, updated_at=?
          WHERE id=? AND version=? AND status IN ('DRAFT','CONFIRMED')`,
        )
        .bind(now, reason, now, input.batchId, input.expectedVersion),
      database
        .prepare(
          `INSERT INTO transaction_assertions(assertion_value)
          SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM seller_settlement_batch_members
            WHERE batch_id=? AND active=1
          ) THEN 1 ELSE 0 END`,
        )
        .bind(input.batchId),
      batchEventStatement(database, {
        batchId: input.batchId,
        eventType: 'BATCH_CANCELLED',
        actorStaffId: command.actor.staffId,
        detail: { reason },
        now,
      }),
      auditStatement(database, {
        batchId: input.batchId,
        eventType: 'SELLER_SETTLEMENT_BATCH_CANCELLED',
        actor: command.actor,
        idempotencyKey: command.idempotencyKey,
        requestId: command.requestId ?? null,
        previousState: { status: batch.status, version: Number(batch.version) },
        nextState: { status: 'CANCELLED', reason },
        now,
      }),
      completeIdempotencyStatement(database, acquired.claim, { batch: null, replayed: false }, {
        resultReferences: { batch_id: input.batchId },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    const projected = await readBatch(database, input.batchId);
    return { batch: projectBatch(projected), replayed: false };
  } catch (error) {
    await markFailed(database, acquired.claim, error, now);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const EXPORT_ROW_LIMIT = 5_000;
export const EXPORT_BYTE_LIMIT = 2 * 1024 * 1024;

/** Neutralize CSV formula injection: prefix risky leading characters. */
export function csvCell(value: string): string {
  return /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
}

export function exportFilename(batchId: string): string {
  return `seller-settlement-batch-${batchId}.csv`;
}

export function exportHeader(): string {
  return 'amazon_order_number,payable_type,frozen_amount_cny_fen,'
    + 'paid_amount_cny_fen,outstanding_amount_cny_fen,confirmed_at,due_at\n';
}

export function exportRow(
  member: SellerSettlementBatchMemberDto,
  confirmedAtIso: string,
  dueAtIso: string,
): string {
  return [
    csvCell(member.amazon_order_number),
    member.payable_type,
    member.frozen_amount_cny_fen,
    member.paid_amount_cny_fen,
    member.outstanding_amount_cny_fen,
    confirmedAtIso,
    dueAtIso,
  ].join(',') + '\n';
}

export async function readExportRows(
  database: SqlDatabase,
  batchId: string,
): Promise<
  { members: SellerSettlementBatchMemberDto[]; batch: BatchRow; dues: Map<string, number> }
> {
  const batch = await readBatch(database, batchId);
  if (batch.status === 'DRAFT') {
    throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
  }
  const detail = await readBatchDetail(database, batch.seller_organization_id, batchId);
  const dueRows = await database
    .prepare(
      `SELECT member.payable_id, payable.due_at
      FROM seller_settlement_batch_members member
      JOIN seller_payables payable ON payable.id=member.payable_id
      WHERE member.batch_id=? AND member.active=1`,
    )
    .bind(batchId)
    .all<{ payable_id: string; due_at: number }>();
  const dues = new Map(dueRows.results.map((row) => [row.payable_id, Number(row.due_at)]));
  return { members: [...detail.members], batch, dues };
}

async function markFailed(
  database: SqlDatabase,
  claim: Parameters<typeof markIdempotencyFailed>[1],
  error: unknown,
  now: number,
): Promise<void> {
  const message = String((error as Error)?.message ?? error);
  if (message.includes('settlement_') || message.includes('UNIQUE constraint failed')) {
    await markIdempotencyFailed(database, claim, 'SELLER_SETTLEMENT_CONFLICT', now);
    if (message.includes('uq_active_batch_payable') || message.includes('settlement_member_ineligible')) {
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    if (message.includes('settlement_batch_invalid_transition')) {
      throw new SellerSettlementError('VERSION_CONFLICT', 409);
    }
    throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
  }
  await markIdempotencyFailed(database, claim, 'DEPENDENCY_UNAVAILABLE', now);
  throw error;
}

function cleanReason(value: unknown): string {
  if (typeof value !== 'string') throw new SellerSettlementError('VALIDATION_ERROR', 400);
  const normalized = value.normalize('NFKC').trim();
  if (
    normalized.length < 1
    || normalized.length > 2000
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

function encodeCursor(createdAt: number, id: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ at: createdAt, id }));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeCursor(raw: string): { createdAt: number; id: string } {
  try {
    const base64 = raw.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(raw.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      at?: unknown;
      id?: unknown;
    };
    if (
      !Number.isSafeInteger(parsed.at)
      || typeof parsed.id !== 'string'
      || parsed.id.length < 1
    ) {
      throw new Error('bad');
    }
    return { createdAt: Number(parsed.at), id: parsed.id };
  } catch {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
}
