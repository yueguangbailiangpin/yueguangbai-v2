import type {
  DemandTaskType,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  hashCanonicalJson,
} from '@ygb/domain';
import {
  createAuditEventStatement,
} from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  batchWithAssignmentRetry,
  prepareDirectWorkItem,
} from '../staff-assignment';
import {
  cleanDemandIdentifier,
  cleanDemandOptionalNotes,
  demandAuditState,
  deriveSellerDemandSchedule,
  SELLER_DEMAND_SCHEDULE_POLICY,
  insertDemandBatchEventStatement,
  normalizeDemandBatchError,
  parseDemandTaskType,
  requireSellerDemandPermission,
  sellerCanAccessDemandStore,
  validateDemandSchedule,
  validateTargetQuantity,
  DemandBatchError,
  type SellerDemandActor,
} from './demand-shared';

interface ProductSource {
  product_id: string;
  organization_id: string;
  store_id: string;
  marketplace_code: 'AMAZON_JP';
  product_status: string;
  product_version_no: number;
  search_keywords_json: string;
  order_interval_days: number | null;
  orders_per_run: number | null;
  store_status: string;
  organization_status: string;
}

export interface SubmitDemandBatchResult {
  demand_batch_id: string;
  seller_organization_id: string;
  store_id: string;
  product_id: string;
  product_version_no: number;
  marketplace_code: 'AMAZON_JP';
  task_type: DemandTaskType;
  target_quantity: number;
  status: 'SUBMITTED';
  version: 1;
  replayed: boolean;
}

export async function submitDemandBatch(
  database: SqlDatabase,
  input: {
    productId: string;
    taskType: DemandTaskType;
    targetQuantity: number;
    buyerVisibleNotes: string | null;
    sellerNotes: string | null;
    openAt?: number;
    reservationDeadline?: number;
    orderDeadline?: number;
  },
  command: {
    actor: SellerDemandActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<SubmitDemandBatchResult> {
  requireSellerDemandPermission(command.actor);

  const productId = cleanDemandIdentifier(input.productId);
  const taskType = parseDemandTaskType(input.taskType);
  const targetQuantity = validateTargetQuantity(
    input.targetQuantity,
  );
  const buyerVisibleNotes = cleanDemandOptionalNotes(
    input.buyerVisibleNotes,
    2000,
  );
  const sellerNotes = cleanDemandOptionalNotes(
    input.sellerNotes,
    2000,
  );
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }

  const suppliedSchedule = input.openAt !== undefined
    && input.reservationDeadline !== undefined
    && input.orderDeadline !== undefined;
  if (!suppliedSchedule && (
    input.openAt !== undefined
    || input.reservationDeadline !== undefined
    || input.orderDeadline !== undefined
  )) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'SUBMIT_DEMAND_BATCH',
    seller_organization_id:
      command.actor.sellerOrganizationId,
    product_id: productId,
    task_type: taskType,
    target_quantity: targetQuantity,
    buyer_visible_notes: buyerVisibleNotes,
    seller_notes: sellerNotes,
    schedule_policy_version: suppliedSchedule
      ? null
      : SELLER_DEMAND_SCHEDULE_POLICY.version,
    open_at: suppliedSchedule ? input.openAt : null,
    reservation_deadline: suppliedSchedule ? input.reservationDeadline : null,
    order_deadline: suppliedSchedule ? input.orderDeadline : null,
  });

  const acquired =
    await acquireIdempotency<SubmitDemandBatchResult>(
      database,
      {
        actorType: 'SELLER_MEMBER',
        actorId: command.actor.memberId,
        action: 'SUBMIT_DEMAND_BATCH',
        targetType: 'PRODUCT',
        targetId: productId,
        idempotencyKey: command.idempotencyKey,
        requestHash,
      },
      { now },
    );

  if (acquired.kind === 'REPLAY') {
    return {
      ...acquired.response,
      replayed: true,
    };
  }

  try {
    const source = await requireProductSource(
      database,
      productId,
      command.actor.sellerOrganizationId,
    );
    if (!sellerCanAccessDemandStore(
      command.actor,
      source.store_id,
    )) {
      throw new DemandBatchError('FORBIDDEN', 403);
    }

    const schedule = suppliedSchedule
      ? {
          openAt: input.openAt!,
          reservationDeadline: input.reservationDeadline!,
          orderDeadline: input.orderDeadline!,
        }
      : deriveSellerDemandSchedule({
          now,
          targetQuantity,
          orderIntervalDays: source.order_interval_days,
          ordersPerRun: source.orders_per_run,
        });
    const schedulePolicyVersion = suppliedSchedule
      ? null
      : SELLER_DEMAND_SCHEDULE_POLICY.version;
    validateDemandSchedule(schedule);

    const demandBatchId = crypto.randomUUID();
    const response: SubmitDemandBatchResult = {
      demand_batch_id: demandBatchId,
      seller_organization_id: source.organization_id,
      store_id: source.store_id,
      product_id: source.product_id,
      product_version_no: source.product_version_no,
      marketplace_code: source.marketplace_code,
      task_type: taskType,
      target_quantity: targetQuantity,
      status: 'SUBMITTED',
      version: 1,
      replayed: false,
    };


    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO demand_batches (
          id,
          organization_id,
          store_id,
          marketplace_code,
          product_id,
          product_version_no,
          submitted_by_member_id,
          task_type,
          target_quantity,
          buyer_visible_notes,
          seller_notes,
          open_at,
          reservation_deadline,
          order_deadline,
          status,
          review_reason,
          close_reason,
          reviewed_by_staff_id,
          closed_by_staff_id,
          version,
          submitted_at,
          updated_at,
          reviewed_at,
          published_at,
          withdrawn_at,
          closed_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'SUBMITTED', NULL, NULL, NULL, NULL,
          1, ?, ?, NULL, NULL, NULL, NULL
        )
      `).bind(
        demandBatchId,
        source.organization_id,
        source.store_id,
        source.marketplace_code,
        source.product_id,
        source.product_version_no,
        command.actor.memberId,
        taskType,
        targetQuantity,
        buyerVisibleNotes,
        sellerNotes,
        schedule.openAt,
        schedule.reservationDeadline,
        schedule.orderDeadline,
        now,
        now,
      ),
      insertDemandBatchEventStatement(database, {
        demandBatchId,
        organizationId: source.organization_id,
        storeId: source.store_id,
        productId: source.product_id,
        eventType: 'DEMAND_BATCH_SUBMITTED',
        actorType: 'SELLER_MEMBER',
        actorId: command.actor.memberId,
        previousStatus: null,
        nextStatus: 'SUBMITTED',
        demandVersion: 1,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'DEMAND_BATCH',
        aggregateId: demandBatchId,
        eventType: 'DEMAND_BATCH_SUBMITTED',
        actor: {
          type: 'SELLER_MEMBER',
          id: command.actor.memberId,
          roles: [command.actor.role],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
        nextState: {
          ...demandAuditState({
            status: 'SUBMITTED',
            version: 1,
            taskType,
            targetQuantity,
            openAt: schedule.openAt,
            reservationDeadline: schedule.reservationDeadline,
            orderDeadline: schedule.orderDeadline,
            schedulePolicyVersion,
          }),
          demand_batch_id: demandBatchId,
          product_id: source.product_id,
          product_version_no:
            source.product_version_no,
          buyer_visible_notes: buyerVisibleNotes,
          seller_notes: sellerNotes,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            demand_batch_id: demandBatchId,
          },
          now,
        },
      ),
      assertSubmittedStatement(
        database,
        acquired.claim,
        response,
        command.actor.memberId,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await batchWithAssignmentRetry(
      database,
      () => prepareDirectWorkItem(database, {
        workType: 'DEMAND_REVIEW',
        sourceEntityType: 'DEMAND_BATCH',
        sourceEntityId: demandBatchId,
        marketplaceCode: source.marketplace_code,
        sellerOrganizationId: source.organization_id,
        storeId: source.store_id,
        actorType: 'SYSTEM',
        actorId: `seller-member:${command.actor.memberId}`,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        reason: 'demand batch submitted',
        now,
      }),
      statements,
    );
    return response;
  } catch (error) {
    const normalized = normalizeDemandBatchError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

async function requireProductSource(
  database: SqlDatabase,
  productId: string,
  organizationId: string,
): Promise<ProductSource> {
  const row = await database.prepare(`
    SELECT
      product.id AS product_id,
      product.organization_id,
      product.store_id,
      product.marketplace_code,
      product.status AS product_status,
      product.current_version_no AS product_version_no,
      version.search_keywords_json,
      version.order_interval_days,
      version.orders_per_run,
      store.status AS store_status,
      organization.status AS organization_status
    FROM products product
    JOIN seller_stores store
      ON store.id=product.store_id
      AND store.organization_id=product.organization_id
    JOIN product_versions version
      ON version.product_id=product.id
      AND version.version_no=product.current_version_no
    JOIN seller_organizations organization
      ON organization.id=product.organization_id
    WHERE product.id=?
      AND product.organization_id=?
  `).bind(
    productId,
    organizationId,
  ).first<ProductSource>();

  if (!row) {
    throw new DemandBatchError('PRODUCT_NOT_FOUND', 404);
  }
  if (row.product_status !== 'ACTIVE'
    || row.store_status !== 'ACTIVE'
    || row.organization_status !== 'ACTIVE') {
    throw new DemandBatchError('VALIDATION_ERROR', 409);
  }
  // Publish readiness is enforced at submission as well, so the seller learns
  // about a missing search keyword now instead of at staff review time when
  // the batch is already pinned to this product version.
  try {
    const keywords = JSON.parse(row.search_keywords_json) as unknown;
    if (!Array.isArray(keywords)
      || keywords.length < 1
      || keywords.some((keyword) => typeof keyword !== 'string'
        || keyword.normalize('NFKC').trim().length < 1)) {
      throw new Error('invalid keywords');
    }
  } catch {
    throw new DemandBatchError('VALIDATION_ERROR', 409, {
      field: 'search_keywords',
      reason: `产品版本 v${row.product_version_no} 缺少有效的搜索关键词，请先在产品资料中补齐后再提交投放。`,
    });
  }
  return row;
}

function assertSubmittedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: SubmitDemandBatchResult,
  memberId: string,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM demand_batches
        WHERE id=?
          AND organization_id=?
          AND store_id=?
          AND product_id=?
          AND product_version_no=?
          AND submitted_by_member_id=?
          AND status='SUBMITTED'
          AND version=1
      )
      AND EXISTS (
        SELECT 1
        FROM command_idempotency_records
        WHERE actor_type=?
          AND actor_id=?
          AND idempotency_key=?
          AND status='COMMITTED'
          AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    response.demand_batch_id,
    response.seller_organization_id,
    response.store_id,
    response.product_id,
    response.product_version_no,
    memberId,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
