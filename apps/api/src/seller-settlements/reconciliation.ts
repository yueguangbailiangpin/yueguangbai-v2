import type {
  SellerPayableReconciliationResultDto,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { canonicalJson, hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  authorizeSellerSettlement,
  cleanSettlementIdentifier,
  cleanSettlementTimestamp,
  normalizeSettlementError,
  SellerSettlementError,
} from './shared';

interface CandidateRow {
  entity_key: string;
  entity_type: 'FORMAL_ORDER' | 'REVIEW_CASE';
  entity_id: string;
  formal_order_id: string;
  seller_organization_id: string;
  financial_snapshot_id: string | null;
  snapshot_count: number;
  approval_count: number;
  approval_at: number | null;
  amount_cny_fen: number | null;
  existing_payable_id: string | null;
  organization_consistent: number;
}

export async function reconcileSellerPayables(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    cursor?: string | null;
    limit?: number;
  },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<SellerPayableReconciliationResultDto> {
  const sellerOrganizationId = cleanSettlementIdentifier(input.sellerOrganizationId);
  const cursor = cleanReconciliationCursor(input.cursor);
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const now = cleanSettlementTimestamp(command.now ?? Date.now());
  await authorizeSellerSettlement(
    database,
    command.actor,
    sellerOrganizationId,
    { correction: true },
  );
  const requestHash = await hashCanonicalJson({
    action: 'RECONCILE_SELLER_PAYABLES',
    seller_organization_id: sellerOrganizationId,
    cursor,
    limit,
  });
  const acquired = await acquireIdempotency<SellerPayableReconciliationResultDto>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'RECONCILE_SELLER_PAYABLES',
      targetType: 'SELLER_ORGANIZATION',
      targetId: sellerOrganizationId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const candidates = await listCandidates(
      database,
      sellerOrganizationId,
      cursor,
      limit + 1,
    );
    const page = candidates.slice(0, limit);
    const statements: SqlStatement[] = [];
    let createdCount = 0;
    let conflictCount = 0;
    for (const row of page) {
      const conflict = conflictReason(row);
      if (conflict !== null) {
        conflictCount += 1;
        statements.push(database.prepare(`
          INSERT OR IGNORE INTO seller_payable_reconciliation_conflicts (
            id, entity_type, entity_id, reason_code, detected_at
          ) VALUES (?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          row.entity_type,
          row.entity_id,
          conflict,
          now,
        ));
        continue;
      }
      if (row.existing_payable_id !== null) continue;
      createdCount += 1;
      const payableType = row.entity_type === 'FORMAL_ORDER'
        ? 'SELLER_PRINCIPAL'
        : 'SELLER_SERVICE_FEE';
      const sourceType = row.entity_type === 'FORMAL_ORDER'
        ? 'FORMAL_ORDER'
        : 'REVIEW_APPROVAL';
      const payableId = crypto.randomUUID();
      const payableEventId = crypto.randomUUID();
      const dueAt = row.entity_type === 'FORMAL_ORDER'
        ? await confirmedAt(database, row.formal_order_id)
        : Number(row.approval_at);
      statements.push(
        database.prepare(`
          INSERT OR IGNORE INTO seller_payables (
            id, seller_organization_id, formal_order_id, payable_type,
            amount_cny_fen, financial_snapshot_id, source_type, source_id,
            due_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          payableId,
          sellerOrganizationId,
          row.formal_order_id,
          payableType,
          Number(row.amount_cny_fen),
          row.financial_snapshot_id,
          sourceType,
          row.entity_id,
          dueAt,
          dueAt,
        ),
        database.prepare(`
          INSERT OR IGNORE INTO seller_payable_events (
            id, payable_id, event_type, actor_type, actor_id,
            amount_cny_fen, metadata_json, idempotency_key, created_at
          )
          SELECT
            ?, payable.id, 'PAYABLE_RECONCILED', 'STAFF', ?,
            payable.amount_cny_fen, ?, ?, ?
          FROM seller_payables payable
          WHERE payable.formal_order_id=?
            AND payable.payable_type=?
            AND payable.source_type=?
            AND payable.source_id=?
        `).bind(
          payableEventId,
          command.actor.staffId,
          canonicalJson({
            source_entity_type: row.entity_type,
            source_entity_id: row.entity_id,
          }),
          acquired.claim.idempotencyKey,
          now,
          row.formal_order_id,
          payableType,
          sourceType,
          row.entity_id,
        ),
      );
    }
    const hasMore = candidates.length > limit;
    const response: SellerPayableReconciliationResultDto = {
      scanned_count: page.length,
      created_count: createdCount,
      conflict_count: conflictCount,
      next_cursor: hasMore ? page.at(-1)?.entity_key ?? null : null,
      replayed: false,
    };
    statements.push(
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_ORGANIZATION',
        aggregateId: sellerOrganizationId,
        eventType: 'SELLER_PAYABLE_RECONCILIATION_RAN',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: { cursor },
        nextState: response,
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          seller_organization_id: sellerOrganizationId,
          next_cursor: response.next_cursor,
        },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          NOT EXISTS (
            SELECT 1 FROM seller_payable_balances balance
            WHERE balance.seller_organization_id=?
              AND (balance.paid_amount_cny_fen<0
                OR balance.outstanding_amount_cny_fen<0)
          )
        THEN 1 ELSE 0 END
      `).bind(sellerOrganizationId),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    );
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeSettlementError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

export async function listSellerPayableReconciliationConflicts(
  database: SqlDatabase,
  sellerOrganizationId: string,
  input: { after?: number; limit?: number } = {},
) {
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const after = input.after ?? 0;
  const result = await database.prepare(`
    SELECT conflict.*
    FROM seller_payable_reconciliation_conflicts conflict
    WHERE conflict.detected_at>=?
      AND (
        (conflict.entity_type='FORMAL_ORDER' AND EXISTS (
          SELECT 1 FROM formal_orders formal_order
          WHERE formal_order.id=conflict.entity_id
            AND formal_order.seller_organization_id=?
        ))
        OR
        (conflict.entity_type='REVIEW_CASE' AND EXISTS (
          SELECT 1 FROM review_cases review_case
          WHERE review_case.id=conflict.entity_id
            AND review_case.seller_organization_id=?
        ))
      )
    ORDER BY conflict.detected_at, conflict.id
    LIMIT ?
  `).bind(after, sellerOrganizationId, sellerOrganizationId, limit).all<{
    id: string;
    entity_type: 'FORMAL_ORDER' | 'REVIEW_CASE';
    entity_id: string;
    reason_code: string;
    detected_at: number;
  }>();
  return Object.freeze(result.results.map((row) => Object.freeze({
    conflict_id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    reason_code: row.reason_code,
    detected_at: Number(row.detected_at),
  })));
}

async function listCandidates(
  database: SqlDatabase,
  sellerOrganizationId: string,
  cursor: string,
  limit: number,
): Promise<CandidateRow[]> {
  const result = await database.prepare(`
    SELECT * FROM (
      SELECT
        'FORMAL_ORDER:' || formal_order.id AS entity_key,
        'FORMAL_ORDER' AS entity_type,
        formal_order.id AS entity_id,
        formal_order.id AS formal_order_id,
        formal_order.seller_organization_id,
        MIN(snapshot.id) AS financial_snapshot_id,
        COUNT(DISTINCT snapshot.id) AS snapshot_count,
        0 AS approval_count,
        NULL AS approval_at,
        MIN(snapshot.seller_expected_principal_cny_fen) AS amount_cny_fen,
        MIN(payable.id) AS existing_payable_id,
        1 AS organization_consistent
      FROM formal_orders formal_order
      LEFT JOIN formal_order_financial_snapshots snapshot
        ON snapshot.formal_order_id=formal_order.id
      LEFT JOIN seller_payables payable
        ON payable.formal_order_id=formal_order.id
        AND payable.payable_type='SELLER_PRINCIPAL'
      WHERE formal_order.status='CONFIRMED'
        AND formal_order.seller_organization_id=?
      GROUP BY formal_order.id
      UNION ALL
      SELECT
        'REVIEW_CASE:' || review_case.id AS entity_key,
        'REVIEW_CASE' AS entity_type,
        review_case.id AS entity_id,
        review_case.formal_order_id,
        review_case.seller_organization_id,
        MIN(snapshot.id) AS financial_snapshot_id,
        COUNT(DISTINCT snapshot.id) AS snapshot_count,
        COUNT(DISTINCT approval.id) AS approval_count,
        MIN(approval.created_at) AS approval_at,
        MIN(snapshot.service_fee_cny_fen) AS amount_cny_fen,
        MIN(payable.id) AS existing_payable_id,
        CASE WHEN MIN(formal_order.seller_organization_id)
          =review_case.seller_organization_id THEN 1 ELSE 0 END
          AS organization_consistent
      FROM review_cases review_case
      LEFT JOIN formal_orders formal_order
        ON formal_order.id=review_case.formal_order_id
      LEFT JOIN formal_order_financial_snapshots snapshot
        ON snapshot.formal_order_id=review_case.formal_order_id
      LEFT JOIN review_events approval
        ON approval.review_case_id=review_case.id
        AND approval.event_type='REVIEW_APPROVED'
      LEFT JOIN seller_payables payable
        ON payable.formal_order_id=review_case.formal_order_id
        AND payable.payable_type='SELLER_SERVICE_FEE'
      WHERE review_case.status='APPROVED'
        AND review_case.seller_organization_id=?
      GROUP BY review_case.id
    ) candidate
    WHERE candidate.entity_key>?
    ORDER BY candidate.entity_key
    LIMIT ?
  `).bind(
    sellerOrganizationId,
    sellerOrganizationId,
    cursor,
    limit,
  ).all<CandidateRow>();
  return result.results.map((row) => ({
    ...row,
    snapshot_count: Number(row.snapshot_count),
    approval_count: Number(row.approval_count),
    approval_at: row.approval_at === null ? null : Number(row.approval_at),
    amount_cny_fen: row.amount_cny_fen === null
      ? null
      : Number(row.amount_cny_fen),
    organization_consistent: Number(row.organization_consistent),
  }));
}

function conflictReason(row: CandidateRow):
  | 'FINANCIAL_SNAPSHOT_MISSING'
  | 'FINANCIAL_SNAPSHOT_MULTIPLE'
  | 'REVIEW_APPROVAL_SOURCE_CONFLICT'
  | 'SELLER_ORGANIZATION_MISMATCH'
  | 'SOURCE_RELATION_CONFLICT'
  | null {
  if (row.snapshot_count === 0 || row.financial_snapshot_id === null) {
    return 'FINANCIAL_SNAPSHOT_MISSING';
  }
  if (row.snapshot_count !== 1) return 'FINANCIAL_SNAPSHOT_MULTIPLE';
  if (row.entity_type === 'REVIEW_CASE' && row.approval_count !== 1) {
    return 'REVIEW_APPROVAL_SOURCE_CONFLICT';
  }
  if (row.organization_consistent !== 1) {
    return 'SELLER_ORGANIZATION_MISMATCH';
  }
  if (row.amount_cny_fen === null
    || !Number.isSafeInteger(row.amount_cny_fen)
    || row.amount_cny_fen < 0
    || (row.entity_type === 'REVIEW_CASE' && row.approval_at === null)) {
    return 'SOURCE_RELATION_CONFLICT';
  }
  return null;
}

async function confirmedAt(database: SqlDatabase, formalOrderId: string): Promise<number> {
  const row = await database.prepare(`
    SELECT confirmed_at FROM formal_orders WHERE id=?
  `).bind(formalOrderId).first<{ confirmed_at: number }>();
  if (!row || !Number.isSafeInteger(Number(row.confirmed_at))) {
    throw new SellerSettlementError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return Number(row.confirmed_at);
}

function cleanReconciliationCursor(value: string | null | undefined): string {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 240
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  return normalized;
}
