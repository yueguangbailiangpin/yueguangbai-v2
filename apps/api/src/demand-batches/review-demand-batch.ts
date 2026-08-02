import type {
  DemandReviewDecision,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  isDemandReviewDecision,
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
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import {
  prepareWorkItemCompletionStatements,
  requireAssignedWorkflowActor,
} from '../staff-assignment';
import { resolveDemandSelfPayForPublish } from '../order-instructions/demand-self-pay';
import {
  cleanDemandIdentifier,
  cleanDemandReason,
  insertDemandBatchEventStatement,
  normalizeDemandBatchError,
  requireDemandPublishPermission,
  DemandBatchError,
  type DemandStaffActor,
} from './demand-shared';

interface DemandSource {
  demand_batch_id: string;
  organization_id: string;
  store_id: string;
  product_id: string;
  product_version_no: number;
  product_version_id: string;
  search_keywords_json: string;
  ordering_guide_expected_amount_jpy: number | null;
  color_spec_mode: string | null;
  main_image_file_object_id: string | null;
  task_type: string;
  target_quantity: number;
  open_at: number;
  reservation_deadline: number;
  order_deadline: number;
  status: string;
  version: number;
  product_status: string;
  store_status: string;
  organization_status: string;
}

export interface ReviewDemandBatchResult {
  demand_batch_id: string;
  status: 'PUBLISHED' | 'REJECTED';
  version: number;
  review_reason: string | null;
  replayed: boolean;
}

export async function reviewDemandBatch(
  database: SqlDatabase,
  input: {
    demandBatchId: string;
    expectedVersion: number;
    decision: DemandReviewDecision;
    rejectionReason?: string | null;
    buyerSelfPayBps?: number | null;
    buyerSelfPayOverrideReason?: string | null;
  },
  command: {
    actor: DemandStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ReviewDemandBatchResult> {
  requireDemandPublishPermission(command.actor);

  const demandBatchId = cleanDemandIdentifier(
    input.demandBatchId,
  );
  if (!Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1
    || !isDemandReviewDecision(input.decision)) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }

  const rejectionReason = input.decision === 'REJECT'
    ? cleanDemandReason(input.rejectionReason)
    : null;
  if (input.decision === 'PUBLISH'
    && input.rejectionReason != null
    && input.rejectionReason.trim().length > 0) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }

  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'REVIEW_DEMAND_BATCH',
    demand_batch_id: demandBatchId,
    expected_version: input.expectedVersion,
    decision: input.decision,
    rejection_reason: rejectionReason,
    buyer_self_pay_bps: input.buyerSelfPayBps ?? null,
    buyer_self_pay_override_reason:
      input.buyerSelfPayOverrideReason ?? null,
  });

  const acquired =
    await acquireIdempotency<ReviewDemandBatchResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'REVIEW_DEMAND_BATCH',
        targetType: 'DEMAND_BATCH',
        targetId: demandBatchId,
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
    const source = await requireReviewSource(
      database,
      demandBatchId,
    );
    if (source.version !== input.expectedVersion) {
      throw new DemandBatchError(
        'VERSION_CONFLICT',
        409,
      );
    }
    if (source.status !== 'SUBMITTED') {
      throw new DemandBatchError(
        'DEMAND_BATCH_ALREADY_REVIEWED',
        409,
      );
    }
    if (input.decision === 'PUBLISH') {
      if (source.product_status !== 'ACTIVE'
        || source.store_status !== 'ACTIVE'
        || source.organization_status !== 'ACTIVE') {
        throw new DemandBatchError(
          'VALIDATION_ERROR',
          409,
        );
      }
      if (source.reservation_deadline <= now
        || source.order_deadline <= now) {
        throw new DemandBatchError(
          'DEMAND_BATCH_EXPIRED',
          409,
        );
      }
      requireOrderInstructionReadiness(source);
    }

    const selfPay = input.decision === 'PUBLISH'
      ? await resolveDemandSelfPayForPublish(database, {
          productId: source.product_id,
          productVersionNo: Number(source.product_version_no),
          ...(input.buyerSelfPayBps === undefined
            ? {}
            : { overrideBps: input.buyerSelfPayBps }),
          ...(input.buyerSelfPayOverrideReason === undefined
            ? {}
            : { overrideReason: input.buyerSelfPayOverrideReason }),
        })
      : null;

    const nextVersion = source.version + 1;
    const nextStatus = input.decision === 'PUBLISH'
      ? 'PUBLISHED'
      : 'REJECTED';
    const response: ReviewDemandBatchResult = {
      demand_batch_id: demandBatchId,
      status: nextStatus,
      version: nextVersion,
      review_reason: rejectionReason,
      replayed: false,
    };

    const eventType = input.decision === 'PUBLISH'
      ? 'DEMAND_BATCH_PUBLISHED'
      : 'DEMAND_BATCH_REJECTED';
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `demand-batch-reviewed:${demandBatchId}`,
      eventType,
      aggregateType: 'DEMAND_BATCH',
      aggregateId: demandBatchId,
      payload: {
        demand_batch_id: demandBatchId,
        seller_organization_id: source.organization_id,
        product_id: source.product_id,
        status: nextStatus,
        version: nextVersion,
        review_reason: rejectionReason,
      },
      createdAt: now,
    });

    await requireAssignedWorkflowActor(database, {
      staffId: command.actor.staffId,
      workType: 'DEMAND_REVIEW',
      sourceEntityType: 'DEMAND_BATCH',
      sourceEntityId: demandBatchId,
    });

    const statements: SqlStatement[] = [
      // Phase 3H access was resolved from persisted Staff facts above.
      input.decision === 'PUBLISH'
        ? database.prepare(`
            UPDATE demand_batches
            SET
              status='PUBLISHED',
              review_reason=NULL,
              reviewed_by_staff_id=?,
              version=version+1,
              updated_at=MAX(?, updated_at+1),
              reviewed_at=?,
              published_at=?,
              buyer_self_pay_bps_snapshot=?,
              buyer_self_pay_source=?,
              buyer_self_pay_override_reason=?,
              withdrawn_at=NULL,
              closed_at=NULL
            WHERE id=?
              AND status='SUBMITTED'
              AND version=?
          `).bind(
            command.actor.staffId,
            now,
            now,
            now,
            selfPay!.buyerSelfPayBps,
            selfPay!.source,
            selfPay!.overrideReason,
            demandBatchId,
            source.version,
          )
        : database.prepare(`
            UPDATE demand_batches
            SET
              status='REJECTED',
              review_reason=?,
              reviewed_by_staff_id=?,
              version=version+1,
              updated_at=MAX(?, updated_at+1),
              reviewed_at=?,
              published_at=NULL,
              withdrawn_at=NULL,
              closed_at=NULL
            WHERE id=?
              AND status='SUBMITTED'
              AND version=?
          `).bind(
            rejectionReason,
            command.actor.staffId,
            now,
            now,
            demandBatchId,
            source.version,
          ),
      insertDemandBatchEventStatement(database, {
        demandBatchId,
        organizationId: source.organization_id,
        storeId: source.store_id,
        productId: source.product_id,
        eventType,
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousStatus: 'SUBMITTED',
        nextStatus,
        demandVersion: nextVersion,
        reason: rejectionReason,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'DEMAND_BATCH',
        aggregateId: demandBatchId,
        eventType,
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: 'SUBMITTED',
          version: source.version,
        },
        nextState: response,
        metadata: {
          buyer_self_pay_bps: selfPay?.buyerSelfPayBps ?? null,
          buyer_self_pay_source: selfPay?.source ?? null,
          buyer_self_pay_override_reason: selfPay?.overrideReason ?? null,
          product_version_id: source.product_version_id,
          product_version_no: source.product_version_no,
          reference_order_amount_jpy:
            source.ordering_guide_expected_amount_jpy,
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
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
      assertReviewedStatement(
        database,
        acquired.claim,
        response,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await database.batch([
      ...statements,
      ...await prepareWorkItemCompletionStatements(database, {
        workType: 'DEMAND_REVIEW',
        sourceEntityType: 'DEMAND_BATCH',
        sourceEntityId: demandBatchId,
        outcome: 'COMPLETED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        now,
      }),
    ]);
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

async function requireReviewSource(
  database: SqlDatabase,
  demandBatchId: string,
): Promise<DemandSource> {
  const row = await database.prepare(`
    SELECT
      demand.id AS demand_batch_id,
      demand.organization_id,
      demand.store_id,
      demand.product_id,
      demand.product_version_no,
      version.id AS product_version_id,
      version.search_keywords_json,
      version.ordering_guide_expected_amount_jpy,
      version.color_spec_mode,
      image.file_object_id AS main_image_file_object_id,
      demand.task_type,
      demand.target_quantity,
      demand.open_at,
      demand.reservation_deadline,
      demand.order_deadline,
      demand.status,
      demand.version,
      product.status AS product_status,
      store.status AS store_status,
      organization.status AS organization_status
    FROM demand_batches demand
    JOIN products product
      ON product.id=demand.product_id
      AND product.organization_id=demand.organization_id
    JOIN product_versions version
      ON version.product_id=demand.product_id
      AND version.version_no=demand.product_version_no
    LEFT JOIN (
      SELECT main_image.product_version_id, link.file_object_id
      FROM product_version_main_images main_image
      JOIN file_entity_links link
        ON link.id=main_image.file_entity_link_id
        AND link.entity_type='PRODUCT_VERSION'
        AND link.entity_id=main_image.product_version_id
        AND link.purpose='PRODUCT_IMAGE'
        AND link.revoked_at IS NULL
      JOIN file_objects object
        ON object.id=link.file_object_id
        AND object.status='VERIFIED'
        AND object.purpose='PRODUCT_IMAGE'
      JOIN file_upload_intents intent
        ON intent.id=object.upload_intent_id
        AND intent.status='VERIFIED'
        AND intent.purpose='PRODUCT_IMAGE'
    ) image ON image.product_version_id=version.id
    JOIN seller_stores store
      ON store.id=demand.store_id
      AND store.organization_id=demand.organization_id
    JOIN seller_organizations organization
      ON organization.id=demand.organization_id
    WHERE demand.id=?
  `).bind(
    demandBatchId,
  ).first<DemandSource>();

  if (!row) {
    throw new DemandBatchError(
      'DEMAND_BATCH_NOT_FOUND',
      404,
    );
  }
  return row;
}

function requireOrderInstructionReadiness(source: DemandSource): void {
  const expectedAmount = Number(source.ordering_guide_expected_amount_jpy);
  if (source.ordering_guide_expected_amount_jpy === null
    || !Number.isSafeInteger(expectedAmount)
    || expectedAmount < 0
    || !['MAIN_IMAGE_VARIANT', 'ANY_VARIANT'].includes(
      source.color_spec_mode ?? '',
    )
    || source.main_image_file_object_id === null) {
    throw new DemandBatchError('VALIDATION_ERROR', 409);
  }
  try {
    const keywords = JSON.parse(source.search_keywords_json) as unknown;
    if (!Array.isArray(keywords)
      || keywords.length < 1
      || keywords.some((keyword) => typeof keyword !== 'string'
        || keyword.normalize('NFKC').trim().length < 1)) {
      throw new Error('invalid keywords');
    }
  } catch {
    throw new DemandBatchError('VALIDATION_ERROR', 409);
  }
}

function assertReviewedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: ReviewDemandBatchResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM demand_batches
        WHERE id=?
          AND status=?
          AND version=?
          AND reviewed_by_staff_id IS NOT NULL
          AND reviewed_at IS NOT NULL
          AND (
            (?='PUBLISHED' AND published_at IS NOT NULL)
            OR
            (?='REJECTED'
              AND published_at IS NULL
              AND review_reason IS NOT NULL)
          )
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
    response.status,
    response.version,
    response.status,
    response.status,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
