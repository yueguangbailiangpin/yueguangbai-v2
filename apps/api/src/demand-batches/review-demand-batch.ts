import type {
  DemandReviewContextDto,
  DemandOrderScheduleVersionDto,
  DemandReviewDecision,
  DemandTaskType,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  isDemandReviewDecision,
  PRODUCT_SCHEDULE_TIMEZONE,
} from '@ygb/contracts';
import {
  addCalendarDays,
  beijingDateFromEpochMs,
  hashCanonicalJson,
  theoreticalLastOrderDate,
  validateOrderCadence,
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
  requireSellerOrganizationScope,
  requireAssignedWorkflowActor,
  resolveStaffDataScope,
} from '../staff-assignment';
import { resolveDemandSelfPayForPublish } from '../order-instructions/demand-self-pay';
import {
  cleanDemandIdentifier,
  cleanDemandReason,
  canPublishInitialDemandSchedule,
  insertDemandBatchEventStatement,
  normalizeDemandBatchError,
  requireDemandPublishPermission,
  requireInitialDemandSchedulePermission,
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
  product_name: string;
  search_keywords_json: string;
  ordering_guide_expected_amount_jpy: number | null;
  color_spec_mode: string | null;
  order_interval_days: number | null;
  orders_per_run: number | null;
  main_image_file_object_id: string | null;
  task_type: DemandTaskType;
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
  schedule: DemandOrderScheduleVersionDto | null;
  replayed: boolean;
}

export async function readDemandReviewContext(
  database: SqlDatabase,
  rawDemandBatchId: string,
  actor: DemandStaffActor,
): Promise<DemandReviewContextDto> {
  requireDemandPublishPermission(actor);
  const demandBatchId = cleanDemandIdentifier(rawDemandBatchId);
  const source = await requireReviewSource(database, demandBatchId);
  const authorization = await requireAssignedWorkflowActor(database, {
    staffId: actor.staffId,
    workType: 'DEMAND_REVIEW',
    sourceEntityType: 'DEMAND_BATCH',
    sourceEntityId: demandBatchId,
    authoritativeSellerOrganizationId: source.organization_id,
  });
  requireDemandPublishPermission(authorization);
  requireSellerOrganizationScope(
    await resolveStaffDataScope(database, authorization),
    source.organization_id,
  );
  if (source.status !== 'SUBMITTED') {
    throw new DemandBatchError('DEMAND_BATCH_ALREADY_REVIEWED', 409);
  }
  return {
    demand_batch_id: source.demand_batch_id,
    demand_version: Number(source.version),
    status: 'SUBMITTED',
    seller_organization_id: source.organization_id,
    store_id: source.store_id,
    product_id: source.product_id,
    product_version_no: Number(source.product_version_no),
    product_name: source.product_name,
    task_type: source.task_type,
    target_quantity: Number(source.target_quantity),
    reservation_deadline: Number(source.reservation_deadline),
    order_deadline: Number(source.order_deadline),
    cadence: source.order_interval_days === null || source.orders_per_run === null
      ? null
      : {
          order_interval_days: Number(source.order_interval_days),
          orders_per_run: Number(source.orders_per_run),
        },
    can_publish: canPublishInitialDemandSchedule(authorization),
    timezone: PRODUCT_SCHEDULE_TIMEZONE,
    data_as_of: Date.now(),
  };
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
    firstOrderDate?: string | null;
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
  if (input.decision === 'PUBLISH') {
    requireInitialDemandSchedulePermission(command.actor);
  }

  const rejectionReason = input.decision === 'REJECT'
    ? cleanDemandReason(input.rejectionReason)
    : null;
  if (input.decision === 'PUBLISH'
    && input.rejectionReason != null
    && input.rejectionReason.trim().length > 0) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
  const firstOrderDate = input.decision === 'PUBLISH'
    ? cleanDemandOrderDate(input.firstOrderDate)
    : null;
  if (input.decision === 'REJECT' && input.firstOrderDate != null) {
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
    first_order_date: firstOrderDate,
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
    const authorization = await requireAssignedWorkflowActor(database, {
      staffId: command.actor.staffId,
      workType: 'DEMAND_REVIEW',
      sourceEntityType: 'DEMAND_BATCH',
      sourceEntityId: demandBatchId,
      authoritativeSellerOrganizationId: source.organization_id,
    });
    requireDemandPublishPermission(authorization);
    if (input.decision === 'PUBLISH') {
      requireInitialDemandSchedulePermission(authorization);
    }
    requireSellerOrganizationScope(
      await resolveStaffDataScope(database, authorization),
      source.organization_id,
    );
    if (input.decision === 'PUBLISH') {
      const inactive: string[] = [];
      if (source.product_status !== 'ACTIVE') inactive.push('product_status');
      if (source.store_status !== 'ACTIVE') inactive.push('store_status');
      if (source.organization_status !== 'ACTIVE') {
        inactive.push('organization_status');
      }
      if (inactive.length > 0) {
        throw new DemandBatchError('VALIDATION_ERROR', 409, {
          field: inactive.join(','),
          reason: '产品、店铺或卖家组织未处于启用状态，需先恢复后再发布。',
        });
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
    const schedule = input.decision === 'PUBLISH'
      ? await buildInitialSchedule({
          source,
          firstOrderDate: firstOrderDate!,
          demandVersion: nextVersion,
          staffId: command.actor.staffId,
          now,
        })
      : null;
    const response: ReviewDemandBatchResult = {
      demand_batch_id: demandBatchId,
      status: nextStatus,
      version: nextVersion,
      review_reason: rejectionReason,
      schedule,
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
        first_order_date: schedule?.first_order_date ?? null,
        order_interval_days: schedule?.order_interval_days ?? null,
        orders_per_run: schedule?.orders_per_run ?? null,
      },
      createdAt: now,
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
      ...(schedule === null
        ? []
        : [insertInitialScheduleStatement(database, {
            demandBatchId,
            sourceProductVersionId: source.product_version_id,
            schedule,
          })]),
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
          first_order_date: schedule?.first_order_date ?? null,
          theoretical_last_order_date:
            schedule?.theoretical_last_order_date ?? null,
          order_interval_days: schedule?.order_interval_days ?? null,
          orders_per_run: schedule?.orders_per_run ?? null,
          schedule_preview_hash: schedule?.preview_hash ?? null,
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
      version.product_name,
      version.search_keywords_json,
      version.ordering_guide_expected_amount_jpy,
      version.color_spec_mode,
      version.order_interval_days,
      version.orders_per_run,
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
  if (source.ordering_guide_expected_amount_jpy === null) {
    throw new DemandBatchError('VALIDATION_ERROR', 409, {
      field: 'ordering_guide_expected_amount_jpy',
      reason: '产品版本缺少下单指引参考金额，需先补齐再发布。',
    });
  }
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount < 0) {
    throw new DemandBatchError('VALIDATION_ERROR', 409, {
      field: 'ordering_guide_expected_amount_jpy',
      reason: '下单指引参考金额无效，需先修正再发布。',
    });
  }
  if (!['MAIN_IMAGE_VARIANT', 'ANY_VARIANT'].includes(
    source.color_spec_mode ?? '',
  )) {
    throw new DemandBatchError('VALIDATION_ERROR', 409, {
      field: 'color_spec_mode',
      reason: '产品版本缺少颜色规格模式，需先补齐再发布。',
    });
  }
  if (source.main_image_file_object_id === null) {
    throw new DemandBatchError('VALIDATION_ERROR', 409, {
      field: 'main_image',
      reason: '产品版本没有已验证的主图，需先上传并绑定主图再发布。',
    });
  }
  try {
    validateOrderCadence({
      orderIntervalDays: Number(source.order_interval_days),
      ordersPerRun: Number(source.orders_per_run),
    });
  } catch {
    throw new DemandBatchError('VALIDATION_ERROR', 409, {
      field: 'order_cadence',
      reason: '下单频率（间隔天数 / 每期单量）未配置或无效，需先补齐再发布。',
    });
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
    throw new DemandBatchError('VALIDATION_ERROR', 409, {
      field: 'search_keywords',
      reason: `产品版本 v${source.product_version_no} 缺少有效的搜索关键词；若已在更新的版本补齐，请让卖家撤回本批次后重新提交，再发布。`,
    });
  }
}

function cleanDemandOrderDate(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  try {
    if (addCalendarDays(normalized, 0) !== normalized) throw new Error('date');
  } catch {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

async function buildInitialSchedule(input: {
  source: DemandSource;
  firstOrderDate: string;
  demandVersion: number;
  staffId: string;
  now: number;
}): Promise<DemandOrderScheduleVersionDto> {
  const orderIntervalDays = Number(input.source.order_interval_days);
  const ordersPerRun = Number(input.source.orders_per_run);
  const theoreticalLast = theoreticalLastOrderDate({
    firstOrderDate: input.firstOrderDate,
    targetQuantity: Number(input.source.target_quantity),
    orderIntervalDays,
    ordersPerRun,
  });
  const deadlineDate = beijingDateFromEpochMs(input.source.order_deadline);
  if (theoreticalLast > deadlineDate) {
    throw new DemandBatchError('SCHEDULE_WINDOW_CONFLICT', 409);
  }
  const previewHash = await hashCanonicalJson({
    action: 'PUBLISH_DEMAND_SCHEDULE',
    demand_batch_id: input.source.demand_batch_id,
    demand_version: input.demandVersion,
    source_product_version_id: input.source.product_version_id,
    target_quantity: input.source.target_quantity,
    order_deadline_date: deadlineDate,
    first_order_date: input.firstOrderDate,
    order_interval_days: orderIntervalDays,
    orders_per_run: ordersPerRun,
  });
  return {
    schedule_version_id: crypto.randomUUID(),
    version_no: 1,
    demand_version: input.demandVersion,
    first_order_date: input.firstOrderDate,
    theoretical_last_order_date: theoreticalLast,
    order_interval_days: orderIntervalDays,
    orders_per_run: ordersPerRun,
    affected_reservation_count: 0,
    preview_hash: previewHash,
    change_reason: '需求发布',
    changed_by_staff_id: input.staffId,
    created_at: input.now,
  };
}

function insertInitialScheduleStatement(
  database: SqlDatabase,
  input: {
    demandBatchId: string;
    sourceProductVersionId: string;
    schedule: DemandOrderScheduleVersionDto;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO demand_order_schedule_versions (
      id, demand_batch_id, version_no, demand_version,
      source_product_version_id, first_order_date,
      order_interval_days, orders_per_run,
      previous_first_order_date, previous_theoretical_last_order_date,
      theoretical_last_order_date, affected_reservation_count,
      preview_hash, change_reason, changed_by_staff_id, created_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, ?, ?)
  `).bind(
    input.schedule.schedule_version_id,
    input.demandBatchId,
    input.schedule.demand_version,
    input.sourceProductVersionId,
    input.schedule.first_order_date,
    input.schedule.order_interval_days,
    input.schedule.orders_per_run,
    input.schedule.theoretical_last_order_date,
    input.schedule.preview_hash,
    input.schedule.change_reason,
    input.schedule.changed_by_staff_id,
    input.schedule.created_at,
  );
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
