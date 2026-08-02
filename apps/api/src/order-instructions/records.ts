import type { SqlDatabase } from '@ygb/contracts';
import { OrderInstructionError } from './shared';

export interface InstructionContextRow {
  instruction_id: string;
  reservation_id: string;
  buyer_customer_id: string;
  marketplace_code: 'JP';
  instruction_status: 'UNPUBLISHED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'COMPLETED';
  current_version_no: number;
  instruction_version: number;
  published_at: number | null;
  initial_deadline_at: number | null;
  resubmission_deadline_at: number | null;
  expired_at: number | null;
  cancelled_at: number | null;
  completed_at: number | null;
  reservation_status: string;
  reservation_version: number;
  demand_batch_id: string;
  demand_version: number;
  approved_reservation_count: number;
  order_deadline: number;
  product_id: string;
  product_version_no: number;
  product_version_id: string;
  product_name: string;
  search_keywords_json: string;
  ordering_guide_expected_amount_jpy: number | null;
  color_spec_mode: 'MAIN_IMAGE_VARIANT' | 'ANY_VARIANT' | null;
  buyer_self_pay_bps_snapshot: number;
  reference_order_amount_jpy_snapshot: number;
  estimated_self_pay_jpy_snapshot: number;
  estimated_refundable_principal_jpy_snapshot: number;
  store_display_name: string;
  buyer_visible_notes: string | null;
  evidence_submission_id: string | null;
  evidence_status: string | null;
  evidence_version_count: number;
  formal_order_id: string | null;
}

export async function requireInstructionContext(
  database: SqlDatabase,
  instructionId: string,
): Promise<InstructionContextRow> {
  const row = await database.prepare(`
    SELECT
      instruction.id AS instruction_id,
      instruction.reservation_id,
      instruction.buyer_customer_id,
      instruction.marketplace_code,
      instruction.status AS instruction_status,
      instruction.current_version_no,
      instruction.version AS instruction_version,
      instruction.published_at,
      instruction.initial_deadline_at,
      instruction.resubmission_deadline_at,
      instruction.expired_at,
      instruction.cancelled_at,
      instruction.completed_at,
      reservation.status AS reservation_status,
      reservation.version AS reservation_version,
      reservation.demand_batch_id,
      demand.version AS demand_version,
      demand.approved_reservation_count,
      demand.order_deadline,
      reservation.product_id,
      reservation.product_version_no,
      product_version.id AS product_version_id,
      product_version.product_name,
      product_version.search_keywords_json,
      product_version.ordering_guide_expected_amount_jpy,
      product_version.color_spec_mode,
      reservation.buyer_self_pay_bps_snapshot,
      reservation.reference_order_amount_jpy_snapshot,
      reservation.estimated_self_pay_jpy_snapshot,
      reservation.estimated_refundable_principal_jpy_snapshot,
      store.display_name AS store_display_name,
      demand.buyer_visible_notes,
      evidence.id AS evidence_submission_id,
      evidence.status AS evidence_status,
      (SELECT COUNT(*) FROM order_evidence_versions version
       WHERE version.reservation_id=reservation.id) AS evidence_version_count,
      formal_order.id AS formal_order_id
    FROM order_instructions instruction
    JOIN product_reservations reservation
      ON reservation.id=instruction.reservation_id
    JOIN demand_batches demand
      ON demand.id=reservation.demand_batch_id
    JOIN product_versions product_version
      ON product_version.product_id=reservation.product_id
      AND product_version.version_no=reservation.product_version_no
    JOIN seller_stores store
      ON store.id=reservation.store_id
    LEFT JOIN order_evidence_submissions evidence
      ON evidence.reservation_id=reservation.id
    LEFT JOIN formal_orders formal_order
      ON formal_order.reservation_id=reservation.id
    WHERE instruction.id=?
  `).bind(instructionId).first<InstructionContextRow>();
  if (!row) throw new OrderInstructionError('NOT_FOUND', 404);
  return row;
}

export async function requireInstructionContextForReservation(
  database: SqlDatabase,
  reservationId: string,
  buyerCustomerId?: string,
): Promise<InstructionContextRow> {
  const row = await database.prepare(`
    SELECT instruction.id AS instruction_id
    FROM order_instructions instruction
    WHERE instruction.reservation_id=?
      AND (? IS NULL OR instruction.buyer_customer_id=?)
  `).bind(
    reservationId,
    buyerCustomerId ?? null,
    buyerCustomerId ?? null,
  ).first<{ instruction_id: string }>();
  if (!row) throw new OrderInstructionError('NOT_FOUND', 404);
  return requireInstructionContext(database, row.instruction_id);
}

export async function requireMainImage(
  database: SqlDatabase,
  productVersionId: string,
): Promise<{
  file_object_id: string;
  source_link_id: string;
  sha256: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  status: string;
}> {
  const row = await database.prepare(`
    SELECT
      link.file_object_id AS file_object_id,
      link.id AS source_link_id,
      object.uploaded_sha256 AS sha256,
      object.detected_mime AS mime,
      object.status
    FROM product_version_main_images image
    JOIN file_entity_links link
      ON link.id=image.file_entity_link_id
      AND link.entity_type='PRODUCT_VERSION'
      AND link.entity_id=image.product_version_id
      AND link.purpose='PRODUCT_IMAGE'
      AND link.revoked_at IS NULL
    JOIN file_objects object
      ON object.id=link.file_object_id
    WHERE image.product_version_id=?
      AND object.status='VERIFIED'
    ORDER BY image.created_at DESC
    LIMIT 1
  `).bind(productVersionId).first<{
    file_object_id: string;
    source_link_id: string;
    sha256: string;
    mime: 'image/jpeg' | 'image/png' | 'image/webp';
    status: string;
  }>();
  if (!row) throw new OrderInstructionError('MAIN_IMAGE_REQUIRED', 409);
  return row;
}

export function parseOrderedKeywords(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)
      || parsed.length < 1
      || parsed.some((item) => typeof item !== 'string'
        || item.trim().length < 1)) {
      throw new Error('invalid');
    }
    return Object.freeze(parsed.map((item) => item.normalize('NFKC').trim()));
  } catch {
    throw new OrderInstructionError('KEYWORDS_REQUIRED', 409);
  }
}
