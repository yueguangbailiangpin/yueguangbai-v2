import type { SqlDatabase } from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import { FROZEN_HISTORICAL_SELLER_PRODUCTS } from './frozen-historical-seller-products';

interface HistoricalSellerDirectoryRow {
  organization_id: string;
  organization_name: string;
  marketplace_code: string;
  seller_code: string;
  display_wechat: string;
  normalized_wechat: string;
  account_id: string | null;
  historical_reason: string | null;
  active_offering_count: number;
}

export async function listHistoricalSellerDirectory(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
) {
  if (!actor.roles.has('owner') && !actor.roles.has('seller_ops')) {
    throw new Error('FORBIDDEN');
  }
  const markets = actor.roles.has('owner')
    ? null
    : await resolveStaffMarketplaceCodes(database, actor);
  if (markets !== null && markets.length === 0) return Object.freeze([]);
  const marketplaceWhere = markets === null
    ? ''
    : `AND CASE organization.marketplace_code WHEN 'JP' THEN 'AMAZON_JP'
         ELSE organization.marketplace_code END IN (${markets.map(() => '?').join(',')})`;
  const rows = await database.prepare(`SELECT
      organization.id AS organization_id,
      organization.organization_name,
      organization.marketplace_code,
      organization.seller_code,
      (SELECT claim.display_wechat
       FROM seller_organization_members member
       JOIN wechat_identity_claims claim
         ON claim.identity_subject_id=member.identity_subject_id
        AND claim.status='ACTIVE'
       WHERE member.organization_id=organization.id AND member.status='ACTIVE'
       ORDER BY member.primary_owner DESC,member.member_number,member.id LIMIT 1) AS display_wechat,
      (SELECT claim.normalized_wechat
       FROM seller_organization_members member
       JOIN wechat_identity_claims claim
         ON claim.identity_subject_id=member.identity_subject_id
        AND claim.status='ACTIVE'
       WHERE member.organization_id=organization.id AND member.status='ACTIVE'
       ORDER BY member.primary_owner DESC,member.member_number,member.id LIMIT 1) AS normalized_wechat,
      (SELECT account.id
       FROM seller_organization_members member
       JOIN customer_account_personas persona
         ON persona.seller_member_id=member.id AND persona.persona_type='SELLER_MEMBER'
       JOIN customer_login_accounts account
         ON account.id=persona.account_id AND account.status='ACTIVE'
       WHERE member.organization_id=organization.id AND member.status='ACTIVE'
       ORDER BY member.primary_owner DESC,member.member_number,member.id LIMIT 1) AS account_id,
      (SELECT exemption.reason
       FROM acquisition_historical_source_exemptions exemption
       WHERE exemption.subject_type='SELLER_ORGANIZATION'
         AND exemption.subject_id=organization.id
       ORDER BY exemption.declared_at,exemption.id LIMIT 1) AS historical_reason,
      (SELECT COUNT(*) FROM seller_product_offerings offering
       WHERE offering.seller_organization_id=organization.id
         AND offering.status='ACTIVE') AS active_offering_count
    FROM seller_organizations organization
    WHERE organization.status='ACTIVE'
      AND EXISTS(
        SELECT 1 FROM seller_organization_members member
        JOIN wechat_identity_claims claim
          ON claim.identity_subject_id=member.identity_subject_id
         AND claim.status='ACTIVE'
        WHERE member.organization_id=organization.id AND member.status='ACTIVE'
      )
      ${marketplaceWhere}
    ORDER BY lower(normalized_wechat),organization.id`).bind(...(markets ?? []))
    .all<HistoricalSellerDirectoryRow>();
  return Object.freeze(rows.results.map((row) => {
    const canonicalMarketplace = row.marketplace_code === 'JP'
      ? 'AMAZON_JP'
      : row.marketplace_code;
    const historical = row.historical_reason !== null;
    const sourceCount = historical
      ? Number(/(?:^|;)SOURCE_FILES=(\d+)(?:;|$)/u.exec(row.historical_reason ?? '')?.[1] ?? 0)
      : 0;
    const productNames = FROZEN_HISTORICAL_SELLER_PRODUCTS[
      row.normalized_wechat.toLocaleLowerCase('en-US') as keyof typeof FROZEN_HISTORICAL_SELLER_PRODUCTS
    ] ?? Object.freeze([]);
    return Object.freeze({
      seller_organization_id: row.organization_id,
      seller_code: row.seller_code,
      display_name: row.organization_name,
      wechat_masked: row.display_wechat,
      marketplace_code: canonicalMarketplace,
      source_status: historical ? 'HISTORICAL_FROZEN_IMPORT' as const : 'CURRENT_OR_NEW' as const,
      source_file_count: sourceCount,
      product_names: productNames,
      active_offering_count: Number(row.active_offering_count),
      has_portal_account: row.account_id !== null,
    });
  }));
}
