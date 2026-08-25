import type {
  DemandTaskType,
  FixedIntegerString,
  SqlDatabase,
} from '@ygb/contracts';
import {
  calculateBuyerSelfPayFacts,
  fixedIntegerString,
  parseJpyInteger,
} from '@ygb/domain';
import {
  DemandBatchError,
  type BuyerDemandContext,
} from './demand-shared';

interface PublicDemandRow {
  demand_batch_id: string;
  demand_version: number;
  marketplace_code: 'AMAZON_JP';
  product_name: string;
  reference_order_amount_jpy: number;
  buyer_self_pay_bps: number;
  buyer_visible_notes: string | null;
  store_display_name: string;
  task_type: DemandTaskType;
  target_quantity: number;
  open_at: number;
  reservation_deadline: number;
  order_deadline: number;
}

export interface BuyerPublicDemandBatch {
  demand_batch_id: string;
  demand_version: number;
  marketplace_code: 'AMAZON_JP';
  product_name: string;
  reference_order_amount_jpy: FixedIntegerString;
  buyer_self_pay_bps: number;
  estimated_buyer_self_pay_jpy: FixedIntegerString;
  estimated_refundable_principal_jpy: FixedIntegerString;
  buyer_visible_notes: string | null;
  store_display_name: string;
  task_type: DemandTaskType;
  target_quantity: number;
  open_at: number;
  reservation_deadline: number;
  order_deadline: number;
}

export async function listBuyerPublicDemandBatches(
  database: SqlDatabase,
  context: BuyerDemandContext,
  options: {
    now?: number;
    limit?: number;
  } = {},
): Promise<readonly BuyerPublicDemandBatch[]> {
  if (context.accessStatus !== 'ACTIVE') {
    throw new DemandBatchError('CUSTOMER_NOT_ACTIVE', 409);
  }
  if (context.identityReviewStatus !== 'CLEAR') {
    throw new DemandBatchError('IDENTITY_REVIEW_REQUIRED', 409);
  }

  const now = options.now ?? Date.now();
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 100) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }

  const result = await database.prepare(`
    SELECT
      demand.id AS demand_batch_id,
      demand.version AS demand_version,
      demand.marketplace_code,
      version.product_name,
      version.ordering_guide_expected_amount_jpy AS reference_order_amount_jpy,
      demand.buyer_self_pay_bps_snapshot AS buyer_self_pay_bps,
      demand.buyer_visible_notes,
      store.display_name AS store_display_name,
      demand.task_type,
      demand.target_quantity,
      demand.open_at,
      demand.reservation_deadline,
      demand.order_deadline
    FROM demand_batches demand
    JOIN products product
      ON product.id=demand.product_id
      AND product.organization_id=demand.organization_id
      AND product.store_id=demand.store_id
      AND product.marketplace_code=demand.marketplace_code
    JOIN product_versions version
      ON version.product_id=demand.product_id
      AND version.version_no=demand.product_version_no
    JOIN seller_stores store
      ON store.id=demand.store_id
      AND store.organization_id=demand.organization_id
    JOIN seller_organizations organization
      ON organization.id=demand.organization_id
    WHERE demand.marketplace_code=?
      AND demand.status='PUBLISHED'
      AND demand.open_at<=?
      AND demand.reservation_deadline>?
      AND demand.order_deadline>?
      AND product.status='ACTIVE'
      AND store.status='ACTIVE'
      AND organization.status='ACTIVE'
    ORDER BY demand.reservation_deadline, demand.submitted_at, demand.id
    LIMIT ?
  `).bind(
    context.marketplaceCode,
    now,
    now,
    now,
    limit,
  ).all<PublicDemandRow>();

  return Object.freeze(result.results.map((row) => {
    const reference = parseJpyInteger(String(row.reference_order_amount_jpy));
    const estimate = calculateBuyerSelfPayFacts(
      reference,
      Number(row.buyer_self_pay_bps),
    );
    return Object.freeze({
      demand_batch_id: row.demand_batch_id,
      demand_version: Number(row.demand_version),
      marketplace_code: row.marketplace_code,
      product_name: row.product_name,
      reference_order_amount_jpy: fixedIntegerString(reference),
      buyer_self_pay_bps: Number(row.buyer_self_pay_bps),
      estimated_buyer_self_pay_jpy:
        fixedIntegerString(estimate.buyerSelfPayJpy),
      estimated_refundable_principal_jpy:
        fixedIntegerString(estimate.refundablePrincipalJpy),
      buyer_visible_notes: row.buyer_visible_notes,
      store_display_name: row.store_display_name,
      task_type: row.task_type,
      target_quantity: Number(row.target_quantity),
      open_at: Number(row.open_at),
      reservation_deadline: Number(row.reservation_deadline),
      order_deadline: Number(row.order_deadline),
    });
  }));
}
