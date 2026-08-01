import type {
  SqlDatabase,
  StaffWorkItemType,
} from '@ygb/contracts';
import { prepareDirectWorkItem, type DirectWorkItemInput } from './assignment-service';
import { StaffAssignmentError } from './errors';

const DEFAULT_RECONCILIATION_LIMIT = 50;
const MAX_RECONCILIATION_LIMIT = 100;
const RECONCILIATION_ACTOR_ID = 'phase3h-reconciliation';

type SourceEntityType = DirectWorkItemInput['sourceEntityType'];

interface PendingSourceRow {
  work_type: StaffWorkItemType;
  source_entity_type: SourceEntityType;
  source_entity_id: string;
  marketplace_code: string;
  buyer_customer_id: string | null;
  seller_organization_id: string | null;
  store_id: string | null;
}

export interface ReconcilePendingStaffWorkItemsInput {
  marketplaceCode: string;
  limit?: number;
  now: number;
  requestId?: string | null;
}

export interface ReconciledStaffWorkItem {
  work_type: StaffWorkItemType;
  source_entity_type: SourceEntityType;
  source_entity_id: string;
  outcome: 'PREPARED' | 'REPLAYED' | 'SKIPPED';
  reason?: string;
}

export interface ReconcilePendingStaffWorkItemsResult {
  scanned: number;
  prepared: number;
  replayed: number;
  skipped: number;
  items: readonly ReconciledStaffWorkItem[];
}

/**
 * Keeps historical pending sources convergent with the assignment read model.
 * This is deliberately an internal, bounded maintenance operation: it has no
 * request actor, never chooses an arbitrary staff member, and is safe to run
 * again after a partial batch or a deployment restart.
 */
export async function reconcilePendingStaffWorkItems(
  database: SqlDatabase,
  input: ReconcilePendingStaffWorkItemsInput,
): Promise<ReconcilePendingStaffWorkItemsResult> {
  const limit = boundedReconciliationLimit(input.limit);
  if (!Number.isSafeInteger(input.now) || input.now < 0
    || input.marketplaceCode.trim().length < 1) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }

  const rows = (await database.prepare(PENDING_SOURCES_SQL).bind(
    input.marketplaceCode,
    input.marketplaceCode,
    input.marketplaceCode,
    input.marketplaceCode,
    input.marketplaceCode,
    input.marketplaceCode,
    limit,
  ).all<PendingSourceRow>()).results;
  const items: ReconciledStaffWorkItem[] = [];
  let prepared = 0;
  let replayed = 0;
  let skipped = 0;

  for (const row of rows) {
    const item = sourceToWorkItem(row);
    try {
      const result = await prepareDirectWorkItem(database, {
        ...item,
        actorType: 'SYSTEM',
        actorId: RECONCILIATION_ACTOR_ID,
        requestId: input.requestId ?? null,
        idempotencyKey: `phase3h-reconciliation:${row.source_entity_type}:${row.source_entity_id}`,
        reason: 'historical pending work-item reconciliation',
        now: input.now,
      });
      if (result.replayedExisting) {
        replayed += 1;
        items.push({ ...sourceIdentity(row), outcome: 'REPLAYED' });
        continue;
      }
      await database.batch(result.statements);
      prepared += 1;
      items.push({ ...sourceIdentity(row), outcome: 'PREPARED' });
    } catch (error) {
      const reason = reconciliationSkipReason(error);
      if (!reason) throw error;
      skipped += 1;
      items.push({ ...sourceIdentity(row), outcome: 'SKIPPED', reason });
    }
  }

  return {
    scanned: rows.length,
    prepared,
    replayed,
    skipped,
    items,
  };
}

export function boundedReconciliationLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_RECONCILIATION_LIMIT;
  if (!Number.isSafeInteger(limit)
    || limit < 1
    || limit > MAX_RECONCILIATION_LIMIT) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  return limit;
}

function sourceToWorkItem(row: PendingSourceRow): Omit<DirectWorkItemInput,
  'actorType' | 'actorId' | 'requestId' | 'idempotencyKey' | 'reason' | 'now'> {
  return {
    workType: row.work_type,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    marketplaceCode: row.marketplace_code,
    buyerCustomerId: row.buyer_customer_id,
    sellerOrganizationId: row.seller_organization_id,
    storeId: row.store_id,
  };
}

function sourceIdentity(row: PendingSourceRow): Omit<ReconciledStaffWorkItem,
  'outcome' | 'reason'> {
  return {
    work_type: row.work_type,
    source_entity_type: row.source_entity_type,
    source_entity_id: row.source_entity_id,
  };
}

function reconciliationSkipReason(error: unknown): string | null {
  if (!(error instanceof StaffAssignmentError)) return null;
  if (error.code === 'WORK_ITEM_STATE_CONFLICT') return error.code;
  if (error.code === 'NO_ELIGIBLE_ASSIGNEE'
    || error.code === 'OWNER_FALLBACK_NOT_CONFIGURED'
    || error.code === 'OWNER_FALLBACK_INVALID'
    || error.code === 'DEPENDENCY_UNAVAILABLE') {
    return error.code;
  }
  return null;
}

const PENDING_SOURCES_SQL = `
  SELECT
    'PRODUCT_APPLICATION_REVIEW' AS work_type,
    'PRODUCT_APPLICATION' AS source_entity_type,
    application.id AS source_entity_id,
    application.marketplace_code,
    NULL AS buyer_customer_id,
    application.organization_id AS seller_organization_id,
    application.store_id
  FROM product_applications application
  WHERE application.marketplace_code=?
    AND application.status='SUBMITTED'
    AND NOT EXISTS (
      SELECT 1 FROM staff_work_items item
      WHERE item.source_entity_type='PRODUCT_APPLICATION'
        AND item.source_entity_id=application.id
        AND item.work_type='PRODUCT_APPLICATION_REVIEW'
        AND item.status='OPEN'
    )

  UNION ALL

  SELECT
    'DEMAND_REVIEW',
    'DEMAND_BATCH',
    demand.id,
    demand.marketplace_code,
    NULL,
    demand.organization_id,
    demand.store_id
  FROM demand_batches demand
  WHERE demand.marketplace_code=?
    AND demand.status='SUBMITTED'
    AND NOT EXISTS (
      SELECT 1 FROM staff_work_items item
      WHERE item.source_entity_type='DEMAND_BATCH'
        AND item.source_entity_id=demand.id
        AND item.work_type='DEMAND_REVIEW'
        AND item.status='OPEN'
    )

  UNION ALL

  SELECT
    'RESERVATION_DECISION',
    'RESERVATION',
    reservation.id,
    reservation.marketplace_code,
    reservation.buyer_customer_id,
    reservation.organization_id,
    reservation.store_id
  FROM product_reservations reservation
  WHERE reservation.marketplace_code=?
    AND reservation.status='PENDING_REVIEW'
    AND NOT EXISTS (
      SELECT 1 FROM staff_work_items item
      WHERE item.source_entity_type='RESERVATION'
        AND item.source_entity_id=reservation.id
        AND item.work_type='RESERVATION_DECISION'
        AND item.status='OPEN'
    )

  UNION ALL

  SELECT
    'ORDER_EVIDENCE_REVIEW',
    'ORDER_EVIDENCE',
    evidence.id,
    evidence.marketplace_code,
    evidence.buyer_customer_id,
    reservation.organization_id,
    reservation.store_id
  FROM order_evidence_submissions evidence
  JOIN product_reservations reservation
    ON reservation.id=evidence.reservation_id
  WHERE evidence.marketplace_code=?
    AND evidence.status='PENDING_VERIFICATION'
    AND NOT EXISTS (
      SELECT 1 FROM staff_work_items item
      WHERE item.source_entity_type='ORDER_EVIDENCE'
        AND item.source_entity_id=evidence.id
        AND item.work_type='ORDER_EVIDENCE_REVIEW'
        AND item.status='OPEN'
    )

  UNION ALL

  SELECT
    'REVIEW_DECISION',
    'REVIEW_CASE',
    review_case.id,
    formal_order.marketplace_code,
    review_case.buyer_customer_id,
    review_case.seller_organization_id,
    formal_order.store_id
  FROM review_cases review_case
  JOIN formal_orders formal_order
    ON formal_order.id=review_case.formal_order_id
  WHERE formal_order.marketplace_code=?
    AND review_case.status='PENDING_REVIEW'
    AND NOT EXISTS (
      SELECT 1 FROM staff_work_items item
      WHERE item.source_entity_type='REVIEW_CASE'
        AND item.source_entity_id=review_case.id
        AND item.work_type='REVIEW_DECISION'
        AND item.status='OPEN'
    )

  UNION ALL

  SELECT
    'BUYER_REFUND_PROCESSING',
    'BUYER_REFUND_OBLIGATION',
    obligation.id,
    formal_order.marketplace_code,
    obligation.buyer_customer_id,
    review_case.seller_organization_id,
    formal_order.store_id
  FROM buyer_refund_obligations obligation
  JOIN review_cases review_case
    ON review_case.id=obligation.review_case_id
  JOIN formal_orders formal_order
    ON formal_order.id=obligation.formal_order_id
  JOIN review_events due_event
    ON due_event.id=obligation.source_review_event_id
    AND due_event.event_type='BUYER_REFUND_BECAME_DUE'
    AND due_event.next_status='APPROVED'
  WHERE formal_order.marketplace_code=?
    AND review_case.status='APPROVED'
    AND NOT EXISTS (
      SELECT 1 FROM staff_work_items item
      WHERE item.source_entity_type='BUYER_REFUND_OBLIGATION'
        AND item.source_entity_id=obligation.id
        AND item.work_type='BUYER_REFUND_PROCESSING'
        AND item.status='OPEN'
    )

  ORDER BY source_entity_type, source_entity_id
  LIMIT ?
`;
