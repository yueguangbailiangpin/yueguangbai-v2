import type { HistoricalSellerDirectoryPlan } from './index';

export interface HistoricalSellerStagingSqlOptions {
  actorStaffId: string;
  now: number;
}

export function emitHistoricalSellerStagingSql(
  plan: HistoricalSellerDirectoryPlan,
  options: HistoricalSellerStagingSqlOptions,
): string {
  if (!Number.isSafeInteger(options.now) || options.now < 0 || !options.actorStaffId) {
    throw new Error('INVALID_SQL_OPTIONS');
  }
  const statements: string[] = [
    '-- Generated from the four frozen Tencent folder inventories. Tencent Docs are read-only.',
    '-- Historical seller organizations are exempt from new-customer reporting.',
    'PRAGMA foreign_keys = ON;',
  ];
  for (const [index, customer] of plan.customers.entries()) {
    const subjectId = `historical-seller-subject-${fragment(customer.normalizedWechat)}`;
    const claimId = `historical-seller-claim-${fragment(customer.normalizedWechat)}`;
    const memberId = `historical-seller-member-${fragment(customer.normalizedWechat)}`;
    const channelId = `seller-channel-${customer.channelCode}`;
    const sequence = 2_000_000 + index;
    const existing = `EXISTS(
      SELECT 1 FROM wechat_identity_claims existing_claim
      JOIN seller_organization_members existing_member
        ON existing_member.identity_subject_id=existing_claim.identity_subject_id
       AND existing_member.status='ACTIVE'
      JOIN seller_organizations existing_org
        ON existing_org.id=existing_member.organization_id
       AND existing_org.status='ACTIVE'
      WHERE lower(existing_claim.normalized_wechat)=${sql(customer.normalizedWechat)}
        AND existing_claim.status='ACTIVE'
    )`;
    statements.push(`INSERT OR IGNORE INTO customer_identity_subjects(
      id,subject_type,created_at
    ) SELECT ${sql(subjectId)},'SELLER_ORG_MEMBER',${options.now}
      WHERE NOT ${existing};`);
    statements.push(`INSERT OR IGNORE INTO wechat_identity_claims(
      id,identity_subject_id,display_wechat,normalized_wechat,status,version,
      acquired_at,reserved_at,released_at,created_at,updated_at,identity_subject_type
    ) SELECT ${sql(claimId)},${sql(subjectId)},${sql(customer.displayWechat)},
      ${sql(customer.normalizedWechat)},'ACTIVE',1,${options.now},NULL,NULL,
      ${options.now},${options.now},'SELLER_ORG_MEMBER'
      WHERE NOT ${existing};`);
    statements.push(`INSERT OR IGNORE INTO seller_organizations(
      id,marketplace_code,seller_code,origin_channel_id,current_channel_id,
      seller_sequence,organization_name,status,version,created_at,updated_at,
      activated_at,disabled_at,next_member_number
    ) SELECT ${sql(customer.organizationId)},'AMAZON_JP',${sql(customer.sellerCode)},
      ${sql(channelId)},${sql(channelId)},${sequence},${sql(customer.displayWechat)},
      'ACTIVE',1,${options.now},${options.now},${options.now},NULL,2
      WHERE NOT ${existing};`);
    statements.push(`INSERT OR IGNORE INTO seller_organization_members(
      id,identity_subject_id,organization_id,member_number,username_fallback,
      display_name,role,primary_owner,status,version,created_at,updated_at,
      activated_at,disabled_at
    ) SELECT ${sql(memberId)},${sql(subjectId)},${sql(customer.organizationId)},1,
      ${sql(`${customer.sellerCode}:owner`)},${sql(customer.displayWechat)},
      'OWNER',1,'ACTIVE',1,${options.now},${options.now},${options.now},NULL
      WHERE NOT ${existing};`);
  }
  return statements.join('\n');
}

function fragment(value: string): string {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
