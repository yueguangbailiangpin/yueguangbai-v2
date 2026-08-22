import type {
  BuyerOrderInstructionDto,
  BuyerOrderInstructionStateDto,
  SqlDatabase,
  StaffOrderInstructionSummaryDto,
  StaffOrderInstructionVersionDto,
} from '@ygb/contracts';
import { fixedIntegerString, parseJpyInteger } from '@ygb/domain';
import {
  instructionCanReadImages,
  OrderInstructionError,
  validateBuyerActor,
  validateTimestamp,
  type BuyerInstructionActor,
  type OrderInstructionStaffActor,
  requireInstructionBuyerScope,
  requireInstructionPermission,
} from './shared';
import {
  parseOrderedKeywords,
  requireInstructionContext,
  requireInstructionContextForReservation,
} from './records';
import { expireInstructionIfDue } from './expiry';

interface CurrentVersionRow {
  instruction_version_id: string;
  version_no: number;
  product_name: string;
  search_keywords_json: string;
  reference_order_amount_jpy: number;
  buyer_self_pay_bps: number;
  estimated_self_pay_jpy: number;
  estimated_refundable_principal_jpy: number;
  store_display_name_snapshot: string;
  demand_buyer_visible_notes_snapshot: string | null;
  staff_public_note: string | null;
  color_spec_mode: 'MAIN_IMAGE_VARIANT' | 'ANY_VARIANT';
  main_image_file_entity_link_id: string;
  main_image_file_object_id: string;
  main_image_mime: 'image/jpeg' | 'image/png' | 'image/webp';
  main_image_width: number | null;
  main_image_height: number | null;
  published_at: number;
}

interface KeywordImageRow {
  image_id: string;
  keyword_position: number;
  file_entity_link_id: string;
  file_object_id: string;
  image_mime: 'image/png';
  width: number;
  height: number;
}

export async function getBuyerOrderInstruction(
  database: SqlDatabase,
  actor: BuyerInstructionActor,
  reservationId: string,
  options: { now?: number } = {},
): Promise<BuyerOrderInstructionDto> {
  validateBuyerActor(actor);
  const now = validateTimestamp(options.now ?? Date.now());
  let source = await requireInstructionContextForReservation(
    database,
    reservationId,
    actor.buyerCustomerId,
  );
  source = await expireInstructionIfDue(database, source.instruction_id, {
    actorType: 'SYSTEM',
    actorId: `buyer-read:${actor.buyerCustomerId}`,
    now,
  });
  if (source.instruction_status !== 'ACTIVE') {
    throw new OrderInstructionError(
      source.instruction_status === 'EXPIRED'
        ? 'INSTRUCTION_EXPIRED'
        : 'INSTRUCTION_NOT_PUBLISHED',
      source.instruction_status === 'EXPIRED' ? 410 : 409,
    );
  }
  const canRead = instructionCanReadImages({
    status: source.instruction_status,
    evidenceStatus: source.evidence_status,
    resubmissionDeadlineAt: source.resubmission_deadline_at,
    formalOrderId: source.formal_order_id,
    now,
  });
  if (!canRead) {
    throw new OrderInstructionError('FILE_ACCESS_DENIED', 403);
  }
  const version = await requireCurrentVersion(database, source.instruction_id,
    source.current_version_no);
  const keywordImages = await listKeywordImages(
    database,
    version.instruction_version_id,
  );
  return Object.freeze({
    status: source.instruction_status,
    product_name: version.product_name,
    search_keywords: parseOrderedKeywords(version.search_keywords_json),
    reference_order_amount_jpy:
      fixedIntegerString(parseJpyInteger(String(version.reference_order_amount_jpy))),
    buyer_self_pay_bps: Number(version.buyer_self_pay_bps),
    estimated_buyer_self_pay_jpy:
      fixedIntegerString(parseJpyInteger(String(version.estimated_self_pay_jpy))),
    estimated_refundable_principal_jpy:
      fixedIntegerString(parseJpyInteger(String(
        version.estimated_refundable_principal_jpy,
      ))),
    store_display_name: version.store_display_name_snapshot,
    color_spec_mode: version.color_spec_mode,
    staff_public_note: version.staff_public_note,
    buyer_visible_notes: version.demand_buyer_visible_notes_snapshot,
    initial_deadline_at: source.initial_deadline_at,
    resubmission_deadline_at: source.resubmission_deadline_at,
    content_updated: source.current_version_no > 1,
    main_image: Object.freeze({
      image_id: version.main_image_file_entity_link_id,
      position: null,
      mime: version.main_image_mime,
      width: version.main_image_width,
      height: version.main_image_height,
      read_intent_path:
        `/api/buyer-portal/reservations/${encodeURIComponent(reservationId)}`
        + '/order-instruction/images/main/read-intent',
    }),
    keyword_images: Object.freeze(keywordImages.map((image) => Object.freeze({
      image_id: image.image_id,
      position: Number(image.keyword_position),
      mime: image.image_mime,
      width: Number(image.width),
      height: Number(image.height),
      read_intent_path:
        `/api/buyer-portal/reservations/${encodeURIComponent(reservationId)}`
        + `/order-instruction/images/${Number(image.keyword_position)}/read-intent`,
    }))),
  });
}

export async function getBuyerOrderInstructionState(
  database: SqlDatabase,
  actor: BuyerInstructionActor,
  reservationId: string,
  options: { now?: number } = {},
): Promise<BuyerOrderInstructionStateDto> {
  validateBuyerActor(actor);
  const now = validateTimestamp(options.now ?? Date.now());
  let source = await requireInstructionContextForReservation(
    database,
    reservationId,
    actor.buyerCustomerId,
  );
  source = await expireInstructionIfDue(database, source.instruction_id, {
    actorType: 'SYSTEM',
    actorId: `buyer-state:${actor.buyerCustomerId}`,
    now,
  });
  const canReadImages = instructionCanReadImages({
    status: source.instruction_status,
    evidenceStatus: source.evidence_status,
    resubmissionDeadlineAt: source.resubmission_deadline_at,
    formalOrderId: source.formal_order_id,
    now,
  });
  const canSubmitEvidence = source.instruction_status === 'ACTIVE'
    && source.formal_order_id === null
    && (
      (source.evidence_status === null
        && source.initial_deadline_at !== null
        && now < source.initial_deadline_at)
      || (source.evidence_status === 'CHANGES_REQUESTED'
        && source.resubmission_deadline_at !== null
        && now < source.resubmission_deadline_at)
    );
  return Object.freeze({
    status: source.instruction_status,
    instruction_version: source.instruction_version,
    current_version_no: source.current_version_no,
    initial_deadline_at: source.initial_deadline_at,
    resubmission_deadline_at: source.resubmission_deadline_at,
    evidence_status: (source.evidence_status ?? 'NONE') as
      BuyerOrderInstructionStateDto['evidence_status'],
    can_submit_evidence: canSubmitEvidence,
    can_read_images: canReadImages,
    content_updated: source.current_version_no > 1,
  });
}

export async function getStaffOrderInstruction(
  database: SqlDatabase,
  actor: OrderInstructionStaffActor,
  instructionId: string,
  options: { now?: number } = {},
): Promise<StaffOrderInstructionSummaryDto> {
  requireInstructionPermission(actor, 'ORDER_INSTRUCTION_VIEW');
  const now = validateTimestamp(options.now ?? Date.now());
  const source = await expireInstructionIfDue(database, instructionId, {
    actorType: 'STAFF',
    actorId: actor.staffId,
    now,
  });
  await requireInstructionBuyerScope(
    database, actor, source.buyer_customer_id, 'ORDER_INSTRUCTION_VIEW',
  );
  return {
    instruction_id: source.instruction_id,
    reservation_id: source.reservation_id,
    buyer_customer_id: source.buyer_customer_id,
    marketplace_code: source.marketplace_code,
    status: source.instruction_status,
    current_version_no: source.current_version_no,
    version: source.instruction_version,
    published_at: source.published_at,
    initial_deadline_at: source.initial_deadline_at,
    resubmission_deadline_at: source.resubmission_deadline_at,
    expired_at: source.expired_at,
    cancelled_at: source.cancelled_at,
    completed_at: source.completed_at,
  };
}

export async function listStaffOrderInstructionVersions(
  database: SqlDatabase,
  actor: OrderInstructionStaffActor,
  instructionId: string,
): Promise<readonly StaffOrderInstructionVersionDto[]> {
  requireInstructionPermission(actor, 'ORDER_INSTRUCTION_VIEW');
  const source = await requireInstructionContext(database, instructionId);
  await requireInstructionBuyerScope(
    database, actor, source.buyer_customer_id, 'ORDER_INSTRUCTION_VIEW',
  );
  const rows = await database.prepare(`
    SELECT
      version.id AS instruction_version_id,
      version.instruction_id,
      version.version_no,
      version.reservation_id,
      version.product_id,
      version.product_version_id,
      version.product_version_no,
      version.main_image_file_entity_link_id,
      version.store_display_name_snapshot,
      version.demand_buyer_visible_notes_snapshot,
      version.staff_public_note,
      version.reference_order_amount_jpy,
      version.buyer_self_pay_bps,
      version.estimated_self_pay_jpy,
      version.estimated_refundable_principal_jpy,
      version.color_spec_mode,
      version.content_hash,
      version.generator_version,
      version.published_by_staff_id,
      version.published_at,
      version.initial_deadline_at,
      version.created_at
    FROM order_instruction_versions version
    WHERE version.instruction_id=?
    ORDER BY version.version_no DESC
  `).bind(instructionId).all<{
    instruction_version_id: string;
    instruction_id: string;
    version_no: number;
    reservation_id: string;
    product_id: string;
    product_version_id: string;
    product_version_no: number;
    main_image_file_entity_link_id: string;
    store_display_name_snapshot: string;
    demand_buyer_visible_notes_snapshot: string | null;
    staff_public_note: string | null;
    reference_order_amount_jpy: number;
    buyer_self_pay_bps: number;
    estimated_self_pay_jpy: number;
    estimated_refundable_principal_jpy: number;
    color_spec_mode: 'MAIN_IMAGE_VARIANT' | 'ANY_VARIANT';
    content_hash: string;
    generator_version: string;
    published_by_staff_id: string;
    published_at: number;
    initial_deadline_at: number;
    created_at: number;
  }>();
  return Object.freeze(rows.results.map((row) => Object.freeze({
    ...row,
    reference_order_amount_jpy: String(row.reference_order_amount_jpy),
    estimated_buyer_self_pay_jpy: String(row.estimated_self_pay_jpy),
    estimated_refundable_principal_jpy:
      String(row.estimated_refundable_principal_jpy),
  })));
}

async function requireCurrentVersion(
  database: SqlDatabase,
  instructionId: string,
  versionNo: number,
): Promise<CurrentVersionRow> {
  const row = await database.prepare(`
    SELECT
      version.id AS instruction_version_id,
      version.version_no,
      product_version.product_name,
      product_version.search_keywords_json,
      version.reference_order_amount_jpy,
      version.buyer_self_pay_bps,
      version.estimated_self_pay_jpy,
      version.estimated_refundable_principal_jpy,
      version.store_display_name_snapshot,
      version.demand_buyer_visible_notes_snapshot,
      version.staff_public_note,
      version.color_spec_mode,
      version.main_image_file_entity_link_id,
      object.id AS main_image_file_object_id,
      object.detected_mime AS main_image_mime,
      NULL AS main_image_width,
      NULL AS main_image_height,
      version.published_at
    FROM order_instruction_versions version
    JOIN product_versions product_version
      ON product_version.id=version.product_version_id
    JOIN file_entity_links link
      ON link.id=version.main_image_file_entity_link_id
      AND link.entity_type='ORDER_INSTRUCTION_VERSION'
      AND link.entity_id=version.id
      AND link.revoked_at IS NULL
    JOIN file_objects object
      ON object.id=link.file_object_id
      AND object.status='VERIFIED'
    WHERE version.instruction_id=? AND version.version_no=?
  `).bind(instructionId, versionNo).first<CurrentVersionRow>();
  if (!row) throw new OrderInstructionError('INSTRUCTION_NOT_PUBLISHED', 409);
  return row;
}

async function listKeywordImages(
  database: SqlDatabase,
  instructionVersionId: string,
): Promise<readonly KeywordImageRow[]> {
  const rows = await database.prepare(`
    SELECT id AS image_id, keyword_position, file_entity_link_id,
           file_object_id, image_mime, width, height
    FROM order_instruction_keyword_images
    WHERE order_instruction_version_id=?
    ORDER BY keyword_position
  `).bind(instructionVersionId).all<KeywordImageRow>();
  return rows.results;
}
