import type { SqlDatabase } from '@ygb/contracts';
import { cleanFileIdentifier } from '../files/file-records';
import { SellerFormalOrderPortalError } from '../seller-formal-orders/errors';
import type { SellerPortalActor } from '../seller-portal/actor';

export interface SellerOrderChatScreenshotAccess {
  formalOrderId: string;
  fileObjectId: string;
  fileEntityLinkId: string;
  fileVersion: number;
}

interface SellerOrderChatScreenshotAccessRow {
  formal_order_id: string;
  seller_store_id: string;
  file_object_id: string;
  file_entity_link_id: string;
  file_version: number;
}

export async function requireSellerOrderChatScreenshot(
  database: SqlDatabase,
  actor: SellerPortalActor,
  formalOrderId: string,
  now = Date.now(),
): Promise<SellerOrderChatScreenshotAccess> {
  const id = cleanFileIdentifier(formalOrderId, 120);
  const scope = actor.allActiveStores
    ? { sql: '', values: [] as readonly unknown[] }
    : actor.storeIds.length === 0
      ? { sql: 'AND 1=0', values: [] as readonly unknown[] }
      : {
          sql: `AND formal_order.seller_store_id IN (${actor.storeIds.map(() => '?').join(', ')})`,
          values: actor.storeIds as readonly unknown[],
        };
  const row = await database.prepare(`
    WITH screenshot_candidate AS (
      SELECT
        formal_order.id AS formal_order_id,
        formal_order.seller_organization_id,
        formal_order.store_id AS seller_store_id,
        formal_order.order_evidence_submission_id AS evidence_entity_id,
        attachment.file_object_id,
        attachment.file_entity_link_id
      FROM formal_orders formal_order
      JOIN order_evidence_internal_files attachment
        ON attachment.order_evidence_submission_id=
          formal_order.order_evidence_submission_id
        AND attachment.slot=1
      WHERE formal_order.status='CONFIRMED'
    )
    SELECT
      formal_order.formal_order_id,
      formal_order.seller_store_id,
      file_object.id AS file_object_id,
      file_object.version AS file_version,
      file_link.id AS file_entity_link_id
    FROM screenshot_candidate formal_order
    JOIN seller_organizations organization
      ON organization.id=formal_order.seller_organization_id
      AND organization.status='ACTIVE'
    JOIN seller_stores store
      ON store.id=formal_order.seller_store_id
      AND store.organization_id=formal_order.seller_organization_id
      AND store.status='ACTIVE'
    JOIN file_entity_links file_link
      ON file_link.id=formal_order.file_entity_link_id
      AND file_link.file_object_id=formal_order.file_object_id
      AND file_link.entity_type='ORDER_EVIDENCE_SUBMISSION'
      AND file_link.entity_id=formal_order.evidence_entity_id
      AND file_link.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
      AND file_link.visibility='SELLER_VISIBLE'
      AND file_link.authorization_mode='EXPLICIT_AUDIENCES'
      AND file_link.revoked_at IS NULL
      AND (file_link.expires_at IS NULL OR file_link.expires_at>?)
    JOIN file_objects file_object
      ON file_object.id=formal_order.file_object_id
      AND file_object.status='VERIFIED'
      AND file_object.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
      AND file_object.visibility='SELLER_VISIBLE'
      AND file_object.detected_mime IN ('image/jpeg','image/png','image/webp')
    JOIN file_upload_intents upload_intent
      ON upload_intent.id=file_object.upload_intent_id
      AND upload_intent.status='VERIFIED'
      AND upload_intent.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
      AND upload_intent.visibility='SELLER_VISIBLE'
    JOIN file_entity_audience_grants grant
      ON grant.file_entity_link_id=file_link.id
      AND grant.subject_type='SELLER_ORGANIZATION'
      AND grant.seller_organization_id=formal_order.seller_organization_id
      AND grant.revoked_at IS NULL
      AND (grant.expires_at IS NULL OR grant.expires_at>?)
    WHERE formal_order.formal_order_id=?
      AND formal_order.seller_organization_id=?
      ${scope.sql}
  `).bind(now, now, id, actor.sellerOrganizationId, ...scope.values)
    .first<SellerOrderChatScreenshotAccessRow>();
  if (!row) {
    throw new SellerFormalOrderPortalError('FORMAL_ORDER_NOT_FOUND', 404);
  }
  if (actor.role !== 'OWNER') {
    const scoped = await database.prepare(`
      SELECT 1 AS allowed
      FROM seller_member_store_scopes
      WHERE member_id=?
        AND organization_id=?
        AND store_id=?
        AND status='ACTIVE'
        AND revoked_at IS NULL
    `).bind(actor.memberId, actor.sellerOrganizationId, row.seller_store_id)
      .first<{ allowed: number }>();
    if (Number(scoped?.allowed) !== 1) {
      throw new SellerFormalOrderPortalError('FORMAL_ORDER_NOT_FOUND', 404);
    }
  }
  return {
    formalOrderId: row.formal_order_id,
    fileObjectId: row.file_object_id,
    fileEntityLinkId: row.file_entity_link_id,
    fileVersion: Number(row.file_version),
  };
}
