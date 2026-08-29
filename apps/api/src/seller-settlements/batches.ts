import type {
  SellerPortalSettlementBatchDetailDto,
  SellerPortalSettlementBatchDto,
  SellerSettlementBatchDetailDto,
  SellerSettlementBatchDto,
  SellerSettlementBatchMemberDto,
  SellerSettlementBatchStatus,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { hashCanonicalJson, IncrementalSha256 } from '@ygb/domain';
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
 * Stage 7.5 batch 3 + 7.5R/7.5R-2: immutable seller settlement batches.
 * Commands are idempotent (key + request hash), version-guarded
 * (expected_version), state-machine-checked (database triggers), audited
 * twice (audit_events + seller_settlement_batch_events) and finish with
 * transaction assertions.
 *
 * 7.5R truthfulness: member reads are keyset-paginated end to end (no silent
 * MEMBER_PAGE truncation, no OFFSET), seller-portal routes project a
 * dedicated seller-safe DTO, and an oversized batch answers 409
 * EXPORT_TOO_LARGE instead of a truncated file. Export is idempotent: the
 * first request streams the file and records a receipt; replays with the
 * same key return that receipt JSON, never a second side effect.
 *
 * 7.5R-2 truthfulness: the export is a true two-pass stream. Pass 1
 * (preflight) walks the same keyset pages the response will send, encodes
 * each page, enforces the row/byte ceilings and folds the exact bytes into
 * an incremental SHA-256 — nothing but the current page is ever held in
 * memory, and no full-buffer merge exists. Pass 2 lazily re-walks the same
 * pages inside a pull()-backpressured ReadableStream, one page per pull.
 *
 * 7.5R-3/7.5R-4 truthfulness (concurrent consistency of the two passes):
 * both passes run the identical member condition, order and cursor against
 * the CONFIRMATION-TIME frozen member snapshot (`added_at <=
 * batch.frozen_at`, not already removed at or before it, or released by a
 * trigger-enforced `BATCH_CANCELLED` removal — which keeps members whose
 * removed_at EQUALS frozen_at when confirm and cancel share a
 * millisecond) — a cancellation between the passes cannot change the
 * streamed bytes, and the live `active` flag is never consulted. Payment
 * facts (allocations/reversals) are read with the EXCLUSIVE command
 * instant `created_at < export_as_of`, where export_as_of = command.now:
 * facts produced in the export's own start millisecond belong to the NEXT
 * export. export_as_of is recorded in the receipt, so the client-received
 * SHA always equals the receipt SHA.
 */

const BATCH_PAGE_LIMIT_MAX = 100;
const MEMBER_PAGE_DEFAULT = 200;
const MEMBER_PAGE_MAX = 500;
/** Export enumeration page size — matches the design's streaming page size. */
const EXPORT_PAGE = 500;

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
  options: {
    limit?: number;
    cursor?: string | null;
    /** Filter to seller-visible batches (CONFIRMED stored status) in SQL. */
    visibleOnly?: boolean;
  } = {},
): Promise<{ batches: SellerSettlementBatchDto[]; next_cursor: string | null }> {
  const limit = Math.min(options.limit ?? 25, BATCH_PAGE_LIMIT_MAX);
  const clauses = ['batch.seller_organization_id=?'];
  if (options.visibleOnly === true) {
    // PARTIALLY_PAID/PAID are derived at read time from CONFIRMED rows, so
    // the seller-visible filter is exactly the stored CONFIRMED status.
    clauses.push("batch.status='CONFIRMED'");
  }
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

const MEMBER_SELECT = `
  SELECT member.id, member.payable_id, member.formal_order_id,
    member.amazon_order_number_normalized, member.payable_type,
    member.frozen_amount_cny_fen,
    COALESCE(balance.paid_amount_cny_fen,0) AS paid_amount_cny_fen,
    COALESCE(balance.outstanding_amount_cny_fen,
      member.frozen_amount_cny_fen) AS outstanding_amount_cny_fen
  FROM seller_settlement_batch_members member
  JOIN seller_payable_balances balance ON balance.payable_id=member.payable_id
  WHERE member.batch_id=? AND member.active=1`;

const MEMBER_ORDER = ' ORDER BY member.payable_type, member.amazon_order_number_normalized, member.id';

function projectMember(row: MemberRow): SellerSettlementBatchMemberDto {
  return Object.freeze({
    member_id: row.id,
    payable_id: row.payable_id,
    formal_order_id: row.formal_order_id,
    amazon_order_number: row.amazon_order_number_normalized,
    payable_type: row.payable_type,
    frozen_amount_cny_fen: fixedInteger(row.frozen_amount_cny_fen),
    paid_amount_cny_fen: fixedInteger(row.paid_amount_cny_fen),
    outstanding_amount_cny_fen: fixedInteger(row.outstanding_amount_cny_fen),
  });
}

async function readMemberPage(
  database: SqlDatabase,
  batchId: string,
  limit: number,
  cursor: { type: string; number: string; id: string } | null,
): Promise<MemberRow[]> {
  const clauses = [`${MEMBER_SELECT}`];
  const params: unknown[] = [batchId];
  if (cursor !== null) {
    clauses.push(
      'AND (member.payable_type>? OR (member.payable_type=? AND (member.amazon_order_number_normalized>? '
        + 'OR (member.amazon_order_number_normalized=? AND member.id>?))))',
    );
    params.push(
      cursor.type, cursor.type,
      cursor.number, cursor.number, cursor.id,
    );
  }
  const rows = await database
    .prepare(`${clauses.join(' ')}${MEMBER_ORDER} LIMIT ?`)
    .bind(...params, limit)
    .all<MemberRow>();
  return rows.results;
}

export async function readBatchDetail(
  database: SqlDatabase,
  sellerOrganizationId: string,
  batchId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<SellerSettlementBatchDetailDto> {
  const batch = await readBatch(database, batchId);
  if (batch.seller_organization_id !== sellerOrganizationId) {
    throw new SellerSettlementError('NOT_FOUND', 404);
  }
  const limit = Math.min(
    Math.max(options.limit ?? MEMBER_PAGE_DEFAULT, 1),
    MEMBER_PAGE_MAX,
  );
  const cursor = options.cursor === null || options.cursor === undefined
    ? null
    : decodeMemberCursor(options.cursor);
  // Fetch one extra row to detect has-more without counting the whole set.
  const rows = await readMemberPage(database, batchId, limit + 1, cursor);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return Object.freeze({
    ...projectBatch(batch),
    members: page.map(projectMember),
    members_next_cursor: hasMore && last
      ? encodeMemberCursor(last.payable_type, last.amazon_order_number_normalized, last.id)
      : null,
  });
}

/** Seller-portal projection: seller-safe fields only, strict contract. */
export function projectSellerPortalBatch(
  batch: SellerSettlementBatchDto,
): SellerPortalSettlementBatchDto {
  if (batch.status === 'DRAFT' || batch.status === 'CANCELLED') {
    throw new SellerSettlementError('NOT_FOUND', 404);
  }
  return Object.freeze({
    batch_id: batch.batch_id,
    status: batch.status,
    frozen_total_cny_fen: batch.frozen_total_cny_fen,
    frozen_payable_count: batch.frozen_payable_count,
    paid_amount_cny_fen: batch.paid_amount_cny_fen,
    outstanding_amount_cny_fen: batch.outstanding_amount_cny_fen,
    confirmed_at: batch.confirmed_at === null ? 0 : batch.confirmed_at,
  });
}

export function projectSellerPortalDetail(
  detail: SellerSettlementBatchDetailDto,
): SellerPortalSettlementBatchDetailDto {
  return Object.freeze({
    ...projectSellerPortalBatch(detail),
    members: detail.members.map((member) => Object.freeze({
      amazon_order_number: member.amazon_order_number,
      payable_type: member.payable_type,
      frozen_amount_cny_fen: member.frozen_amount_cny_fen,
      paid_amount_cny_fen: member.paid_amount_cny_fen,
      outstanding_amount_cny_fen: member.outstanding_amount_cny_fen,
    })),
    members_next_cursor: detail.members_next_cursor,
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
    let addedPaidAmount = 0;
    let addedOutstandingAmount = 0;
    for (const payableId of input.payableIds) {
      const payable = await database
        .prepare(
          `SELECT payable.id AS payable_id,
            payable.seller_organization_id,
            payable.formal_order_id,
            payable.payable_type,
            payable.financial_snapshot_id,
            payable.amount_cny_fen,
            COALESCE(balance.paid_amount_cny_fen,0) AS paid_amount_cny_fen,
            COALESCE(balance.outstanding_amount_cny_fen,
              payable.amount_cny_fen) AS outstanding_amount_cny_fen,
            formal_order.amazon_order_number_normalized
          FROM seller_payables payable
          JOIN formal_orders formal_order ON formal_order.id=payable.formal_order_id
          LEFT JOIN seller_payable_balances balance ON balance.payable_id=payable.id
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
          paid_amount_cny_fen: number;
          outstanding_amount_cny_fen: number;
          amazon_order_number_normalized: string;
        }>();
      if (
        !payable
        || payable.seller_organization_id !== batch.seller_organization_id
      ) {
        throw new SellerSettlementError('NOT_FOUND', 404);
      }
      addedPaidAmount += Number(payable.paid_amount_cny_fen);
      addedOutstandingAmount += Number(payable.outstanding_amount_cny_fen);
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
    const response = {
      batch: projectBatch({
        ...batch,
        paid_amount_cny_fen:
          Number(batch.paid_amount_cny_fen) + addedPaidAmount,
        outstanding_amount_cny_fen:
          Number(batch.outstanding_amount_cny_fen)
          + addedOutstandingAmount,
      }),
      replayed: false,
    };
    await database.batch([
      ...statements,
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { batch_id: input.batchId },
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
    const member = await database
      .prepare(
        `SELECT
          COALESCE(balance.paid_amount_cny_fen,0) AS paid_amount_cny_fen,
          COALESCE(balance.outstanding_amount_cny_fen,
            member.frozen_amount_cny_fen) AS outstanding_amount_cny_fen
        FROM seller_settlement_batch_members member
        JOIN seller_payable_balances balance ON balance.payable_id=member.payable_id
        WHERE member.batch_id=? AND member.payable_id=? AND member.active=1`,
      )
      .bind(input.batchId, input.payableId)
      .first<{
        paid_amount_cny_fen: number;
        outstanding_amount_cny_fen: number;
      }>();
    const response = {
      batch: projectBatch({
        ...batch,
        paid_amount_cny_fen:
          Number(batch.paid_amount_cny_fen) - Number(member?.paid_amount_cny_fen ?? 0),
        outstanding_amount_cny_fen:
          Number(batch.outstanding_amount_cny_fen)
          - Number(member?.outstanding_amount_cny_fen ?? 0),
      }),
      replayed: false,
    };
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
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { batch_id: input.batchId },
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
      const response = {
        batch: projectBatch({
          ...batch,
          status: 'CONFIRMED',
          frozen_total_cny_fen: Number(members.total),
          frozen_payable_count: Number(members.c),
          frozen_at: now,
          version: Number(batch.version) + 1,
        }),
        replayed: false,
      };
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
        completeIdempotencyStatement(database, acquired.claim, response, {
          resultReferences: { batch_id: input.batchId },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      return response;
    }
    return { batch: projectBatch(batch), replayed: false };
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
    const response = {
      batch: projectBatch({
        ...batch,
        status: 'CANCELLED',
        paid_amount_cny_fen: 0,
        outstanding_amount_cny_fen: 0,
        cancelled_at: now,
        cancel_reason: reason,
        version: Number(batch.version) + 1,
      }),
      replayed: false,
    };
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
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { batch_id: input.batchId },
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

// ---------------------------------------------------------------------------
// Export (7.5R: prechecked, page-enumerated, idempotent)
// ---------------------------------------------------------------------------

export const EXPORT_ROW_LIMIT = 5_000;
export const EXPORT_BYTE_LIMIT = 2 * 1024 * 1024;

/**
 * RFC 4180 quoting plus CSV formula neutralization: a leading =,+,-,@,TAB,CR
 * gets a `'` prefix; any field containing a quote, comma, CR or LF is wrapped
 * in double quotes with embedded quotes doubled.
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  if (/["\r\n,]/u.test(guarded)) {
    return `"${guarded.replaceAll('"', '""')}"`;
  }
  return guarded;
}

export function exportFilename(batchId: string): string {
  return `seller-settlement-batch-${batchId}.csv`;
}

export function exportHeader(): string {
  return 'amazon_order_number,payable_type,frozen_amount_cny_fen,'
    + 'paid_amount_cny_fen,outstanding_amount_cny_fen,confirmed_at,due_at\n';
}

/** The whitelisted CSV fields — never the internal member/payable/order ids. */
export interface ExportCsvRow {
  amazon_order_number: string;
  payable_type: 'SELLER_PRINCIPAL' | 'SELLER_SERVICE_FEE';
  frozen_amount_cny_fen: string;
  paid_amount_cny_fen: string;
  outstanding_amount_cny_fen: string;
}

export function exportRow(
  member: ExportCsvRow,
  confirmedAtIso: string,
  dueAtIso: string,
): string {
  return [
    csvCell(member.amazon_order_number),
    csvCell(member.payable_type),
    csvCell(member.frozen_amount_cny_fen),
    csvCell(member.paid_amount_cny_fen),
    csvCell(member.outstanding_amount_cny_fen),
    csvCell(confirmedAtIso),
    csvCell(dueAtIso),
  ].join(',') + '\n';
}

export interface SellerSettlementBatchExportReceipt {
  batch_id: string;
  row_count: number;
  sha256: string;
  exported_at: number;
  /**
   * 7.5R-4: EXCLUSIVE upper bound on payment-fact timestamps — both export
   * passes read allocations/reversals with created_at < export_as_of, and
   * the value is the export command's start instant (command.now). Facts
   * produced in that same start millisecond belong to the NEXT export, so
   * a payment or reversal committed after the preflight with created_at ==
   * export_as_of (or later) cannot enter the second pass, and the streamed
   * bytes always hash to this receipt's SHA.
   */
  export_as_of: number;
  replayed: boolean;
}

export type ExportOutcome =
  | {
    kind: 'FILE';
    receipt: SellerSettlementBatchExportReceipt;
    /** Lazy pass-2 stream: nothing is read or encoded until pulled. */
    createStream: () => ReadableStream<Uint8Array>;
  }
  | { kind: 'REPLAY'; receipt: SellerSettlementBatchExportReceipt };

// ---------------------------------------------------------------------------
// Export pass machinery (7.5R-2 + 7.5R-3)
// ---------------------------------------------------------------------------

/**
 * Payment facts bounded by the EXCLUSIVE export_as_of watermark: paid =
 * allocations − reversals with created_at < export_as_of, outstanding =
 * payable amount − paid. The due date is JOINed into the page query itself
 * — no batch-wide due-date map is ever built. Two placeholders per
 * expression, and the expression appears twice (paid + outstanding), so
 * every page binds export_as_of four times before the batch id.
 */
const PAID_AS_OF_EXPR = `
  COALESCE((
    SELECT SUM(alloc.amount_cny_fen) FROM seller_payment_allocations alloc
    WHERE alloc.payable_id=member.payable_id AND alloc.created_at<?
  ),0)
  -COALESCE((
    SELECT SUM(reversal.amount_cny_fen) FROM seller_payment_allocation_reversals reversal
    WHERE reversal.payable_id=member.payable_id AND reversal.created_at<?
  ),0)`;

/**
 * The CONFIRMATION-TIME frozen member snapshot (7.5R-3): every member added
 * no later than batch.frozen_at that was not already removed at or before
 * it. Members released by a later cancellation (removed_at > frozen_at,
 * active flipped to 0) stay in the export; draft members removed before
 * confirmation (removed_at <= frozen_at) stay out. The live `active` flag
 * is deliberately NOT consulted — cancellation between the two passes must
 * not change the streamed bytes. The same condition, order and cursor drive
 * both passes.
 */
const EXPORT_MEMBER_SELECT = `
  SELECT member.id, member.payable_id, member.formal_order_id,
    member.amazon_order_number_normalized, member.payable_type,
    member.frozen_amount_cny_fen, payable.due_at,
    ${PAID_AS_OF_EXPR} AS paid_amount_cny_fen,
    payable.amount_cny_fen-(${PAID_AS_OF_EXPR}) AS outstanding_amount_cny_fen
  FROM seller_settlement_batch_members member
  JOIN seller_payables payable ON payable.id=member.payable_id
  WHERE member.batch_id=? AND member.added_at<=?
    AND (member.removed_at IS NULL OR member.removed_at>?
      OR (member.removal_reason='BATCH_CANCELLED' AND member.removed_at>=?))`;

interface ExportMemberRow {
  id: string;
  payable_id: string;
  formal_order_id: string;
  amazon_order_number_normalized: string;
  payable_type: 'SELLER_PRINCIPAL' | 'SELLER_SERVICE_FEE';
  frozen_amount_cny_fen: number;
  due_at: number;
  paid_amount_cny_fen: number;
  outstanding_amount_cny_fen: number;
}

async function readExportMemberPage(
  database: SqlDatabase,
  batchId: string,
  exportAsOf: number,
  frozenAt: number,
  limit: number,
  cursor: { type: string; number: string; id: string } | null,
): Promise<ExportMemberRow[]> {
  const clauses = [EXPORT_MEMBER_SELECT];
  const params: unknown[] = [
    exportAsOf, exportAsOf, exportAsOf, exportAsOf,
    batchId, frozenAt, frozenAt, frozenAt,
  ];
  if (cursor !== null) {
    clauses.push(
      'AND (member.payable_type>? OR (member.payable_type=? AND (member.amazon_order_number_normalized>? '
        + 'OR (member.amazon_order_number_normalized=? AND member.id>?))))',
    );
    params.push(
      cursor.type, cursor.type,
      cursor.number, cursor.number, cursor.id,
    );
  }
  const rows = await database
    .prepare(`${clauses.join(' ')}${MEMBER_ORDER} LIMIT ?`)
    .bind(...params, limit)
    .all<ExportMemberRow>();
  return rows.results;
}

function exportMemberCursor(
  row: ExportMemberRow,
): { type: string; number: string; id: string } {
  return {
    type: row.payable_type,
    number: row.amazon_order_number_normalized,
    id: row.id,
  };
}

function exportCsvRow(row: ExportMemberRow, confirmedAtIso: string): string {
  return exportRow(
    {
      amazon_order_number: row.amazon_order_number_normalized,
      payable_type: row.payable_type,
      frozen_amount_cny_fen: fixedInteger(row.frozen_amount_cny_fen),
      paid_amount_cny_fen: fixedInteger(row.paid_amount_cny_fen),
      outstanding_amount_cny_fen: fixedInteger(row.outstanding_amount_cny_fen),
    },
    confirmedAtIso,
    new Date(Number(row.due_at)).toISOString(),
  );
}

function encodeExportPage(
  rows: readonly ExportMemberRow[],
  confirmedAtIso: string,
  encoder: TextEncoder,
): Uint8Array {
  let page = '';
  for (const row of rows) page += exportCsvRow(row, confirmedAtIso);
  return encoder.encode(page);
}

/**
 * Pass 1 — preflight. Walks the exact pages pass 2 will send, enforcing the
 * row/byte ceilings and folding the exact bytes into an incremental
 * SHA-256. Only the current page exists in memory: no chunk array, no
 * merged buffer, no batch-wide member list.
 */
async function preflightExport(
  database: SqlDatabase,
  batch: BatchRow,
  exportAsOf: number,
  frozenAt: number,
  onLimit: (code: 'EXPORT_TOO_LARGE') => never,
  limits: { rows: number; bytes: number },
): Promise<{ rowCount: number; byteLength: number; sha256: string }> {
  const confirmedAtIso = batch.frozen_at === null
    ? ''
    : new Date(Number(batch.frozen_at)).toISOString();
  const encoder = new TextEncoder();
  const hasher = new IncrementalSha256();
  const header = encoder.encode(exportHeader());
  hasher.update(header);
  let byteLength = header.byteLength;
  let rowCount = 0;
  let cursor: { type: string; number: string; id: string } | null = null;
  for (;;) {
    const rows = await readExportMemberPage(
      database, batch.id, exportAsOf, frozenAt, EXPORT_PAGE, cursor,
    );
    if (rows.length === 0) break;
    for (let index = 0; index < rows.length; index += 1) {
      rowCount += 1;
      if (rowCount > limits.rows) onLimit('EXPORT_TOO_LARGE');
    }
    const chunk = encodeExportPage(rows, confirmedAtIso, encoder);
    byteLength += chunk.byteLength;
    if (byteLength > limits.bytes) onLimit('EXPORT_TOO_LARGE');
    hasher.update(chunk);
    if (rows.length < EXPORT_PAGE) break;
    cursor = exportMemberCursor(rows.at(-1)!);
  }
  return { rowCount, byteLength, sha256: hasher.digestHex() };
}

/**
 * Pass 2 — lazy page iterator over the identical as-of query. The returned
 * stream enqueues at most one page per pull(), so the runtime applies real
 * backpressure and the worker never holds more than the current page.
 */
function exportCsvStream(
  database: SqlDatabase,
  batch: BatchRow,
  exportAsOf: number,
  frozenAt: number,
): ReadableStream<Uint8Array> {
  const confirmedAtIso = batch.frozen_at === null
    ? ''
    : new Date(Number(batch.frozen_at)).toISOString();
  const encoder = new TextEncoder();
  let headerSent = false;
  let cursor: { type: string; number: string; id: string } | null = null;
  let exhausted = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (exhausted) {
        controller.close();
        return;
      }
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(encoder.encode(exportHeader()));
        return;
      }
      const rows = await readExportMemberPage(
        database, batch.id, exportAsOf, frozenAt, EXPORT_PAGE, cursor,
      );
      if (rows.length === 0) {
        exhausted = true;
        controller.close();
        return;
      }
      controller.enqueue(encodeExportPage(rows, confirmedAtIso, encoder));
      if (rows.length < EXPORT_PAGE) exhausted = true;
      else cursor = exportMemberCursor(rows.at(-1)!);
    },
  });
}

/**
 * Export command (7.5R + 7.5R-2):
 * - Requires an Idempotency-Key; the request hash binds batch id + format +
 *   expected_version, so a same-key different-version retry is a stable 409.
 * - First run validates state (never DRAFT; expected_version when provided),
 *   freezes export_as_of, preflights the CSV with limit checks and an
 *   incremental SHA over the exact future bytes, then writes exactly one
 *   BATCH_EXPORTED event and completes the idempotency record with the
 *   receipt BEFORE the lazy pass-2 stream is handed to the response.
 * - Replay with the same key returns the stored receipt (JSON), not a second
 *   file; a batch cancelled after the first export fails closed with 409.
 */
export async function exportBatchCsv(
  database: SqlDatabase,
  input: {
    batchId: string;
    expectedVersion: number | null;
    /** Cross-organization exports stay concealed (404). */
    expectedOrganizationId?: string;
    /** Test hook: shrink the row/byte ceilings without touching production. */
    limits?: { rows: number; bytes: number };
  },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ExportOutcome> {
  const now = command.now ?? Date.now();
  const requestHash = await hashCanonicalJson({
    action: 'EXPORT_SELLER_SETTLEMENT_BATCH',
    target: input.batchId,
    payload: { format: 'csv', expected_version: input.expectedVersion },
  });
  let acquired;
  try {
    acquired = await acquireIdempotency(database, {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'EXPORT_SELLER_SETTLEMENT_BATCH',
      targetType: 'SELLER_SETTLEMENT_BATCH',
      targetId: input.batchId,
      idempotencyKey: command.idempotencyKey,
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
  if (acquired.kind === 'REPLAY') {
    const receipt = acquired.response as SellerSettlementBatchExportReceipt;
    // Fail closed: a batch cancelled after the original export must not
    // replay an old receipt as if the export were still valid.
    const batch = await readBatch(database, input.batchId);
    if (input.expectedOrganizationId !== undefined
      && batch.seller_organization_id !== input.expectedOrganizationId) {
      throw new SellerSettlementError('NOT_FOUND', 404);
    }
    if (batch.status !== 'DRAFT' && batch.status !== 'CONFIRMED') {
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    if (input.expectedVersion !== null && Number(batch.version) !== input.expectedVersion) {
      throw new SellerSettlementError('VERSION_CONFLICT', 409);
    }
    return { kind: 'REPLAY', receipt: { ...receipt, replayed: true } };
  }
  try {
    const batch = await readBatch(database, input.batchId);
    if (input.expectedOrganizationId !== undefined
      && batch.seller_organization_id !== input.expectedOrganizationId) {
      throw new SellerSettlementError('NOT_FOUND', 404);
    }
    if (batch.status === 'DRAFT' || batch.status === 'CANCELLED') {
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    if (input.expectedVersion !== null && Number(batch.version) !== input.expectedVersion) {
      throw new SellerSettlementError('VERSION_CONFLICT', 409);
    }
    const refuse = (code: 'EXPORT_TOO_LARGE'): never => {
      throw new SellerSettlementError(code, 409);
    };
    // 7.5R-4 frozen export facts:
    // - member set = the confirmation-time snapshot (added_at / removed_at
    //   / trigger-enforced BATCH_CANCELLED marker against batch.frozen_at),
    //   immune to a cancellation between the passes — even when confirm and
    //   cancel land on the same millisecond (removed_at == frozen_at);
    // - payment facts = the EXCLUSIVE command instant: both passes read
    //   created_at < export_as_of with export_as_of = command.now. Facts
    //   produced in the export's own start millisecond belong to the NEXT
    //   export — that is the documented, stable boundary.
    if (batch.frozen_at === null) {
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    const frozenAt = Number(batch.frozen_at);
    const exportAsOf = now;
    const { rowCount, sha256: sha } = await preflightExport(
      database,
      batch,
      exportAsOf,
      frozenAt,
      refuse,
      input.limits ?? { rows: EXPORT_ROW_LIMIT, bytes: EXPORT_BYTE_LIMIT },
    );
    const receipt: SellerSettlementBatchExportReceipt = Object.freeze({
      batch_id: input.batchId,
      row_count: rowCount,
      sha256: sha,
      exported_at: now,
      export_as_of: exportAsOf,
      replayed: false,
    });
    await database.batch([
      database
        .prepare(
          `INSERT INTO seller_settlement_batch_events(
            id,batch_id,event_type,actor_staff_id,detail_json,created_at)
          VALUES(?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.batchId,
          'BATCH_EXPORTED',
          command.actor.staffId,
          JSON.stringify({ row_count: rowCount, sha256: sha, export_as_of: exportAsOf }),
          now,
        ),
      auditStatement(database, {
        batchId: input.batchId,
        eventType: 'SELLER_SETTLEMENT_BATCH_EXPORTED',
        actor: command.actor,
        idempotencyKey: command.idempotencyKey,
        requestId: command.requestId ?? null,
        previousState: null,
        nextState: { row_count: rowCount, sha256: sha, format: 'csv', export_as_of: exportAsOf },
        now,
      }),
      completeIdempotencyStatement(database, acquired.claim, receipt, {
        resultReferences: { batch_id: input.batchId },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return {
      kind: 'FILE',
      receipt,
      createStream: () => exportCsvStream(database, batch, exportAsOf, frozenAt),
    };
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (error instanceof SellerSettlementError) {
      await markIdempotencyFailed(
        database,
        acquired.claim,
        error.code,
        now,
      );
      throw error;
    }
    await markIdempotencyFailed(database, acquired.claim, 'DEPENDENCY_UNAVAILABLE', now);
    throw error instanceof Error ? error : new Error(message);
  }
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
  return encodeOpaqueCursor({ at: createdAt, id });
}

function decodeCursor(raw: string): { createdAt: number; id: string } {
  const decoded = decodeOpaqueCursor(raw);
  if (!Number.isSafeInteger(decoded['at']) || typeof decoded['id'] !== 'string') {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  return { createdAt: Number(decoded['at']), id: decoded['id'] as string };
}

function encodeMemberCursor(type: string, number: string, id: string): string {
  return encodeOpaqueCursor({ t: type, n: number, id });
}

function decodeMemberCursor(
  raw: string,
): { type: string; number: string; id: string } {
  const decoded = decodeOpaqueCursor(raw);
  if (
    typeof decoded['t'] !== 'string'
    || typeof decoded['n'] !== 'string'
    || typeof decoded['id'] !== 'string'
  ) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  return {
    type: decoded['t'] as string,
    number: decoded['n'] as string,
    id: decoded['id'] as string,
  };
}

function encodeOpaqueCursor(payload: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeOpaqueCursor(raw: string): Record<string, unknown> {
  try {
    const base64 = raw.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(raw.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('bad');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
}
