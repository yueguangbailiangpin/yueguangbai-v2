import type {
  StagingImportPlan,
} from './staging-import-plan';

export interface StagingD1SqlOptions {
  actorStaffId: string;
  now: number;
  batchId: string;
}

export interface StagingD1SqlOutput {
  sql: string;
  statementCount: number;
  amazonStandardProductCount: number;
  rakutenIdentityCount: number;
  sellerOrganizationCount: number;
  sellerStoreCount: number;
  offeringCount: number;
  legacyProductCount: number;
  reservationTaskCount: number;
}

/**
 * Emits executable-but-unexecuted D1 SQL. Stable imported seller identities
 * intentionally do not consume seller_channels.next_sequence; the stable
 * seller_code and reserved high seller_sequence range are the idempotency
 * boundary for this import family.
 */
export async function emitStagingD1Sql(
  plan: StagingImportPlan,
  options: StagingD1SqlOptions,
): Promise<StagingD1SqlOutput> {
  if (!plan || plan.status !== 'LOCAL_READONLY_PLAN') throw new Error('INVALID_PLAN');
  if (!options.actorStaffId || !options.batchId || !Number.isSafeInteger(options.now)
    || options.now < 0) throw new Error('INVALID_SQL_OPTIONS');
  const q = statement;
  const lines: string[] = [
    '-- LOCAL-ONLY GENERATED SQL. NOT EXECUTED BY THIS EMITTER.',
    '-- Idempotency: INSERT OR IGNORE + stable IDs. No seller channel sequence update.',
    '-- seller_channels are pre-existing; this plan references them and never mutates sequence state.',
    q(`INSERT OR IGNORE INTO seller_partner_import_batches (
  id, manifest_hash, status, actor_staff_id, source_count, valid_count,
  quarantined_count, organization_count, standard_product_count, offering_count,
  created_at, committed_at, rolled_back_at
) VALUES (${sql(options.batchId)}, ${sql(plan.sourceManifestHash)}, 'COMMITTED', ${sql(options.actorStaffId)},
  ${plan.counts.currentStandardProducts}, ${plan.counts.currentStandardProducts}, 0,
  ${plan.sellerOrganizations.length}, ${plan.counts.legacyRuntimeProducts},
  ${plan.sellerProductOfferings.length}, ${options.now}, ${options.now}, NULL);`),
  ];

  const organizations = [...plan.sellerOrganizations].sort((a, b) =>
    a.organizationKey.localeCompare(b.organizationKey));
  for (const [index, organization] of organizations.entries()) {
    const sellerCode = `staging-${hashFragment(organization.organizationKey)}`;
    const subjectId = `staging-subject-${hashFragment(organization.organizationKey)}`;
    const memberId = `staging-member-${hashFragment(organization.organizationKey)}`;
    const claimId = `staging-claim-${hashFragment(organization.organizationKey)}`;
    const channelId = `seller-channel-${organization.channelCode}`;
    const store = plan.sellerStores.find((item) =>
      item.organizationKey === organization.organizationKey)!;
    lines.push(q(`INSERT OR IGNORE INTO customer_identity_subjects
  (id, subject_type, created_at)
  VALUES (${sql(subjectId)}, 'SELLER_ORG_MEMBER', ${options.now});`));
    lines.push(q(`INSERT OR IGNORE INTO wechat_identity_claims
  (id, identity_subject_id, display_wechat, normalized_wechat, status, version,
   acquired_at, reserved_at, released_at, created_at, updated_at, identity_subject_type)
  VALUES (${sql(claimId)}, ${sql(subjectId)}, ${sql(organization.sellerWechat)}, ${sql(organization.sellerWechat)},
   'ACTIVE', 1, ${options.now}, NULL, NULL, ${options.now}, ${options.now}, 'SELLER_ORG_MEMBER');`));
    lines.push(q(`INSERT OR IGNORE INTO seller_organizations
  (id, marketplace_code, seller_code, origin_channel_id, current_channel_id,
   seller_sequence, organization_name, status, version, created_at, updated_at,
   activated_at, disabled_at)
  VALUES (${sql(organization.sellerOrganizationId)}, 'AMAZON_JP', ${sql(sellerCode)}, ${sql(channelId)}, ${sql(channelId)},
   ${1_000_000 + index}, ${sql(organization.sellerWechat)}, 'ACTIVE', 1, ${options.now},
   ${options.now}, ${options.now}, NULL);`));
    lines.push(q(`INSERT OR IGNORE INTO seller_organization_members
  (id, identity_subject_id, organization_id, member_number, username_fallback,
   display_name, role, primary_owner, status, version, created_at, updated_at,
   activated_at, disabled_at)
  VALUES (${sql(memberId)}, ${sql(subjectId)}, ${sql(organization.sellerOrganizationId)}, 1,
   ${sql(sellerCode + ':owner')}, ${sql(organization.sellerWechat)}, 'OWNER', 1, 'ACTIVE', 1,
   ${options.now}, ${options.now}, ${options.now}, NULL);`));
    lines.push(q(`INSERT OR IGNORE INTO seller_stores
  (id, organization_id, marketplace_code, display_name, normalized_name, status,
   version, created_at, updated_at, disabled_at)
  VALUES (${sql(store.sellerStoreId)}, ${sql(organization.sellerOrganizationId)}, 'AMAZON_JP',
   ${sql(store.displayName)}, ${sql(store.normalizedName)}, 'ACTIVE', 1, ${options.now},
   ${options.now}, NULL);`));
  }

  for (const product of plan.standardProducts.filter((item) => item.marketplaceCode === 'JP_AMAZON')) {
    lines.push(q(`INSERT OR IGNORE INTO standard_products
  (id, marketplace_code, asin_display, asin_normalized, canonical_name, canonical_url,
   status, source_batch_id, created_at, updated_at)
  VALUES (${sql(product.standardProductId)}, 'AMAZON_JP', ${sql(product.platformProductIdentifier)},
   ${sql(product.platformProductIdentifier)}, ${sql(product.productName)}, NULL, 'ACTIVE',
   ${sql(options.batchId)}, ${options.now}, ${options.now});`));
  }
  for (const offering of plan.sellerProductOfferings) {
    if (offering.marketplaceCode !== 'AMAZON_JP') continue;
    lines.push(q(`INSERT OR IGNORE INTO seller_product_offerings
  (id, standard_product_id, seller_organization_id, seller_store_id, marketplace_code,
   status, cooperation_status, source_reservable, source_batch_id, created_at, updated_at)
  VALUES (${sql(offering.offeringId)}, ${sql(offering.standardProductId)}, ${sql(offering.sellerOrganizationId)},
   ${sql(offering.sellerStoreId)}, 'AMAZON_JP', 'ACTIVE', 'CURRENT', 1, ${sql(options.batchId)},
   ${options.now}, ${options.now});`));
    lines.push(q(`INSERT OR IGNORE INTO product_reservation_openings
  (offering_id, status, eligibility_reason, source_batch_id, created_at, updated_at)
  VALUES (${sql(offering.offeringId)}, 'OPEN', 'CURRENT_COOPERATION_AND_RESERVABLE',
   ${sql(options.batchId)}, ${options.now}, ${options.now});`));
  }
  const openProductIds = new Set(plan.openProductSellerMappings.map((item) => item.productId));
  for (const product of plan.standardProducts.filter((item) =>
    item.marketplaceCode === 'JP_AMAZON' && item.productId && openProductIds.has(item.productId))) {
    const version = plan.productVersions.find((item) => item.productId === product.productId)!;
    lines.push(q(`INSERT OR IGNORE INTO products
  (id, organization_id, store_id, marketplace_code, asin_display, asin_normalized,
   status, current_version_no, version, created_at, updated_at, disabled_at)
  SELECT ${sql(product.productId)}, offering.seller_organization_id, offering.seller_store_id,
   'AMAZON_JP', ${sql(product.platformProductIdentifier)}, ${sql(product.platformProductIdentifier)},
   'ACTIVE', 1, 1, ${options.now}, ${options.now}, NULL
  FROM seller_product_offerings offering
  WHERE offering.standard_product_id=${sql(product.standardProductId)}
    AND offering.source_batch_id=${sql(options.batchId)}
  LIMIT 1;`));
  lines.push(q(`INSERT OR IGNORE INTO product_versions
  (id, product_id, version_no, product_name, search_keywords_json, product_url,
   buyer_visible_notes, internal_notes, created_by_staff_id, created_at,
   ordering_guide_expected_amount_jpy, color_spec_mode, default_buyer_self_pay_bps,
   order_interval_days, orders_per_run)
  VALUES (${sql(version.productVersionId)}, ${sql(product.productId)}, 1, ${sql(version.productName)},
   ${sql(version.searchKeywordsJson)}, NULL, ${sql(version.buyerVisibleNotes)},
   ${sql(version.internalNotes)}, ${sql(options.actorStaffId)}, ${options.now},
   0, 'ANY_VARIANT', 0, 1, 1);`));
    const productOffering = plan.sellerProductOfferings.find((item) =>
      item.standardProductId === product.standardProductId)!;
    lines.push(q(`INSERT OR IGNORE INTO product_events
  (id, product_id, organization_id, store_id, event_type, product_version_no,
   actor_staff_id, previous_state_json, next_state_json, idempotency_key, created_at)
  VALUES (${sql(product.productId + '-created')}, ${sql(product.productId)},
   ${sql(productOffering.sellerOrganizationId)}, ${sql(productOffering.sellerStoreId)},
   'PRODUCT_CREATED', 1, ${sql(options.actorStaffId)}, NULL,
   ${sql(JSON.stringify({ status: 'ACTIVE', asin: product.platformProductIdentifier }))},
   ${sql(options.batchId + ':' + product.productId)}, ${options.now});`));
    lines.push(q(`INSERT OR IGNORE INTO audit_events
  (id, aggregate_type, aggregate_id, event_type, actor_type, actor_id,
   actor_roles_json, request_id, idempotency_key, previous_state_json, next_state_json,
   reason, metadata_json, created_at)
  VALUES (${sql(product.productId + '-created-audit')}, 'PRODUCT', ${sql(product.productId)},
   'STAGING_IMPORT_PRODUCT_CREATED', 'STAFF', ${sql(options.actorStaffId)}, '[]', NULL,
   ${sql(options.batchId + ':' + product.productId)}, NULL,
   ${sql(JSON.stringify({ status: 'ACTIVE' }))}, 'STAGING_IMPORT',
   ${sql(JSON.stringify({ planHash: plan.planHash }))}, ${options.now});`));
  }
  for (const task of plan.runtimePlans) {
    const offering = plan.sellerProductOfferings.find((item) => item.offeringId === task.offeringId)!;
    const memberId = `staging-member-${hashFragment(task.organizationKey)}`;
    lines.push(q(`INSERT OR IGNORE INTO demand_batches
  (id, organization_id, store_id, marketplace_code, product_id, product_version_no,
   submitted_by_member_id, task_type, target_quantity, buyer_visible_notes, seller_notes,
   open_at, reservation_deadline, order_deadline, status, review_reason, close_reason,
   reviewed_by_staff_id, closed_by_staff_id, version, submitted_at, updated_at,
   reviewed_at, published_at, withdrawn_at, closed_at, buyer_self_pay_bps_snapshot,
   buyer_self_pay_source, buyer_self_pay_override_reason)
  VALUES (${sql(task.demandBatchId)}, ${sql(offering.sellerOrganizationId)}, ${sql(offering.sellerStoreId)}, 'AMAZON_JP',
   ${sql(task.productId)}, 1, ${sql(memberId)}, ${sql(task.taskType)}, ${task.targetQuantity},
   ${sql(task.buyerVisibleNotes)}, ${sql(task.sellerNotes)}, ${task.openAt},
   ${task.reservationDeadline}, ${task.orderDeadline}, 'PUBLISHED', NULL, NULL,
   ${sql(options.actorStaffId)}, NULL, 1, ${options.now}, ${options.now}, ${options.now},
   ${options.now}, NULL, NULL, 0, 'PRODUCT_DEFAULT', NULL);`));
    lines.push(q(`INSERT OR IGNORE INTO demand_batch_events
  (id, demand_batch_id, organization_id, store_id, product_id, event_type, actor_type,
   actor_id, previous_status, next_status, demand_version, reason, idempotency_key, created_at)
  VALUES (${sql(task.demandBatchId + '-published')}, ${sql(task.demandBatchId)}, ${sql(offering.sellerOrganizationId)},
   ${sql(offering.sellerStoreId)}, ${sql(task.productId)}, 'DEMAND_BATCH_PUBLISHED', 'STAFF',
   ${sql(options.actorStaffId)}, 'SUBMITTED', 'PUBLISHED', 1, 'STAGING_IMPORT',
   ${sql(options.batchId + ':' + task.taskId)}, ${options.now});`));
    lines.push(q(`INSERT OR IGNORE INTO audit_events
  (id, aggregate_type, aggregate_id, event_type, actor_type, actor_id,
   actor_roles_json, request_id, idempotency_key, previous_state_json, next_state_json,
   reason, metadata_json, created_at)
  VALUES (${sql(task.taskId + '-audit')}, 'DEMAND_BATCH', ${sql(task.demandBatchId)},
   'STAGING_IMPORT_PUBLISHED', 'STAFF', ${sql(options.actorStaffId)}, '[]', NULL,
   ${sql(options.batchId + ':' + task.taskId)}, NULL, ${sql(JSON.stringify({ status: 'PUBLISHED' }))},
   'STAGING_IMPORT', ${sql(JSON.stringify({ sourceRow: task.sourceRow, planHash: plan.planHash }))},
   ${options.now});`));
  }
  return {
    sql: lines.join('\n'),
    statementCount: lines.filter((line) => /^INSERT OR IGNORE/u.test(line.trim())).length,
    amazonStandardProductCount: plan.counts.legacyRuntimeProducts,
    rakutenIdentityCount: 0,
    sellerOrganizationCount: organizations.length,
    sellerStoreCount: plan.sellerStores.length,
    offeringCount: plan.sellerProductOfferings.filter((item) => item.marketplaceCode === 'AMAZON_JP').length,
    legacyProductCount: openProductIds.size,
    reservationTaskCount: plan.runtimePlans.length,
  };
}

function sql(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function statement(value: string): string {
  return value;
}

function hashFragment(value: string): string {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
