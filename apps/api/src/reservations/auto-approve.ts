import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { findHistoricalParticipation } from './participation-history';
import {
  calculateBuyerSelfPayFacts,
  canonicalJson,
  orderInstructionContentHash,
  parseJpyInteger,
  toD1SafeInteger,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import { prepareWorkItemCompletionStatements } from '../staff-assignment';
import {
  SIX_HOURS_MS,
} from '../order-instructions/shared';
import {
  parseOrderedKeywords,
  requireMainImage,
} from '../order-instructions/records';
import {
  createInstructionForApprovedReservationStatement,
} from '../order-instructions/workflow-integration';
import {
  insertReservationEventStatement,
  ReservationError,
} from './reservation-shared';

/**
 * 预约自动通过（P4 动作二）。买家提交预约时硬条件全部满足且不命中例外
 * 规则，则在同一原子批次内：确认预约（系统动作留痕）→ 创建并直接发布
 * 下单指引（买家即刻可见）。任何一步失败整体回滚，预约停留在
 * PENDING_REVIEW 并保留 RESERVATION_DECISION 待办（人工兜底）。
 *
 * 例外规则（默认，环境变量可调）：同一买家 24 小时窗口内第 2 笔起转人工。
 * 单笔数量规则不适用——预约表无数量字段，每笔预约占 1 个名额。
 *
 * 表结构约束的取舍（零迁移）：product_reservations 的 CHECK 要求 APPROVED
 * 必须有 decided_by_staff_id，因此运行时幂等引导一个 DISABLED 的系统
 * staff 账号占位（无法登录、不参与分配与员工列表，列表读模型已过滤）。
 */

export const RESERVATION_AUTO_APPROVE_SYSTEM_STAFF_ID =
  'system-reservation-auto-approve';
export const RESERVATION_AUTO_APPROVE_ACTOR_ID = 'reservation-auto-approve';
const SYSTEM_STAFF_DISPLAY_NAME = '系统·预约自动通过';

export interface ReservationAutoApproveConfig {
  enabled: boolean;
  maxPerWindow: number;
  windowMs: number;
}

export function readReservationAutoApproveConfig(
  env: Record<string, unknown>,
): ReservationAutoApproveConfig {
  return {
    enabled: String(env['RESERVATION_AUTO_APPROVE_ENABLED'] ?? '')
      .toLowerCase() === 'true',
    maxPerWindow: readPositiveInt(
      env['RESERVATION_AUTO_APPROVE_MAX_PER_WINDOW'],
      1,
    ),
    windowMs: readPositiveInt(
      env['RESERVATION_AUTO_APPROVE_WINDOW_HOURS'],
      24,
    ) * 3_600_000,
  };
}

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

export interface AutoApproveReservationResult {
  reservation_id: string;
  status: 'APPROVED';
  version: number;
  instruction_id: string;
}

interface AutoApproveSource {
  reservation_id: string;
  demand_batch_id: string;
  buyer_customer_id: string;
  organization_id: string;
  store_id: string;
  marketplace_code: 'AMAZON_JP';
  status: string;
  reservation_version: number;
  demand_status: string;
  reservation_deadline: number;
  order_deadline: number;
  held_reservation_count: number;
  approved_reservation_count: number;
  target_quantity: number;
  product_id: string;
  product_version_id: string;
  product_version_no: number;
  product_name: string;
  search_keywords_json: string;
  buyer_visible_notes: string | null;
  ordering_guide_expected_amount_jpy: number | null;
  color_spec_mode: string | null;
  buyer_self_pay_bps_snapshot: number;
  store_display_name: string;
}

/**
 * Attempts the automatic approval. Returns null when the reservation must
 * stay in manual review (missing hard conditions, publish preconditions, or
 * an exception rule). Throws only on infrastructure failures — the caller
 * (submitReservation) treats a throw as "fall back to manual" as well,
 * because nothing commits unless the whole batch succeeds.
 */
export async function autoApproveReservation(
  database: SqlDatabase,
  input: { reservationId: string },
  command: {
    config: ReservationAutoApproveConfig;
    requestId?: string | null;
    idempotencyKey: string;
    now: number;
  },
): Promise<AutoApproveReservationResult | null> {
  const now = command.now;
  const source = await readAutoApproveSource(database, input.reservationId);
  if (source === null) return null;
  // D-056 §5: a buyer who has already participated in this seller
  // organization can only proceed through this reservation when its
  // one-time exception was consumed by exactly this reservation at submit
  // time; anything else stays with manual review.
  const participation = await findHistoricalParticipation(database, {
    buyerCustomerId: source.buyer_customer_id,
    sellerOrganizationId: source.organization_id,
    excludeReservationId: input.reservationId,
  });
  if (participation !== null) {
    const boundException = await database
      .prepare(
        `SELECT 1 AS present FROM reservation_participation_exceptions
        WHERE buyer_customer_id=? AND seller_organization_id=?
          AND used_by_reservation_id=? AND used_at IS NOT NULL LIMIT 1`,
      )
      .bind(
        source.buyer_customer_id,
        source.organization_id,
        input.reservationId,
      )
      .first<{ present: number }>();
    if (!boundException) return null;
  }
  if (source.status !== 'PENDING_REVIEW'
    || source.demand_status !== 'PUBLISHED'
    || Number(source.reservation_deadline) <= now
    || Number(source.order_deadline) <= now
    || Number(source.held_reservation_count) < 1
    || Number(source.approved_reservation_count) + 1
      > Number(source.target_quantity)) {
    return null;
  }
  // Publish preconditions mirror publishOrderInstruction: an instruction
  // that could not be published would leave the buyer without guidance,
  // defeating the point of auto approval — keep those cases manual.
  if (source.ordering_guide_expected_amount_jpy === null
    || source.color_spec_mode === null
    || Number(source.order_deadline) - now < SIX_HOURS_MS) {
    return null;
  }
  const mainImage = await requireMainImage(
    database,
    source.product_version_id,
  );
  const recentCount = await countBuyerReservationsInWindow(
    database,
    source.buyer_customer_id,
    now - command.config.windowMs,
  );
  // The reservation itself counts as the first in the window; the second
  // onwards goes to manual review (maxPerWindow defaults to 1).
  if (recentCount > command.config.maxPerWindow) {
    return null;
  }

  const instructionId = crypto.randomUUID();
  const instructionVersionId = crypto.randomUUID();
  const mainImageLinkId = crypto.randomUUID();
  const mainBuyerGrantId = crypto.randomUUID();
  const mainStaffGrantId = crypto.randomUUID();
  const nextVersion = Number(source.reservation_version) + 1;
  const initialDeadlineAt = now + SIX_HOURS_MS;
  const orderedKeywords = parseOrderedKeywords(source.search_keywords_json);
  const colorSpecMode = source.color_spec_mode === 'MAIN_IMAGE_VARIANT'
    ? 'MAIN_IMAGE_VARIANT' as const
    : 'ANY_VARIANT' as const;
  const expectedAmount = Number(source.ordering_guide_expected_amount_jpy);
  const selfPayFacts = calculateBuyerSelfPayFacts(
    parseJpyInteger(String(expectedAmount)),
    Number(source.buyer_self_pay_bps_snapshot),
  );
  const contentHash = await orderInstructionContentHash({
    reservationId: source.reservation_id,
    productVersionId: source.product_version_id,
    productVersionNo: Number(source.product_version_no),
    productName: source.product_name,
    mainImageFileObjectId: mainImage.file_object_id,
    mainImageSha256: mainImage.sha256,
    storeDisplayName: source.store_display_name,
    buyerVisibleNotes: source.buyer_visible_notes,
    staffPublicNote: null,
    referenceOrderAmountJpy: expectedAmount,
    buyerSelfPayBps: Number(source.buyer_self_pay_bps_snapshot),
    colorSpecMode,
    orderedKeywords,
  });


  const response: AutoApproveReservationResult = {
    reservation_id: source.reservation_id,
    status: 'APPROVED',
    version: nextVersion,
    instruction_id: instructionId,
  };

  const statements: SqlStatement[] = [
    // Idempotent system staff bootstrap; DISABLED keeps it out of active
    // staff pickers and the access-management employee list.
    database.prepare(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version, version,
        created_at, updated_at, disabled_at
      ) VALUES (?, ?, 'DISABLED', 1, 1, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).bind(
      RESERVATION_AUTO_APPROVE_SYSTEM_STAFF_ID,
      SYSTEM_STAFF_DISPLAY_NAME,
      now,
      now,
      now,
    ),
    database.prepare(`
      UPDATE product_reservations
      SET
        status='APPROVED',
        version=version+1,
        updated_at=MAX(?, updated_at+1),
        decided_by_staff_id=?,
        decision_reason=NULL,
        decided_at=?,
        cancelled_at=NULL,
        expired_at=NULL
      WHERE id=?
        AND status='PENDING_REVIEW'
        AND version=?
    `).bind(
      now,
      RESERVATION_AUTO_APPROVE_SYSTEM_STAFF_ID,
      now,
      source.reservation_id,
      source.reservation_version,
    ),
    database.prepare(`
      UPDATE demand_batches
      SET
        held_reservation_count=held_reservation_count-1,
        approved_reservation_count=approved_reservation_count+1,
        version=version+1,
        updated_at=MAX(?, updated_at+1)
      WHERE id=?
        AND status='PUBLISHED'
        AND held_reservation_count>=1
        AND reservation_deadline>?
        AND order_deadline>?
        AND (approved_reservation_count+1)<=target_quantity
    `).bind(
      now,
      source.demand_batch_id,
      now,
      now,
    ),
    createInstructionForApprovedReservationStatement(database, {
      instructionId,
      reservationId: source.reservation_id,
      buyerCustomerId: source.buyer_customer_id,
      marketplaceCode: source.marketplace_code,
      now,
    }),
    database.prepare(`
      INSERT INTO order_instruction_events (
        id, instruction_id, reservation_id, instruction_version_id,
        event_type, actor_type, actor_id, previous_status, next_status,
        aggregate_version, reason, metadata_json, idempotency_key, created_at
      ) VALUES (?, ?, ?, NULL, 'INSTRUCTION_CREATED', 'SYSTEM', ?,
        NULL, 'UNPUBLISHED', 1, NULL, '{}', ?, ?)
    `).bind(
      crypto.randomUUID(),
      instructionId,
      source.reservation_id,
      RESERVATION_AUTO_APPROVE_ACTOR_ID,
      command.idempotencyKey,
      now,
    ),
    // Initial publication — statement shapes mirror publishOrderInstruction
    // (manual counterpart) with SYSTEM actors and the system staff FK.
    database.prepare(`
      INSERT INTO file_entity_links (
        id, file_object_id, entity_type, entity_id, purpose, visibility,
        linked_by_actor_type, linked_by_actor_id, created_at,
        authorization_mode, expires_at, revoked_at
      ) VALUES (?, ?, 'ORDER_INSTRUCTION_VERSION', ?, 'PRODUCT_IMAGE',
        'BUYER_VISIBLE', 'SYSTEM', ?, ?, 'EXPLICIT_AUDIENCES', NULL, NULL)
    `).bind(
      mainImageLinkId,
      mainImage.file_object_id,
      instructionVersionId,
      RESERVATION_AUTO_APPROVE_ACTOR_ID,
      now,
    ),
    database.prepare(`
      INSERT INTO file_entity_audience_grants (
        id, file_entity_link_id, subject_type, buyer_customer_id,
        seller_organization_id, staff_permission_code, staff_scope_type,
        staff_team_id, granted_by_actor_type, granted_by_actor_id,
        created_at, expires_at, revoked_at
      ) VALUES (?, ?, 'BUYER', ?, NULL, NULL, NULL, NULL,
        'SYSTEM', ?, ?, NULL, NULL)
    `).bind(
      mainBuyerGrantId,
      mainImageLinkId,
      source.buyer_customer_id,
      RESERVATION_AUTO_APPROVE_ACTOR_ID,
      now,
    ),
    database.prepare(`
      INSERT INTO file_entity_audience_grants (
        id, file_entity_link_id, subject_type, buyer_customer_id,
        seller_organization_id, staff_permission_code, staff_scope_type,
        staff_team_id, granted_by_actor_type, granted_by_actor_id,
        created_at, expires_at, revoked_at
      ) VALUES (?, ?, 'STAFF_INTERNAL', NULL, NULL,
        'ORDER_INSTRUCTION_VIEW', 'GLOBAL', NULL,
        'SYSTEM', ?, ?, NULL, NULL)
    `).bind(
      mainStaffGrantId,
      mainImageLinkId,
      RESERVATION_AUTO_APPROVE_ACTOR_ID,
      now,
    ),
    database.prepare(`
      INSERT INTO order_instruction_versions (
        id, instruction_id, version_no, reservation_id,
        product_id, product_version_id, product_version_no,
        main_image_file_entity_link_id, store_display_name_snapshot,
        demand_buyer_visible_notes_snapshot, staff_public_note,
        reference_order_amount_jpy, buyer_self_pay_bps,
        estimated_self_pay_jpy, estimated_refundable_principal_jpy,
        color_spec_mode, content_hash, generator_version,
        published_by_staff_id, published_at, initial_deadline_at, created_at
      ) VALUES (
        ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?,
        'PLAINTEXT_KEYWORDS_V1', ?, ?, ?, ?
      )
    `).bind(
      instructionVersionId,
      instructionId,
      source.reservation_id,
      source.product_id,
      source.product_version_id,
      Number(source.product_version_no),
      mainImageLinkId,
      source.store_display_name,
      source.buyer_visible_notes,
      expectedAmount,
      Number(source.buyer_self_pay_bps_snapshot),
      toD1SafeInteger(selfPayFacts.buyerSelfPayJpy),
      toD1SafeInteger(selfPayFacts.refundablePrincipalJpy),
      colorSpecMode,
      contentHash,
      RESERVATION_AUTO_APPROVE_SYSTEM_STAFF_ID,
      now,
      initialDeadlineAt,
      now,
    ),
    database.prepare(`
      UPDATE order_instructions
      SET status='ACTIVE', current_version_no=1, version=version+1,
          published_at=?, initial_deadline_at=?,
          resubmission_deadline_at=NULL, expired_at=NULL,
          updated_at=MAX(?, updated_at+1)
      WHERE id=? AND version=1 AND status='UNPUBLISHED'
    `).bind(
      now,
      initialDeadlineAt,
      now,
      instructionId,
    ),
    database.prepare(`
      INSERT INTO order_instruction_events (
        id, instruction_id, reservation_id, instruction_version_id,
        event_type, actor_type, actor_id, previous_status, next_status,
        aggregate_version, reason, metadata_json, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, 'INSTRUCTION_PUBLISHED', 'SYSTEM', ?,
        'UNPUBLISHED', 'ACTIVE', 2, NULL, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      instructionId,
      source.reservation_id,
      instructionVersionId,
      RESERVATION_AUTO_APPROVE_ACTOR_ID,
      canonicalJson({
        version_no: 1,
        content_hash: contentHash,
        image_count: 1,
        keyword_count: orderedKeywords.length,
        deadline_at: initialDeadlineAt,
        auto_approved: true,
      }),
      command.idempotencyKey,
      now,
    ),
    insertReservationEventStatement(database, {
      reservationId: source.reservation_id,
      demandBatchId: source.demand_batch_id,
      buyerCustomerId: source.buyer_customer_id,
      eventType: 'RESERVATION_APPROVED',
      actorType: 'SYSTEM',
      actorId: RESERVATION_AUTO_APPROVE_ACTOR_ID,
      previousStatus: 'PENDING_REVIEW',
      nextStatus: 'APPROVED',
      reservationVersion: nextVersion,
      reason: '硬条件满足，系统自动通过',
      idempotencyKey: command.idempotencyKey,
      createdAt: now,
    }),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'RESERVATION',
      aggregateId: source.reservation_id,
      eventType: 'RESERVATION_APPROVED',
      actor: {
        type: 'SYSTEM',
        id: RESERVATION_AUTO_APPROVE_ACTOR_ID,
        roles: [],
      },
      requestId: command.requestId ?? null,
      idempotencyKey: command.idempotencyKey,
      previousState: {
        status: 'PENDING_REVIEW',
        version: Number(source.reservation_version),
      },
      nextState: { ...response, decision_source: 'AUTO' },
      createdAt: now,
    }),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'ORDER_INSTRUCTION',
      aggregateId: instructionId,
      eventType: 'ORDER_INSTRUCTION_PUBLISHED',
      actor: {
        type: 'SYSTEM',
        id: RESERVATION_AUTO_APPROVE_ACTOR_ID,
        roles: [],
      },
      requestId: command.requestId ?? null,
      idempotencyKey: command.idempotencyKey,
      previousState: {
        status: 'UNPUBLISHED',
        current_version_no: 0,
        version: 1,
      },
      nextState: {
        instruction_id: instructionId,
        status: 'ACTIVE',
        version_no: 1,
        auto_approved: true,
      },
      createdAt: now,
    }),
    ...await prepareWorkItemCompletionStatements(database, {
      workType: 'RESERVATION_DECISION',
      sourceEntityType: 'RESERVATION',
      sourceEntityId: source.reservation_id,
      outcome: 'COMPLETED',
      actorType: 'SYSTEM',
      actorId: RESERVATION_AUTO_APPROVE_ACTOR_ID,
      requestId: command.requestId ?? null,
      idempotencyKey: command.idempotencyKey,
      now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN
        EXISTS (
          SELECT 1 FROM product_reservations
          WHERE id=? AND status='APPROVED' AND version=?
            AND decided_by_staff_id=? AND decided_at IS NOT NULL
        )
        AND EXISTS (
          SELECT 1 FROM demand_batches
          WHERE id=? AND held_reservation_count=? AND approved_reservation_count=?
        )
        AND EXISTS (
          SELECT 1 FROM order_instructions
          WHERE id=? AND status='ACTIVE' AND current_version_no=1
            AND initial_deadline_at=?
        )
        AND EXISTS (
          SELECT 1 FROM order_instruction_versions
          WHERE id=? AND instruction_id=? AND content_hash=?
        )
      THEN 1 ELSE 0 END
    `).bind(
      source.reservation_id,
      nextVersion,
      RESERVATION_AUTO_APPROVE_SYSTEM_STAFF_ID,
      source.demand_batch_id,
      Number(source.held_reservation_count) - 1,
      Number(source.approved_reservation_count) + 1,
      instructionId,
      initialDeadlineAt,
      instructionVersionId,
      instructionId,
      contentHash,
    ),
  ];

  await database.batch(statements);
  return response;
}

async function readAutoApproveSource(
  database: SqlDatabase,
  reservationId: string,
): Promise<AutoApproveSource | null> {
  const row = await database.prepare(`
    SELECT
      reservation.id AS reservation_id,
      reservation.demand_batch_id,
      reservation.buyer_customer_id,
      reservation.organization_id,
      reservation.store_id,
      reservation.marketplace_code,
      reservation.status,
      reservation.version AS reservation_version,
      reservation.buyer_self_pay_bps_snapshot,
      demand.status AS demand_status,
      demand.reservation_deadline,
      demand.order_deadline,
      demand.held_reservation_count,
      demand.approved_reservation_count,
      demand.target_quantity,
      version.product_id,
      version.id AS product_version_id,
      version.version_no AS product_version_no,
      version.product_name,
      version.search_keywords_json,
      version.buyer_visible_notes,
      version.ordering_guide_expected_amount_jpy,
      version.color_spec_mode,
      store.display_name AS store_display_name
    FROM product_reservations reservation
    JOIN demand_batches demand
      ON demand.id=reservation.demand_batch_id
    JOIN product_versions version
      ON version.product_id=reservation.product_id
      AND version.version_no=reservation.product_version_no
    JOIN seller_stores store
      ON store.id=reservation.store_id
    WHERE reservation.id=?
    LIMIT 1
  `).bind(reservationId).first<AutoApproveSource>();
  if (!row) {
    throw new ReservationError('RESERVATION_NOT_FOUND', 404);
  }
  return row;
}

async function countBuyerReservationsInWindow(
  database: SqlDatabase,
  buyerCustomerId: string,
  since: number,
): Promise<number> {
  const row = await database.prepare(`
    SELECT COUNT(*) AS total
    FROM product_reservations
    WHERE buyer_customer_id=?
      AND submitted_at>=?
  `).bind(buyerCustomerId, since).first<{ total: number }>();
  return Number(row?.total ?? 0);
}
