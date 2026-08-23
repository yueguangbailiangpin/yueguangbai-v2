import type { BuyerChatScreenshotReferenceDto, SqlDatabase } from '@ygb/contracts';

interface ScreenshotRow {
  entity_id: string;
  file_object_id: string;
  file_version: number;
}

/**
 * Active staff-only buyer-chat screenshots for the given formal orders.
 * INTERNAL_ONLY + EXPLICIT_AUDIENCES + STAFF_INTERNAL grants are the only
 * links this query recognizes, so buyer evidence files (BUYER_VISIBLE) and
 * seller-visible clones can never leak into the staff list.
 */
export async function listBuyerChatScreenshots(
  database: SqlDatabase,
  formalOrderIds: readonly string[],
): Promise<Map<string, BuyerChatScreenshotReferenceDto[]>> {
  const result = new Map<string, BuyerChatScreenshotReferenceDto[]>();
  if (formalOrderIds.length === 0) return result;
  const placeholders = formalOrderIds.map(() => '?').join(',');
  const rows = await database.prepare(`
    SELECT link.entity_id, link.file_object_id, object.version AS file_version
    FROM file_entity_links link
    JOIN file_objects object ON object.id=link.file_object_id
    WHERE link.entity_type='ORDER'
      AND link.entity_id IN (${placeholders})
      AND link.purpose='ORDER_EVIDENCE'
      AND link.visibility='INTERNAL_ONLY'
      AND link.authorization_mode='EXPLICIT_AUDIENCES'
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
      AND object.status='VERIFIED'
      AND object.purpose='ORDER_EVIDENCE'
      AND object.visibility='INTERNAL_ONLY'
    ORDER BY link.created_at, link.id
  `).bind(...formalOrderIds, Date.now()).all<ScreenshotRow>();
  for (const row of rows.results) {
    const current = result.get(row.entity_id) ?? [];
    current.push({
      file_object_id: row.file_object_id,
      file_version: Number(row.file_version),
      purpose: 'ORDER_EVIDENCE',
      visibility: 'INTERNAL_ONLY',
    });
    result.set(row.entity_id, current);
  }
  return result;
}
