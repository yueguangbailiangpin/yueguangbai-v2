import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import {
  canonicalJson,
  normalizeAsin,
  normalizeWechatId,
  sha256Hex,
} from '@ygb/domain';

export const FROZEN_SOURCE_FOLDERS = {
  dJwldHrckeFY: 'ido-mango',
  dDUYsBOrYoEk: 'ygbceping',
  davLDVdZLoPV: 'yinghua1942',
  dhtkJdpmZEgh: 'yueguangbaiai',
} as const;

// Owner ruling 2026-09-01: yueguangbai (月光白) and ygbceping are the same
// account, so yueguangbai folds into ygbceping; yueguangbaiai (月光白AI) is a
// separate account and must never merge with either. idomango/dio/ygc/ygcceping
// are confirmed input aliases; the yinghua1942 and quesheng merges are confirmed.
export const CHANNEL_ALIASES = {
  ido: 'ido-mango',
  'ido-mango': 'ido-mango',
  idomango: 'ido-mango',
  dio: 'ido-mango',
  ygb: 'ygbceping',
  ygc: 'ygbceping',
  ygcceping: 'ygbceping',
  ygbceping: 'ygbceping',
  yueguangbai: 'ygbceping',
  yueguangbaiai: 'yueguangbaiai',
  yinghua1942: 'yinghua1942',
  yinghua1942ai: 'yinghua1942',
  queshengai: 'queshengai',
  quesheng520ai: 'queshengai',
} as const;

export type SellerChannelCode =
  typeof CHANNEL_ALIASES[keyof typeof CHANNEL_ALIASES];
export type CooperationStatus = 'CURRENT' | 'HISTORICAL' | 'UNKNOWN';

export interface SellerPartnerSourceRecord {
  sourceFolderId: string;
  sourceRecordId: string;
  sourceLocator: string;
  sellerWechat: string;
  channelAlias?: string | null;
  sourceSellerCode?: string | null;
  asin: string;
  productName: string;
  productUrl?: string | null;
  cooperationStatus?: CooperationStatus;
  currentReservable?: boolean;
}

export interface SellerPartnerSourceManifest {
  records: readonly SellerPartnerSourceRecord[];
}

export interface NormalizedSourceRecord {
  sourceFolderId: string;
  sourceRecordId: string;
  sourceLocator: string;
  sellerWechatDisplay: string;
  sellerWechatNormalized: string;
  sourceSellerCode: string | null;
  channelCode: SellerChannelCode | null;
  asinNormalized: string | null;
  productName: string | null;
  productUrl: string | null;
  cooperationStatus: CooperationStatus;
  sourceReservable: boolean;
  rowHash: string;
  status: 'VALID' | 'QUARANTINED';
  exceptionCode: string | null;
}

export interface SellerPartnerImportGroup {
  groupKey: string;
  organizationId: string;
  sourceFolderId: string;
  sellerWechatDisplay: string;
  sellerWechatNormalized: string;
  channelCode: SellerChannelCode;
  cooperationStatus: CooperationStatus;
  sourceReservable: boolean;
  records: readonly NormalizedSourceRecord[];
}

export interface SellerPartnerStandardProduct {
  asinNormalized: string;
  asinDisplay: string;
  canonicalName: string;
  canonicalUrl: string | null;
  records: readonly NormalizedSourceRecord[];
}

export interface SellerPartnerImportPlan {
  manifestHash: string;
  records: readonly NormalizedSourceRecord[];
  groups: readonly SellerPartnerImportGroup[];
  standardProducts: readonly SellerPartnerStandardProduct[];
  counts: {
    source: number;
    valid: number;
    quarantined: number;
    organizations: number;
    standardProducts: number;
    offerings: number;
  };
}

export interface SellerPartnerImportResult {
  batchId: string;
  manifestHash: string;
  replayed: boolean;
  sourceCount: number;
  validCount: number;
  quarantinedCount: number;
  organizationCount: number;
  standardProductCount: number;
  offeringCount: number;
  loginAccountsCreated: 0;
  externalMutations: 0;
}

export interface SellerPartnerRollbackResult {
  batchId: string;
  rolledBack: true;
  sourceTraceRetained: true;
  downstreamFactsChecked: true;
}

export async function previewSellerPartnerImport(
  manifest: SellerPartnerSourceManifest,
): Promise<SellerPartnerImportPlan> {
  if (!manifest || !Array.isArray(manifest.records)) {
    throw new SellerPartnerImportError('INVALID_MANIFEST');
  }

  const normalized: NormalizedSourceRecord[] = [];
  const seenSourceKeys = new Map<string, string>();
  const seenRowHashes = new Set<string>();

  for (const [index, input] of manifest.records.entries()) {
    let record: NormalizedSourceRecord;
    try {
      record = await normalizeSourceRecord(input);
    } catch (error) {
      record = await malformedSourceRecord(input, index, error);
    }
    const sourceKey = `${record.sourceFolderId}:${record.sourceRecordId}`;
    if (seenSourceKeys.has(sourceKey)) {
      record.status = 'QUARANTINED';
      record.exceptionCode = 'DUPLICATE_SOURCE_RECORD_ID';
      record.channelCode = null;
      record.asinNormalized = null;
    } else if (seenRowHashes.has(record.rowHash)) {
      record.status = 'QUARANTINED';
      record.exceptionCode = 'DUPLICATE_SOURCE_ROW';
      record.channelCode = null;
      record.asinNormalized = null;
    }
    seenSourceKeys.set(sourceKey, record.rowHash);
    seenRowHashes.add(record.rowHash);
    normalized.push(record);
  }

  const valid = normalized.filter((record) => record.status === 'VALID');
  const groupMap = new Map<string, NormalizedSourceRecord[]>();
  for (const record of valid) {
    const key = `${record.sourceFolderId}:${record.sellerWechatNormalized}`;
    const rows = groupMap.get(key) ?? [];
    rows.push(record);
    groupMap.set(key, rows);
  }

  const groups: SellerPartnerImportGroup[] = [];
  for (const [groupKey, rows] of [...groupMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = rows[0]!;
    groups.push({
      groupKey,
      organizationId: `seller-import-org-${await sha256Hex(groupKey)}`,
      sourceFolderId: first.sourceFolderId,
      sellerWechatDisplay: first.sellerWechatDisplay,
      sellerWechatNormalized: first.sellerWechatNormalized,
      channelCode: first.channelCode!,
      cooperationStatus: rows.some((row) => row.cooperationStatus === 'CURRENT')
        ? 'CURRENT'
        : rows.some((row) => row.cooperationStatus === 'UNKNOWN')
          ? 'UNKNOWN'
          : 'HISTORICAL',
      sourceReservable: rows.some((row) => row.sourceReservable),
      records: rows,
    });
  }

  const productMap = new Map<string, NormalizedSourceRecord[]>();
  for (const record of valid) {
    const rows = productMap.get(record.asinNormalized!) ?? [];
    rows.push(record);
    productMap.set(record.asinNormalized!, rows);
  }
  const standardProducts = [...productMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([asinNormalized, rows]) => ({
      asinNormalized,
      asinDisplay: rows[0]!.asinNormalized!,
      canonicalName: rows
        .map((row) => row.productName!)
        .sort((a, b) => a.localeCompare(b))[0]!,
      canonicalUrl: rows
        .map((row) => row.productUrl)
        .find((value): value is string => value !== null) ?? null,
      records: rows,
    }));

  const hashInput = normalized.map((record) => ({
    source_folder_id: record.sourceFolderId,
    source_record_id: record.sourceRecordId,
    source_locator: record.sourceLocator,
    seller_wechat_normalized: record.sellerWechatNormalized,
    source_seller_code: record.sourceSellerCode,
    channel_code: record.channelCode,
    asin_normalized: record.asinNormalized,
    product_name: record.productName,
    product_url: record.productUrl,
    cooperation_status: record.cooperationStatus,
    source_reservable: record.sourceReservable,
    status: record.status,
    exception_code: record.exceptionCode,
    row_hash: record.rowHash,
  }));
  const manifestHash = await sha256Hex(canonicalJson(hashInput));
  return {
    manifestHash,
    records: normalized,
    groups,
    standardProducts,
    counts: {
      source: normalized.length,
      valid: valid.length,
      quarantined: normalized.length - valid.length,
      organizations: groups.length,
      standardProducts: standardProducts.length,
      offerings: valid.length === 0 ? 0 : groups.reduce(
        (count, group) => count + new Set(
          group.records.map((row) => row.asinNormalized),
        ).size,
        0,
      ),
    },
  };
}

export async function commitSellerPartnerImport(
  database: SqlDatabase,
  plan: SellerPartnerImportPlan,
  options: { actorStaffId: string; now: number },
): Promise<SellerPartnerImportResult> {
  if (!Number.isSafeInteger(options.now) || options.now < 0) {
    throw new SellerPartnerImportError('INVALID_TIMESTAMP');
  }
  if (!options.actorStaffId || options.actorStaffId.length > 120) {
    throw new SellerPartnerImportError('INVALID_ACTOR');
  }

  const existing = await database.prepare(`
    SELECT id, status, source_count, valid_count, quarantined_count,
      organization_count, standard_product_count, offering_count
    FROM seller_partner_import_batches
    WHERE manifest_hash=?
  `).bind(plan.manifestHash).first<{
    id: string;
    status: 'PREVIEWED' | 'COMMITTED' | 'ROLLED_BACK';
    source_count: number;
    valid_count: number;
    quarantined_count: number;
    organization_count: number;
    standard_product_count: number;
    offering_count: number;
  }>();
  if (existing?.status === 'COMMITTED') {
    return resultFromBatch(existing, plan.manifestHash, true);
  }
  if (existing) throw new SellerPartnerImportError('BATCH_STATE_CONFLICT');

  const batchId = `seller-import-batch-${plan.manifestHash}`;
  const statements: SqlStatement[] = [database.prepare(`
    INSERT INTO seller_partner_import_batches (
      id, manifest_hash, status, actor_staff_id, source_count, valid_count,
      quarantined_count, organization_count, standard_product_count,
      offering_count, created_at, committed_at, rolled_back_at
    ) VALUES (?, ?, 'COMMITTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).bind(
    batchId,
    plan.manifestHash,
    options.actorStaffId,
    plan.counts.source,
    plan.counts.valid,
    plan.counts.quarantined,
    plan.counts.organizations,
    plan.counts.standardProducts,
    plan.counts.offerings,
    options.now,
    options.now,
  )];

  for (const record of plan.records) {
    statements.push(database.prepare(`
      INSERT INTO seller_partner_import_source_records (
        id, batch_id, source_folder_id, source_record_id, source_locator,
        source_row_hash, seller_wechat_display, seller_wechat_normalized,
        source_seller_code, channel_code, asin_normalized, product_name,
        product_url, cooperation_status, source_reservable, status,
        exception_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `seller-import-source-${plan.manifestHash}-${record.rowHash}`,
      batchId,
      record.sourceFolderId,
      record.sourceRecordId,
      record.sourceLocator,
      record.rowHash,
      record.sellerWechatDisplay,
      record.sellerWechatNormalized,
      record.sourceSellerCode,
      record.channelCode,
      record.asinNormalized,
      record.productName,
      record.productUrl,
      record.cooperationStatus,
      record.sourceReservable ? 1 : 0,
      record.status,
      record.exceptionCode,
      options.now,
    ));
  }

  const channelAllocations = new Map<string, {
    id: string;
    prefix: string;
    nextSequence: number;
    version: number;
  }>();
  for (const group of plan.groups) {
    let channel = channelAllocations.get(group.channelCode);
    if (!channel) {
      const sourceChannel = await database.prepare(`
        SELECT id, prefix, next_sequence, version
        FROM seller_channels WHERE code=? AND status='ACTIVE'
      `).bind(group.channelCode).first<{
        id: string;
        prefix: string;
        next_sequence: number;
        version: number;
      }>();
      if (sourceChannel) {
        channel = {
          id: sourceChannel.id,
          prefix: sourceChannel.prefix,
          nextSequence: Number(sourceChannel.next_sequence),
          version: Number(sourceChannel.version),
        };
        channelAllocations.set(group.channelCode, channel);
      }
    }
    if (!channel) throw new SellerPartnerImportError('CHANNEL_NOT_FOUND');
    const sellerSequence = channel.nextSequence;
    const sellerCode = `${channel.prefix}-${sellerSequence}`;
    statements.push(database.prepare(`
      UPDATE seller_channels
      SET next_sequence=next_sequence+1, version=version+1,
        updated_at=MAX(?, updated_at+1)
      WHERE id=? AND next_sequence=? AND version=?
    `).bind(options.now, channel.id, sellerSequence, channel.version));
    channel.nextSequence += 1;
    channel.version += 1;

    const subjectId = `seller-import-subject-${await sha256Hex(group.groupKey)}`;
    const claimId = `seller-import-claim-${await sha256Hex(group.groupKey)}`;
    const memberId = `seller-import-member-${await sha256Hex(group.groupKey)}`;
    const storeId = `seller-import-store-${await sha256Hex(group.groupKey)}`;
    statements.push(database.prepare(`
      INSERT INTO customer_identity_subjects (id, subject_type, created_at)
      VALUES (?, 'SELLER_ORG_MEMBER', ?)
    `).bind(subjectId, options.now));
    statements.push(database.prepare(`
      INSERT INTO wechat_identity_claims (
        id, identity_subject_id, display_wechat, normalized_wechat, status,
        version, acquired_at, reserved_at, released_at, created_at, updated_at,
        identity_subject_type
      ) VALUES (?, ?, ?, ?, 'ACTIVE', 1, ?, NULL, NULL, ?, ?, 'SELLER_ORG_MEMBER')
    `).bind(
      claimId,
      subjectId,
      group.sellerWechatDisplay,
      group.sellerWechatNormalized,
      options.now,
      options.now,
      options.now,
    ));
    statements.push(database.prepare(`
      INSERT INTO seller_organizations (
        id, marketplace_code, seller_code, origin_channel_id,
        current_channel_id, seller_sequence, organization_name, status, version,
        created_at, updated_at, activated_at, disabled_at, next_member_number
      ) VALUES (?, 'AMAZON_JP', ?, ?, ?, ?, ?, 'DISABLED', 1, ?, ?, NULL, ?, 2)
    `).bind(
      group.organizationId,
      sellerCode,
      channel.id,
      channel.id,
      sellerSequence,
      `Imported seller ${group.sellerWechatDisplay}`,
      options.now,
      options.now,
      options.now,
    ));
    statements.push(database.prepare(`
      INSERT INTO seller_organization_members (
        id, identity_subject_id, organization_id, member_number,
        username_fallback, display_name, role, primary_owner, status, version,
        created_at, updated_at, activated_at, disabled_at
      ) VALUES (?, ?, ?, 1, ?, ?, 'OWNER', 1, 'DISABLED', 1, ?, ?, NULL, ?)
    `).bind(
      memberId,
      subjectId,
      group.organizationId,
      `${sellerCode}:owner`,
      group.sellerWechatDisplay,
      options.now,
      options.now,
      options.now,
    ));
    statements.push(database.prepare(`
      INSERT INTO seller_stores (
        id, organization_id, marketplace_code, display_name, normalized_name,
        status, version, created_at, updated_at, disabled_at
      ) VALUES (?, ?, 'AMAZON_JP', ?, ?, 'DISABLED', 1, ?, ?, ?)
    `).bind(
      storeId,
      group.organizationId,
      `${group.channelCode} historical store`,
      `${group.channelCode}-historical-store`,
      options.now,
      options.now,
      options.now,
    ));
  }

  for (const standard of plan.standardProducts) {
    const standardId = `standard-product-${standard.asinNormalized}`;
    statements.push(database.prepare(`
      INSERT OR IGNORE INTO standard_products (
        id, marketplace_code, asin_display, asin_normalized, canonical_name,
        canonical_url, status, source_batch_id, created_at, updated_at
      ) VALUES (?, 'AMAZON_JP', ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
    `).bind(
      standardId,
      standard.asinDisplay,
      standard.asinNormalized,
      standard.canonicalName,
      standard.canonicalUrl,
      batchId,
      options.now,
      options.now,
    ));
  }

  for (const group of plan.groups) {
    const storeId = `seller-import-store-${await sha256Hex(group.groupKey)}`;
    const offeredAsins = [...new Set(
      group.records.map((record) => record.asinNormalized!),
    )].sort();
    for (const asin of offeredAsins) {
      const rows = group.records.filter((record) => record.asinNormalized === asin);
      const offeringId = `seller-offering-${await sha256Hex(`${group.groupKey}:${asin}`)}`;
      const offeringCooperationStatus: CooperationStatus = rows.some(
        (row) => row.cooperationStatus === 'CURRENT',
      )
        ? 'CURRENT'
        : rows.some((row) => row.cooperationStatus === 'UNKNOWN')
          ? 'UNKNOWN'
          : 'HISTORICAL';
      const offeringSourceReservable = rows.some((row) => row.sourceReservable);
      const currentAndReservable = rows.some(
        (row) => row.cooperationStatus === 'CURRENT' && row.sourceReservable,
      );
      statements.push(database.prepare(`
        INSERT INTO seller_product_offerings (
          id, standard_product_id, seller_organization_id, seller_store_id,
          marketplace_code, status, cooperation_status, source_reservable,
          source_batch_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'AMAZON_JP', 'DISABLED', ?, ?, ?, ?, ?)
      `).bind(
        offeringId,
        `standard-product-${asin}`,
        group.organizationId,
        storeId,
        offeringCooperationStatus,
        offeringSourceReservable ? 1 : 0,
        batchId,
        options.now,
        options.now,
      ));
      statements.push(database.prepare(`
        INSERT INTO product_reservation_openings (
          offering_id, status, eligibility_reason, source_batch_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        offeringId,
        currentAndReservable ? 'ELIGIBLE' : 'NOT_OPEN',
        currentAndReservable
          ? 'CURRENT_COOPERATION_AND_RESERVABLE'
          : rows.some((row) => row.cooperationStatus === 'HISTORICAL')
            ? 'HISTORICAL_SOURCE'
            : 'SOURCE_NOT_RESERVABLE_OR_UNCONFIRMED',
        batchId,
        options.now,
        options.now,
      ));
    }
  }

  await database.batch(statements);
  return {
    batchId,
    manifestHash: plan.manifestHash,
    replayed: false,
    sourceCount: plan.counts.source,
    validCount: plan.counts.valid,
    quarantinedCount: plan.counts.quarantined,
    organizationCount: plan.counts.organizations,
    standardProductCount: plan.counts.standardProducts,
    offeringCount: plan.counts.offerings,
    loginAccountsCreated: 0,
    externalMutations: 0,
  };
}

export async function rollbackSellerPartnerImport(
  database: SqlDatabase,
  batchId: string,
  now: number,
): Promise<SellerPartnerRollbackResult> {
  if (!batchId || !Number.isSafeInteger(now) || now < 0) {
    throw new SellerPartnerImportError('INVALID_ROLLBACK_INPUT');
  }
  const batch = await database.prepare(`
    SELECT id, status FROM seller_partner_import_batches WHERE id=?
  `).bind(batchId).first<{ id: string; status: string }>();
  if (!batch || batch.status !== 'COMMITTED') {
    throw new SellerPartnerImportError('BATCH_STATE_CONFLICT');
  }
  const downstream = await database.prepare(`
    SELECT 1
    FROM products product
    JOIN seller_product_offerings offering
      ON offering.seller_organization_id=product.organization_id
    WHERE offering.source_batch_id=?
    LIMIT 1
  `).bind(batchId).first();
  if (downstream) {
    throw new SellerPartnerImportError('ROLLBACK_BLOCKED_DOWNSTREAM_FACTS');
  }

  await database.batch([
    database.prepare(`
      UPDATE product_reservation_openings
      SET status='CLOSED', eligibility_reason='IMPORT_ROLLED_BACK',
        updated_at=MAX(?, updated_at+1)
      WHERE source_batch_id=?
    `).bind(now, batchId),
    database.prepare(`
      UPDATE seller_product_offerings
      SET status='DISABLED', updated_at=MAX(?, updated_at+1)
      WHERE source_batch_id=?
    `).bind(now, batchId),
    database.prepare(`
      UPDATE standard_products
      SET status='DISABLED', updated_at=MAX(?, updated_at+1)
      WHERE source_batch_id=?
        AND NOT EXISTS (
          SELECT 1 FROM seller_product_offerings offering
          WHERE offering.standard_product_id=standard_products.id
            AND offering.source_batch_id<>?
        )
        AND NOT EXISTS (
          SELECT 1 FROM seller_product_offerings offering
          WHERE offering.standard_product_id=standard_products.id
            AND offering.status='ACTIVE'
        )
    `).bind(now, batchId, batchId),
    database.prepare(`
      UPDATE seller_partner_import_batches
      SET status='ROLLED_BACK', rolled_back_at=?
      WHERE id=? AND status='COMMITTED'
    `).bind(now, batchId),
  ]);
  return {
    batchId,
    rolledBack: true,
    sourceTraceRetained: true,
    downstreamFactsChecked: true,
  };
}

async function normalizeSourceRecord(
  input: SellerPartnerSourceRecord,
): Promise<NormalizedSourceRecord> {
  const sourceFolderId = clean(input?.sourceFolderId);
  const sourceRecordId = clean(input?.sourceRecordId);
  const sourceLocator = clean(input?.sourceLocator);
  const sellerWechatRaw = clean(input?.sellerWechat);
  const productName = clean(input?.productName);
  const productUrl = input?.productUrl == null ? null : clean(input.productUrl);
  const cooperationStatus = input?.cooperationStatus ?? 'UNKNOWN';
  const sourceReservable = input?.currentReservable === true;
  const sourceSellerCode = input?.sourceSellerCode == null
    ? null
    : clean(input.sourceSellerCode);
  const rowHash = await sha256Hex(canonicalJson({
    source_folder_id: sourceFolderId,
    source_record_id: sourceRecordId,
    source_locator: sourceLocator,
    seller_wechat: sellerWechatRaw,
    channel_alias: input?.channelAlias ?? null,
    source_seller_code: sourceSellerCode,
    asin: input?.asin,
    product_name: productName,
    product_url: productUrl,
    cooperation_status: cooperationStatus,
    current_reservable: sourceReservable,
  }));
  const base: NormalizedSourceRecord = {
    sourceFolderId,
    sourceRecordId,
    sourceLocator,
    sellerWechatDisplay: sellerWechatRaw,
    sellerWechatNormalized: sellerWechatRaw.toLocaleLowerCase('en-US'),
    sourceSellerCode,
    channelCode: null,
    asinNormalized: null,
    productName: null,
    productUrl,
    cooperationStatus,
    sourceReservable,
    rowHash,
    status: 'QUARANTINED',
    exceptionCode: null,
  };

  if (!(sourceFolderId in FROZEN_SOURCE_FOLDERS)) {
    base.exceptionCode = 'UNKNOWN_SOURCE_FOLDER';
    return base;
  }
  if (!['CURRENT', 'HISTORICAL', 'UNKNOWN'].includes(cooperationStatus)) {
    base.exceptionCode = 'INVALID_COOPERATION_STATUS';
    return base;
  }
  try {
    const wechat = normalizeWechatId(sellerWechatRaw);
    base.sellerWechatDisplay = wechat.display;
    base.sellerWechatNormalized = wechat.normalized;
    base.asinNormalized = normalizeAsin(input.asin);
  } catch {
    base.exceptionCode = 'INVALID_SELLER_OR_ASIN';
    return base;
  }
  if (!productName || productName.length > 200) {
    base.exceptionCode = 'INVALID_PRODUCT_NAME';
    return base;
  }
  const defaultChannel = FROZEN_SOURCE_FOLDERS[
    sourceFolderId as keyof typeof FROZEN_SOURCE_FOLDERS
  ];
  const alias = input.channelAlias == null || input.channelAlias.trim() === ''
    ? defaultChannel
    : CHANNEL_ALIASES[input.channelAlias.normalize('NFKC').trim().toLocaleLowerCase('en-US') as keyof typeof CHANNEL_ALIASES];
  if (!alias) {
    base.exceptionCode = 'UNKNOWN_CHANNEL_ALIAS';
    base.asinNormalized = null;
    return base;
  }
  if (input.channelAlias != null
    && alias !== defaultChannel
    && alias !== 'queshengai') {
    base.exceptionCode = 'FOLDER_CHANNEL_CONFLICT';
    base.asinNormalized = null;
    return base;
  }
  base.channelCode = alias;
  base.productName = productName;
  base.status = 'VALID';
  return base;
}

async function malformedSourceRecord(
  input: SellerPartnerSourceRecord,
  index: number,
  error: unknown,
): Promise<NormalizedSourceRecord> {
  const rawFolderId = safeText(input?.sourceFolderId, `unknown-folder-${index}`);
  const sourceFolderId = rawFolderId.length >= 12
    ? rawFolderId
    : `unknown-folder-${index}`;
  const sourceRecordId = safeText(input?.sourceRecordId, `malformed-row-${index}`);
  const sourceLocator = safeText(input?.sourceLocator, `fixture://malformed/${index}`);
  const rawSellerWechat = safeText(
    input?.sellerWechat,
    `unknown-seller-${index}`,
  );
  const sellerWechatDisplay = rawSellerWechat.length >= 3
    ? rawSellerWechat
    : `unknown-seller-${index}`;
  const rowHash = await sha256Hex(canonicalJson({
    malformed_index: index,
    source_folder_id: sourceFolderId,
    source_record_id: sourceRecordId,
    source_locator: sourceLocator,
    input,
  }));
  return {
    sourceFolderId,
    sourceRecordId,
    sourceLocator,
    sellerWechatDisplay,
    sellerWechatNormalized: sellerWechatDisplay.toLocaleLowerCase('en-US'),
    sourceSellerCode: null,
    channelCode: null,
    asinNormalized: null,
    productName: null,
    productUrl: null,
    cooperationStatus: 'UNKNOWN',
    sourceReservable: false,
    rowHash,
    status: 'QUARANTINED',
    exceptionCode: error instanceof SellerPartnerImportError
      ? error.code
      : 'INVALID_SOURCE_ROW',
  };
}

function safeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || /[\u0000-\u001f\u007f]/u.test(normalized)) return fallback;
  return normalized.slice(0, 500);
}

function clean(value: unknown): string {
  if (typeof value !== 'string') throw new SellerPartnerImportError('INVALID_FIELD');
  const result = value.normalize('NFKC').trim();
  if (result.length < 1 || result.length > 500 || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new SellerPartnerImportError('INVALID_FIELD');
  }
  return result;
}

function resultFromBatch(
  batch: {
    id: string;
    source_count: number;
    valid_count: number;
    quarantined_count: number;
    organization_count: number;
    standard_product_count: number;
    offering_count: number;
  },
  manifestHash: string,
  replayed: boolean,
): SellerPartnerImportResult {
  return {
    batchId: batch.id,
    manifestHash,
    replayed,
    sourceCount: Number(batch.source_count),
    validCount: Number(batch.valid_count),
    quarantinedCount: Number(batch.quarantined_count),
    organizationCount: Number(batch.organization_count),
    standardProductCount: Number(batch.standard_product_count),
    offeringCount: Number(batch.offering_count),
    loginAccountsCreated: 0,
    externalMutations: 0,
  };
}

export class SellerPartnerImportError extends Error {
  public readonly code:
    | 'INVALID_MANIFEST'
    | 'INVALID_FIELD'
    | 'INVALID_TIMESTAMP'
    | 'INVALID_ACTOR'
    | 'INVALID_ROLLBACK_INPUT'
    | 'BATCH_STATE_CONFLICT'
    | 'CHANNEL_NOT_FOUND'
    | 'ROLLBACK_BLOCKED_DOWNSTREAM_FACTS';

  constructor(code:
    | 'INVALID_MANIFEST'
    | 'INVALID_FIELD'
    | 'INVALID_TIMESTAMP'
    | 'INVALID_ACTOR'
    | 'INVALID_ROLLBACK_INPUT'
    | 'BATCH_STATE_CONFLICT'
    | 'CHANNEL_NOT_FOUND'
    | 'ROLLBACK_BLOCKED_DOWNSTREAM_FACTS') {
    super(code);
    this.code = code;
    this.name = 'SellerPartnerImportError';
  }
}
