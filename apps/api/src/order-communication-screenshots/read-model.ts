import type {
  OrderCommunicationScreenshotReferenceDto,
  SqlDatabase,
} from '@ygb/contracts';
import { cleanFileIdentifier } from '../files/file-records';
import { SellerFormalOrderPortalError } from '../seller-formal-orders/errors';
import type { SellerPortalActor } from '../seller-portal/actor';

interface ScreenshotRow {
  entity_id: string;
  file_object_id: string;
  file_version: number;
  uploaded_at: number;
  uploaded_by_staff_id: string | null;
  uploaded_by_staff_name: string | null;
}

/**
 * Active ORDER_COMMUNICATION_SCREENSHOT links for the given formal orders.
 * The query only recognizes ORDER entity links with the unified purpose and
 * a live SELLER_ORGANIZATION audience grant, so buyer evidence files and
 * other kinds can never leak into the list.
 */
export async function listOrderCommunicationScreenshots(
  database: SqlDatabase,
  formalOrderIds: readonly string[],
): Promise<Map<string, OrderCommunicationScreenshotReferenceDto[]>> {
  const result = new Map<string, OrderCommunicationScreenshotReferenceDto[]>();
  if (formalOrderIds.length === 0) return result;
  const placeholders = formalOrderIds.map(() => '?').join(',');
  const rows = await database.prepare(`
    SELECT link.entity_id, link.file_object_id, object.version AS file_version,
      object.uploaded_at AS uploaded_at,
      CASE
        WHEN upload_intent.owner_actor_type='STAFF'
          THEN upload_intent.owner_actor_id
        ELSE NULL
      END AS uploaded_by_staff_id,
      CASE
        WHEN upload_intent.owner_actor_type='STAFF'
          THEN staff.display_name
        ELSE NULL
      END AS uploaded_by_staff_name
    FROM file_entity_links link
    JOIN file_objects object ON object.id=link.file_object_id
    LEFT JOIN file_upload_intents upload_intent
      ON upload_intent.id=object.upload_intent_id
    LEFT JOIN staff_users staff
      ON staff.id=upload_intent.owner_actor_id
      AND upload_intent.owner_actor_type='STAFF'
    JOIN file_entity_audience_grants grant
      ON grant.file_entity_link_id=link.id
      AND grant.subject_type='SELLER_ORGANIZATION'
      AND grant.revoked_at IS NULL
      AND (grant.expires_at IS NULL OR grant.expires_at>?)
    WHERE link.entity_type='ORDER'
      AND link.entity_id IN (${placeholders})
      AND link.purpose='ORDER_COMMUNICATION_SCREENSHOT'
      AND link.visibility='SELLER_VISIBLE'
      AND link.authorization_mode='EXPLICIT_AUDIENCES'
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
      AND object.status='VERIFIED'
      AND object.purpose='ORDER_COMMUNICATION_SCREENSHOT'
      AND object.visibility='SELLER_VISIBLE'
    ORDER BY link.created_at, link.id
  `).bind(Date.now(), ...formalOrderIds, Date.now()).all<ScreenshotRow>();
  for (const row of rows.results) {
    const current = result.get(row.entity_id) ?? [];
    current.push({
      file_object_id: row.file_object_id,
      file_version: Number(row.file_version),
      purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
      visibility: 'SELLER_VISIBLE',
      uploaded_at: Number(row.uploaded_at),
      uploaded_by_staff_id: row.uploaded_by_staff_id,
      uploaded_by_staff_name: row.uploaded_by_staff_name,
    });
    result.set(row.entity_id, current);
  }
  return result;
}

export interface OrderCommunicationScreenshotAccess {
  formalOrderId: string;
  fileObjectId: string;
  fileEntityLinkId: string;
  fileVersion: number;
}

interface SellerAccessRow {
  formal_order_id: string;
  file_object_id: string;
  file_entity_link_id: string;
  file_version: number;
}

/**
 * Seller-portal access check (D-056 §4.1): any ACTIVE member of the order's
 * own seller organization may read its communication screenshots regardless
 * of store grant history; members of other organizations receive a
 * concealed 404.
 */
export async function requireOrderCommunicationScreenshotForSeller(
  database: SqlDatabase,
  actor: SellerPortalActor,
  formalOrderId: string,
  fileObjectId: string,
  now = Date.now(),
): Promise<OrderCommunicationScreenshotAccess> {
  const orderId = cleanFileIdentifier(formalOrderId, 120);
  const fileId = cleanFileIdentifier(fileObjectId, 120);
  const row = await database.prepare(`
    SELECT
      formal_order.id AS formal_order_id,
      file_link.file_object_id,
      file_link.id AS file_entity_link_id,
      file_object.version AS file_version
    FROM formal_orders formal_order
    JOIN seller_organizations organization
      ON organization.id=formal_order.seller_organization_id
      AND organization.status='ACTIVE'
    JOIN file_entity_links file_link
      ON file_link.entity_type='ORDER'
      AND file_link.entity_id=formal_order.id
      AND file_link.file_object_id=?
      AND file_link.purpose='ORDER_COMMUNICATION_SCREENSHOT'
      AND file_link.visibility='SELLER_VISIBLE'
      AND file_link.authorization_mode='EXPLICIT_AUDIENCES'
      AND file_link.revoked_at IS NULL
      AND (file_link.expires_at IS NULL OR file_link.expires_at>?)
    JOIN file_objects file_object
      ON file_object.id=file_link.file_object_id
      AND file_object.status='VERIFIED'
      AND file_object.purpose='ORDER_COMMUNICATION_SCREENSHOT'
      AND file_object.visibility='SELLER_VISIBLE'
    JOIN file_upload_intents upload_intent
      ON upload_intent.id=file_object.upload_intent_id
      AND upload_intent.status='VERIFIED'
    JOIN file_entity_audience_grants grant
      ON grant.file_entity_link_id=file_link.id
      AND grant.subject_type='SELLER_ORGANIZATION'
      AND grant.seller_organization_id=formal_order.seller_organization_id
      AND grant.revoked_at IS NULL
      AND (grant.expires_at IS NULL OR grant.expires_at>?)
    WHERE formal_order.id=?
      AND formal_order.seller_organization_id=?
  `).bind(fileId, now, now, orderId, actor.sellerOrganizationId)
    .first<SellerAccessRow>();
  if (!row) {
    throw new SellerFormalOrderPortalError('FORMAL_ORDER_NOT_FOUND', 404);
  }
  return {
    formalOrderId: row.formal_order_id,
    fileObjectId: row.file_object_id,
    fileEntityLinkId: row.file_entity_link_id,
    fileVersion: Number(row.file_version),
  };
}
