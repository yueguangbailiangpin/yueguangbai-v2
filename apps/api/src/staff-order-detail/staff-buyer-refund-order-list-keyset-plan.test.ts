import { Hono } from 'hono';
import type { SQLInputValue } from 'node:sqlite';
import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { describe, expect, it } from 'vitest';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { decodeCursor, registerStaffOrderDetailRoutes } from './routes';
import { responsibilitySelects } from './responsibility';

/**
 * Independent acceptance for the Schema 37 buyer_refund query-plan remainder.
 * The corpus uses the same guarded source chain as the existing multi-market
 * preparation suite, gives the refund actor two scoped markets, adds many
 * rows from an irrelevant registered market, and leaves one buyer unassigned
 * so result and concealment checks cannot be plan-only.
 */

const ORIGIN = 'https://api.example.test';
const TOTAL_ORDERS = 1_000;
const COST_PAGE_LIMIT = 3;
const CONFIRMED_AT = Date.UTC(2026, 7, 1, 0, 0, 0);
const OWNER_ID = 'zz-phase3h-test-owner';
const BUYER_REFUND_ID = 'synthetic-buyer-refund-plan';
const TARGET_MARKET = 'AMAZON_US';
const DISTRACTOR_MARKET = 'AMAZON_JP';
const IRRELEVANT_MARKET = 'COUPANG_KR';
const SELECTIVITY_CASES = [
  { label: 'scope-1-percent', share: 0.01, scopeNumerator: 1, scopeDenominator: 100 },
  { label: 'scope-20-percent', share: 0.2, scopeNumerator: 1, scopeDenominator: 5 },
  { label: 'scope-80-percent', share: 0.8, scopeNumerator: 4, scopeDenominator: 5 },
] as const;

type SelectivityCase = (typeof SELECTIVITY_CASES)[number];

interface QueryPlanRow {
  id: number;
  parent: number;
  detail: string;
}

interface SyntheticCorpus {
  database: SqliteDatabase;
  targetOrderIds: string[];
  visibleOrderIds: string[];
  unassignedOrderId: string;
  scopedOrderCount: number;
}

interface CapturedStatement {
  sql: string;
  params: unknown[];
}

const SEEK_OR = '(o.confirmed_at<? OR (o.confirmed_at=? AND o.id<?))';
const SEEK_ROW_VALUE = '(o.confirmed_at,o.id)<(?,?)';

function buyerRefundActor(denies: Array<'ORDER_VIEW'> = []): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set(['buyer_refund']),
    grants: new Set(),
    denies: new Set(denies),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId: BUYER_REFUND_ID,
    displayName: '合成返款计划员工',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: effective.roles,
    permissions: effective.permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

function selectivityCaseForShare(share: number): SelectivityCase {
  const selected = SELECTIVITY_CASES.find((candidate) => candidate.share === share);
  if (!selected) throw new Error(`unknown_selectivity_case:${share}`);
  return selected;
}

function scopeOrderRank(selectivity: SelectivityCase, ordinal: number): number {
  const { scopeNumerator, scopeDenominator } = selectivity;
  const gap = scopeDenominator - scopeNumerator;
  if (gap === 0) return ordinal;
  return Math.floor(ordinal / scopeNumerator) * scopeDenominator + (ordinal % scopeNumerator);
}

function syntheticOrderRank(
  selectivity: SelectivityCase,
  marketKey: 'us' | 'jp' | 'kr',
  index: number,
): number {
  if (marketKey === 'kr') {
    const irrelevantPerBucket = selectivity.scopeDenominator - selectivity.scopeNumerator;
    return (
      Math.floor(index / irrelevantPerBucket) * selectivity.scopeDenominator +
      selectivity.scopeNumerator +
      (index % irrelevantPerBucket)
    );
  }
  const ordinal = index * 2 + (marketKey === 'jp' ? 1 : 0);
  return scopeOrderRank(selectivity, ordinal);
}

function syntheticOrderId(
  selectivity: SelectivityCase,
  marketKey: 'us' | 'jp' | 'kr',
  index: number,
): string {
  return `synthetic-refund-order-${String(
    syntheticOrderRank(selectivity, marketKey, index),
  ).padStart(6, '0')}-${marketKey}`;
}

function syntheticOrderRankExpression(
  selectivity: SelectivityCase,
  marketKey: 'us' | 'jp' | 'kr',
): string {
  if (marketKey === 'kr') {
    const irrelevantPerBucket = selectivity.scopeDenominator - selectivity.scopeNumerator;
    return (
      `CAST(i/${irrelevantPerBucket} AS INTEGER)*${selectivity.scopeDenominator}` +
      `+${selectivity.scopeNumerator}+(i%${irrelevantPerBucket})`
    );
  }
  const ordinal = marketKey === 'jp' ? '(i*2+1)' : '(i*2)';
  return selectivity.scopeNumerator === 1
    ? `${ordinal}*${selectivity.scopeDenominator}`
    : `CAST(${ordinal}/${selectivity.scopeNumerator} AS INTEGER)*${selectivity.scopeDenominator}` +
        `+(${ordinal}%${selectivity.scopeNumerator})`;
}

function seedSyntheticCorpus(targetShare: number): SyntheticCorpus {
  const selectivity = selectivityCaseForShare(targetShare);
  const scopedOrderCount = Math.round(TOTAL_ORDERS * targetShare);
  const targetCount = Math.ceil(scopedOrderCount / 2);
  const distractorCount = scopedOrderCount - targetCount;
  const irrelevantCount = TOTAL_ORDERS - scopedOrderCount;
  const database = createMigratedTestDatabase();

  database.exec(`
    INSERT INTO staff_users(
      id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at
    ) VALUES('${BUYER_REFUND_ID}','合成返款计划员工','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO staff_role_assignments(
      id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at
    ) VALUES(
      'synthetic-buyer-refund-plan-role','${BUYER_REFUND_ID}','buyer_refund','ACTIVE',
      '${OWNER_ID}',1000,NULL,1000,1000
    );
    INSERT INTO staff_marketplace_scopes(
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,revoked_at,
      reason,created_at,updated_at,scope_kind
    ) VALUES
      ('synthetic-buyer-refund-plan-us','${BUYER_REFUND_ID}','buyer_refund','${TARGET_MARKET}',
        'ACTIVE','${OWNER_ID}',1000,NULL,'synthetic query-plan scope',1000,1000,'PRIMARY'),
      ('synthetic-buyer-refund-plan-jp','${BUYER_REFUND_ID}','buyer_refund','${DISTRACTOR_MARKET}',
        'ACTIVE','${OWNER_ID}',1000,NULL,'synthetic query-plan scope',1000,1000,'PRIMARY');
    INSERT OR IGNORE INTO buyer_channels(
      id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at
    ) VALUES('buyer-channel-wechat-b','B','合成返款计划渠道','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO seller_organizations(
      id,marketplace_code,seller_code,origin_channel_id,current_channel_id,seller_sequence,
      organization_name,status,version,created_at,updated_at,activated_at,disabled_at,next_member_number
    ) VALUES
      ('synthetic-us-refund-seller','${TARGET_MARKET}','synthetic-us-refund-seller',
        'seller-channel-ido-mango','seller-channel-ido-mango',9901,'合成美国返款卖家',
        'ACTIVE',1,1000,1000,1000,NULL,2),
      ('synthetic-jp-refund-seller','${DISTRACTOR_MARKET}','synthetic-jp-refund-seller',
        'seller-channel-ido-mango','seller-channel-ido-mango',9902,'合成日本返款卖家',
        'ACTIVE',1,1000,1000,1000,NULL,2),
      ('synthetic-kr-refund-seller','${IRRELEVANT_MARKET}','synthetic-kr-refund-seller',
        'seller-channel-ido-mango','seller-channel-ido-mango',9903,'合成韩国无关卖家',
        'ACTIVE',1,1000,1000,1000,NULL,2);
    INSERT INTO customer_identity_subjects(id,subject_type,created_at) VALUES
      ('synthetic-us-refund-seller-subject','SELLER_ORG_MEMBER',1000),
      ('synthetic-jp-refund-seller-subject','SELLER_ORG_MEMBER',1000),
      ('synthetic-kr-refund-seller-subject','SELLER_ORG_MEMBER',1000);
    INSERT INTO seller_organization_members(
      id,identity_subject_id,organization_id,member_number,username_fallback,display_name,role,
      primary_owner,status,version,created_at,updated_at,activated_at,disabled_at
    ) VALUES
      ('synthetic-us-refund-seller-member','synthetic-us-refund-seller-subject',
        'synthetic-us-refund-seller',1,'synthetic-us-refund-owner','合成美国卖家负责人',
        'OWNER',1,'ACTIVE',1,1000,1000,1000,NULL),
      ('synthetic-jp-refund-seller-member','synthetic-jp-refund-seller-subject',
        'synthetic-jp-refund-seller',1,'synthetic-jp-refund-owner','合成日本卖家负责人',
        'OWNER',1,'ACTIVE',1,1000,1000,1000,NULL),
      ('synthetic-kr-refund-seller-member','synthetic-kr-refund-seller-subject',
        'synthetic-kr-refund-seller',1,'synthetic-kr-refund-owner','合成韩国无关卖家负责人',
        'OWNER',1,'ACTIVE',1,1000,1000,1000,NULL);
    INSERT INTO seller_stores(
      id,organization_id,marketplace_code,display_name,normalized_name,status,version,
      created_at,updated_at,disabled_at
    ) VALUES
      ('synthetic-us-refund-store','synthetic-us-refund-seller','${TARGET_MARKET}',
        '合成美国返款店铺','合成美国返款店铺','ACTIVE',1,1000,1000,NULL),
      ('synthetic-jp-refund-store','synthetic-jp-refund-seller','${DISTRACTOR_MARKET}',
        '合成日本返款店铺','合成日本返款店铺','ACTIVE',1,1000,1000,NULL),
      ('synthetic-kr-refund-store','synthetic-kr-refund-seller','${IRRELEVANT_MARKET}',
        '合成韩国无关店铺','合成韩国无关店铺','ACTIVE',1,1000,1000,NULL);
    INSERT INTO products(
      id,organization_id,store_id,marketplace_code,asin_display,asin_normalized,status,
      current_version_no,version,created_at,updated_at,disabled_at
    ) VALUES
      ('synthetic-us-refund-product','synthetic-us-refund-seller','synthetic-us-refund-store',
        '${TARGET_MARKET}','B0RFDUS001','B0RFDUS001','ACTIVE',1,1,1000,1000,NULL),
      ('synthetic-jp-refund-product','synthetic-jp-refund-seller','synthetic-jp-refund-store',
        '${DISTRACTOR_MARKET}','B0RFDJP001','B0RFDJP001','ACTIVE',1,1,1000,1000,NULL),
      ('synthetic-kr-refund-product','synthetic-kr-refund-seller','synthetic-kr-refund-store',
        '${IRRELEVANT_MARKET}','B0RFDKR001','B0RFDKR001','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO product_versions(
      id,product_id,version_no,product_name,search_keywords_json,product_url,buyer_visible_notes,
      internal_notes,created_by_staff_id,created_at,ordering_guide_expected_amount_jpy,color_spec_mode
    ) VALUES
      ('synthetic-us-refund-product-version','synthetic-us-refund-product',1,'合成美国返款产品',
        '[]',NULL,NULL,NULL,'${OWNER_ID}',1000,1980,'MAIN_IMAGE_VARIANT'),
      ('synthetic-jp-refund-product-version','synthetic-jp-refund-product',1,'合成日本返款产品',
        '[]',NULL,NULL,NULL,'${OWNER_ID}',1000,1980,'MAIN_IMAGE_VARIANT'),
      ('synthetic-kr-refund-product-version','synthetic-kr-refund-product',1,'合成韩国无关产品',
        '[]',NULL,NULL,NULL,'${OWNER_ID}',1000,1980,'MAIN_IMAGE_VARIANT');
    INSERT INTO demand_batches(
      id,organization_id,store_id,marketplace_code,product_id,product_version_no,submitted_by_member_id,
      task_type,target_quantity,buyer_visible_notes,seller_notes,open_at,reservation_deadline,order_deadline,
      status,review_reason,close_reason,reviewed_by_staff_id,closed_by_staff_id,version,submitted_at,
      updated_at,reviewed_at,published_at,withdrawn_at,closed_at,held_reservation_count,approved_reservation_count
    ) VALUES
      ('synthetic-us-refund-demand','synthetic-us-refund-seller','synthetic-us-refund-store',
        '${TARGET_MARKET}','synthetic-us-refund-product',1,'synthetic-us-refund-seller-member',
        'IMAGE',${targetCount || 1},NULL,NULL,2000,5000,20000,'PUBLISHED',NULL,NULL,
        '${OWNER_ID}',NULL,2,1000,3000,3000,3000,NULL,NULL,0,${targetCount}),
      ('synthetic-jp-refund-demand','synthetic-jp-refund-seller','synthetic-jp-refund-store',
        '${DISTRACTOR_MARKET}','synthetic-jp-refund-product',1,'synthetic-jp-refund-seller-member',
        'IMAGE',${distractorCount || 1},NULL,NULL,2000,5000,20000,'PUBLISHED',NULL,NULL,
        '${OWNER_ID}',NULL,2,1000,3000,3000,3000,NULL,NULL,0,${distractorCount}),
      ('synthetic-kr-refund-demand','synthetic-kr-refund-seller','synthetic-kr-refund-store',
        '${IRRELEVANT_MARKET}','synthetic-kr-refund-product',1,'synthetic-kr-refund-seller-member',
        'IMAGE',${irrelevantCount || 1},NULL,NULL,2000,5000,20000,'PUBLISHED',NULL,NULL,
        '${OWNER_ID}',NULL,2,1000,3000,3000,3000,NULL,NULL,0,${irrelevantCount});
  `);

  seedMarketRows(database, TARGET_MARKET, 'us', targetCount, 0, selectivity);
  seedMarketRows(database, DISTRACTOR_MARKET, 'jp', distractorCount, targetCount, selectivity);
  seedMarketRows(database, IRRELEVANT_MARKET, 'kr', irrelevantCount, scopedOrderCount, selectivity);
  seedBuyerRefundAssignments(database, targetCount, distractorCount);

  const targetOrderIds = (
    database.raw
      .prepare(
        `SELECT id FROM formal_orders
       WHERE marketplace_code=? ORDER BY confirmed_at DESC,id DESC`,
      )
      .all(TARGET_MARKET) as Array<{ id: string }>
  ).map((row) => row.id);
  const visibleOrderIds = readOrderIds(database);
  const unassignedOrderId = syntheticOrderId(selectivity, 'jp', 0);
  const totalRows = database.raw.prepare('SELECT COUNT(*) AS total FROM formal_orders').get() as {
    total: number;
  };
  const scopedRows = database.raw
    .prepare(
      `SELECT COUNT(*) AS total FROM formal_orders
       WHERE marketplace_code IN (?,?)`,
    )
    .get(TARGET_MARKET, DISTRACTOR_MARKET) as { total: number };
  expect(Number(totalRows.total)).toBe(TOTAL_ORDERS);
  expect(Number(scopedRows.total)).toBe(scopedOrderCount);
  expect(visibleOrderIds).toHaveLength(scopedOrderCount - 1);
  return {
    database,
    targetOrderIds,
    visibleOrderIds,
    unassignedOrderId,
    scopedOrderCount,
  };
}

function seedMarketRows(
  database: SqliteDatabase,
  marketplaceCode: string,
  marketKey: 'us' | 'jp' | 'kr',
  count: number,
  buyerSequenceOffset: number,
  selectivity: SelectivityCase,
): void {
  if (count < 1) return;
  const sellerId = `synthetic-${marketKey}-refund-seller`;
  const storeId = `synthetic-${marketKey}-refund-store`;
  const productId = `synthetic-${marketKey}-refund-product`;
  const productVersionId = `synthetic-${marketKey}-refund-product-version`;
  const demandId = `synthetic-${marketKey}-refund-demand`;
  const marketBusinessDate = '2026-08-01';
  const startSequence = 10000 + buyerSequenceOffset;
  const startOrderNumber = marketKey === 'us' ? 0 : marketKey === 'jp' ? 5000 : 10000;
  const orderRank = syntheticOrderRankExpression(selectivity, marketKey);
  const productName =
    marketKey === 'us'
      ? '合成美国返款产品'
      : marketKey === 'jp'
        ? '合成日本返款产品'
        : '合成韩国无关产品';
  const asin = marketKey === 'us' ? 'B0RFDUS001' : marketKey === 'jp' ? 'B0RFDJP001' : 'B0RFDKR001';

  database.raw.exec('BEGIN');
  try {
    database.raw
      .prepare(
        `
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i+1<?)
      INSERT INTO customer_identity_subjects(id,subject_type,created_at)
      SELECT 'synthetic-${marketKey}-refund-buyer-subject-'||printf('%04d',i),
        'BUYER_CUSTOMER',1000 FROM n
    `,
      )
      .run(count);
    database.raw
      .prepare(
        `
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i+1<?)
      INSERT INTO buyer_customers(
        id,identity_subject_id,marketplace_code,buyer_channel_id,buyer_customer_no,buyer_sequence,
        display_name,access_status,identity_review_status,version,created_at,updated_at,activated_at,disabled_at
      )
      SELECT 'synthetic-${marketKey}-refund-buyer-'||printf('%04d',i),
        'synthetic-${marketKey}-refund-buyer-subject-'||printf('%04d',i),?,
        'buyer-channel-wechat-b','20260801B'||printf('%05d',${startSequence}+i),
        ${startSequence}+i,'合成${marketKey}返款买家'||i,'ACTIVE','CLEAR',1,1000,1000,1000,NULL
      FROM n
    `,
      )
      .run(count, marketplaceCode);
    database.raw
      .prepare(
        `
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i+1<?)
      INSERT INTO product_reservations(
        id,demand_batch_id,buyer_customer_id,organization_id,store_id,product_id,product_version_no,
        marketplace_code,status,precheck_snapshot_json,hold_expires_at,order_deadline_snapshot,version,
        submitted_at,updated_at,decided_by_staff_id,decision_reason,decided_at,cancelled_at,expired_at,
        reopened_count,buyer_self_pay_bps_snapshot,reference_order_amount_jpy_snapshot,
        estimated_self_pay_jpy_snapshot,estimated_refundable_principal_jpy_snapshot,
        buyer_self_pay_accepted_at,buyer_self_pay_accepted_demand_version
      )
      SELECT 'synthetic-${marketKey}-refund-reservation-'||printf('%04d',i),?,
        'synthetic-${marketKey}-refund-buyer-'||printf('%04d',i),?,?,?,1,?,
        'APPROVED','{}',5000,20000,2,4000,6000,?,NULL,6000,NULL,NULL,0,0,1980,0,1980,4000,2
      FROM n
    `,
      )
      .run(count, demandId, sellerId, storeId, productId, marketplaceCode, OWNER_ID);
    database.raw
      .prepare(
        `
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i+1<?)
      INSERT INTO order_instruction_reconciliation_markers(
        id,reservation_id,instruction_id,disposition,metadata_json,created_at
      )
      SELECT 'synthetic-${marketKey}-refund-marker-'||printf('%04d',i),
        'synthetic-${marketKey}-refund-reservation-'||printf('%04d',i),NULL,
        'HISTORICAL_EVIDENCE_CONTEXT','{}',1000 FROM n
    `,
      )
      .run(count);
    database.raw
      .prepare(
        `
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i+1<?)
      INSERT INTO order_evidence_submissions(
        id,reservation_id,buyer_customer_id,marketplace_code,status,current_version_no,version,
        public_change_reason,internal_review_note,submitted_at,updated_at,verified_by_staff_id,
        verified_at,withdrawn_at,consumed_at,created_at
      )
      SELECT 'synthetic-${marketKey}-refund-submission-'||printf('%04d',i),
        'synthetic-${marketKey}-refund-reservation-'||printf('%04d',i),
        'synthetic-${marketKey}-refund-buyer-'||printf('%04d',i),?,'PENDING_VERIFICATION',1,1,
        NULL,NULL,7000,7000,NULL,NULL,NULL,NULL,7000 FROM n
    `,
      )
      .run(count, marketplaceCode);
    database.raw
      .prepare(
        `
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i+1<?)
      INSERT INTO order_evidence_versions(
        id,submission_id,reservation_id,buyer_customer_id,marketplace_code,version_no,
        amazon_order_number_raw,amazon_order_number_normalized,amazon_order_date,final_paid_jpy,
        submitted_by_buyer_id,buyer_note,submitted_before_deadline,created_at
      )
      SELECT 'synthetic-${marketKey}-refund-evidence-'||printf('%04d',i),
        'synthetic-${marketKey}-refund-submission-'||printf('%04d',i),
        'synthetic-${marketKey}-refund-reservation-'||printf('%04d',i),
        'synthetic-${marketKey}-refund-buyer-'||printf('%04d',i),?,1,
        '123-9000000-'||printf('%07d',${startOrderNumber}+(${orderRank})),
        '123-9000000-'||printf('%07d',${startOrderNumber}+(${orderRank})),?,1980,
        'synthetic-${marketKey}-refund-buyer-'||printf('%04d',i),NULL,NULL,7000 FROM n
    `,
      )
      .run(count, marketplaceCode, marketBusinessDate);
    database.raw
      .prepare(
        `
      UPDATE order_evidence_submissions
      SET status='VERIFIED',version=2,verified_by_staff_id=?,verified_at=8000,updated_at=8000
      WHERE id LIKE 'synthetic-${marketKey}-refund-submission-%'
    `,
      )
      .run(OWNER_ID);
    database.raw
      .prepare(
        `
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i+1<?)
      INSERT INTO formal_orders(
        id,order_evidence_submission_id,order_evidence_version_id,reservation_id,demand_batch_id,
        buyer_customer_id,buyer_customer_no,seller_organization_id,store_id,marketplace_code,
        product_id,product_version_id,product_version_no,asin_display,asin_normalized,
        product_name_snapshot,review_type,amazon_order_number_raw,amazon_order_number_normalized,
        final_paid_jpy,status,version,confirmed_by_staff_id,confirmed_at,confirmed_business_date,
        created_at,amazon_order_date,marketplace_business_date
      )
      SELECT 'synthetic-refund-order-'||printf('%06d',${orderRank})||'-${marketKey}',
        'synthetic-${marketKey}-refund-submission-'||printf('%04d',i),
        'synthetic-${marketKey}-refund-evidence-'||printf('%04d',i),
        'synthetic-${marketKey}-refund-reservation-'||printf('%04d',i),?,
        'synthetic-${marketKey}-refund-buyer-'||printf('%04d',i),
        '20260801B'||printf('%05d',${startSequence}+i),?,?,?,
        ?,?,1,?,?,'${productName}','IMAGE',
        '123-9000000-'||printf('%07d',${startOrderNumber}+(${orderRank})),
        '123-9000000-'||printf('%07d',${startOrderNumber}+(${orderRank})),1980,'CONFIRMED',1,?,
        ${CONFIRMED_AT},?,${CONFIRMED_AT},?,?
      FROM n
    `,
      )
      .run(
        count,
        demandId,
        sellerId,
        storeId,
        marketplaceCode,
        productId,
        productVersionId,
        asin,
        asin,
        OWNER_ID,
        marketBusinessDate,
        marketBusinessDate,
        marketBusinessDate,
      );
    database.raw.exec('COMMIT');
  } catch (error) {
    database.raw.exec('ROLLBACK');
    throw error;
  }
}

function seedBuyerRefundAssignments(
  database: SqliteDatabase,
  targetCount: number,
  distractorCount: number,
): void {
  for (const [marketKey, count, startIndex] of [
    ['us', targetCount, 0],
    ['jp', distractorCount, 0],
  ] as const) {
    if (count < 1) continue;
    const firstUnassigned = marketKey === 'jp' ? 1 : 0;
    database.raw
      .prepare(
        `
      INSERT INTO buyer_staff_assignments(
        id,buyer_customer_id,duty_code,staff_id,status,source,assigned_by_actor_type,
        assigned_by_actor_id,reason,version,created_at,updated_at,revoked_at
      )
      SELECT 'synthetic-${marketKey}-refund-assignment-'||printf('%04d',i),
        'synthetic-${marketKey}-refund-buyer-'||printf('%04d',i),'BUYER_REFUND_OWNER',?,
        'ACTIVE','MANUAL_REASSIGN','STAFF',?,'synthetic query-plan assignment',1,1000,1000,NULL
      FROM (WITH RECURSIVE n(i) AS (
        SELECT ${startIndex} UNION ALL SELECT i+1 FROM n WHERE i+1<${count}
      ) SELECT i FROM n WHERE i>=${firstUnassigned})
    `,
      )
      .run(BUYER_REFUND_ID, OWNER_ID);
  }
}

function orderListQuery(
  indexHint = '',
  seekPredicate = SEEK_OR,
  marketplacePredicate = 'o.marketplace_code IN (?,?)',
  withOrderAndLimit = true,
): string {
  return `
    SELECT o.id, o.marketplace_code,
      o.seller_organization_id,
      store.display_name AS store_display_name,
      o.buyer_customer_id,
      buyer.display_name AS buyer_display_name,
      o.buyer_customer_no,
      o.amazon_order_number_normalized AS amazon_order_number,
      o.amazon_order_date,
      o.confirmed_at,
      o.status,
      o.product_name_snapshot,
      o.review_type,
      ${responsibilitySelects('o')}
    FROM formal_orders o${indexHint}
    JOIN seller_stores store ON store.id=o.store_id
    JOIN buyer_customers buyer ON buyer.id=o.buyer_customer_id
    LEFT JOIN formal_order_financial_snapshots snapshot
      ON snapshot.formal_order_id=o.id
    WHERE ${marketplacePredicate}
      AND o.buyer_customer_id IN (
        SELECT assignment.buyer_customer_id
        FROM buyer_staff_assignments assignment
        WHERE assignment.staff_id=?
          AND assignment.duty_code='BUYER_REFUND_OWNER'
          AND assignment.status='ACTIVE'
      )
    AND ${seekPredicate}
    ${withOrderAndLimit ? 'ORDER BY o.confirmed_at DESC, o.id DESC\n    LIMIT ?' : ''}
  `;
}

function explain(
  database: SqliteDatabase,
  indexHint: string,
  seekPredicate = SEEK_OR,
): QueryPlanRow[] {
  const rows = database.raw
    .prepare(`EXPLAIN QUERY PLAN ${orderListQuery(indexHint, seekPredicate)}`)
    .all(
      TARGET_MARKET,
      DISTRACTOR_MARKET,
      BUYER_REFUND_ID,
      ...seekParams(seekPredicate),
      5,
    ) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row['id']),
    parent: Number(row['parent']),
    detail: String(row['detail']),
  }));
}

function planText(plan: readonly QueryPlanRow[]): string {
  return JSON.stringify(plan);
}

function seekParams(seekPredicate: string): SQLInputValue[] {
  return seekPredicate === SEEK_ROW_VALUE
    ? [CONFIRMED_AT, 'zzzzzzzz']
    : [CONFIRMED_AT, CONFIRMED_AT, 'zzzzzzzz'];
}

function parentSortSteps(plan: readonly QueryPlanRow[]): QueryPlanRow[] {
  return plan.filter((row) => row.parent === 0 && row.detail === 'USE TEMP B-TREE FOR ORDER BY');
}

function nestedSortSteps(plan: readonly QueryPlanRow[]): QueryPlanRow[] {
  return plan.filter((row) => row.parent !== 0 && row.detail === 'USE TEMP B-TREE FOR ORDER BY');
}

function readOrderIds(database: SqliteDatabase, indexHint = '', seekPredicate = SEEK_OR): string[] {
  const rows = database.raw
    .prepare(orderListQuery(indexHint, seekPredicate))
    .all(
      TARGET_MARKET,
      DISTRACTOR_MARKET,
      BUYER_REFUND_ID,
      ...seekParams(seekPredicate),
      TOTAL_ORDERS + 1,
    ) as Array<Record<string, unknown>>;
  return rows.map((row) => String(row['id']));
}

interface CostProbe {
  page: 'first' | 'deep' | 'tail';
  start: number;
  cursorId: string | null;
  returnedRows: number;
  globalIndexCandidateRows: number;
  marketplaceIndexCandidateRows: number;
  amplification: number;
}

function readVisiblePage(database: SqliteDatabase, cursorId: string | null): string[] {
  const seekPredicate = cursorId === null ? '1=1' : SEEK_OR;
  const rows = database.raw
    .prepare(orderListQuery('', seekPredicate))
    .all(
      TARGET_MARKET,
      DISTRACTOR_MARKET,
      BUYER_REFUND_ID,
      ...(cursorId === null ? [] : [CONFIRMED_AT, CONFIRMED_AT, cursorId]),
      COST_PAGE_LIMIT + 1,
    ) as Array<Record<string, unknown>>;
  return rows.slice(0, COST_PAGE_LIMIT).map((row) => String(row['id']));
}

function candidateRowsForInterval(
  database: SqliteDatabase,
  indexName: 'idx_formal_orders_confirmed_id' | 'idx_formal_orders_market_confirmed_id',
  cursorId: string | null,
  lastId: string,
  scoped: boolean,
): number {
  // This is a deterministic pre-authorization candidate probe, not a timing
  // benchmark: it counts the exact key interval an index must inspect before
  // Marketplace and fixed-assignment predicates can discard rows.
  const predicates: string[] = [];
  const params: SQLInputValue[] = [];
  if (scoped) {
    predicates.push('o.marketplace_code IN (?,?)');
    params.push(TARGET_MARKET, DISTRACTOR_MARKET);
  }
  if (cursorId !== null) {
    predicates.push('(o.confirmed_at<? OR (o.confirmed_at=? AND o.id<?))');
    params.push(CONFIRMED_AT, CONFIRMED_AT, cursorId);
  }
  predicates.push('(o.confirmed_at>? OR (o.confirmed_at=? AND o.id>=?))');
  params.push(CONFIRMED_AT, CONFIRMED_AT, lastId);
  const row = database.raw
    .prepare(
      `SELECT COUNT(*) AS total
       FROM formal_orders o INDEXED BY ${indexName}
       WHERE ${predicates.join(' AND ')}`,
    )
    .get(...params) as { total: number };
  return Number(row.total);
}

function costProbeStarts(
  visibleRowCount: number,
): Array<{ page: CostProbe['page']; start: number }> {
  const tail = Math.max(0, visibleRowCount - COST_PAGE_LIMIT);
  const deep = Math.floor(visibleRowCount / 2);
  return [
    { page: 'first', start: 0 },
    { page: 'deep', start: deep },
    { page: 'tail', start: tail },
  ];
}

function collectCostProbes(corpus: SyntheticCorpus): CostProbe[] {
  return costProbeStarts(corpus.visibleOrderIds.length).map(({ page, start }) => {
    const cursorId = start === 0 ? null : corpus.visibleOrderIds[start - 1]!;
    const pageIds = readVisiblePage(corpus.database, cursorId);
    const lastId = pageIds.at(-1);
    if (!lastId) throw new Error(`empty_cost_probe_page:${page}`);
    const globalIndexCandidateRows = candidateRowsForInterval(
      corpus.database,
      'idx_formal_orders_confirmed_id',
      cursorId,
      lastId,
      false,
    );
    const marketplaceIndexCandidateRows = candidateRowsForInterval(
      corpus.database,
      'idx_formal_orders_market_confirmed_id',
      cursorId,
      lastId,
      true,
    );
    return {
      page,
      start,
      cursorId,
      returnedRows: pageIds.length,
      globalIndexCandidateRows,
      marketplaceIndexCandidateRows,
      amplification: globalIndexCandidateRows / marketplaceIndexCandidateRows,
    };
  });
}

function unionAllOrderIdsQuery(): string {
  const branch = orderListQuery('', SEEK_OR, 'o.marketplace_code=?', false);
  return `
    ${branch} UNION ALL ${branch}
    ORDER BY 10 DESC, 1 DESC
    LIMIT ?
  `;
}

function explainUnionAll(database: SqliteDatabase): QueryPlanRow[] {
  const rows = database.raw
    .prepare(`EXPLAIN QUERY PLAN ${unionAllOrderIdsQuery()}`)
    .all(
      TARGET_MARKET,
      BUYER_REFUND_ID,
      CONFIRMED_AT,
      CONFIRMED_AT,
      'synthetic-us-order-9999',
      DISTRACTOR_MARKET,
      BUYER_REFUND_ID,
      CONFIRMED_AT,
      CONFIRMED_AT,
      'synthetic-us-order-9999',
      5,
    ) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row['id']),
    parent: Number(row['parent']),
    detail: String(row['detail']),
  }));
}

function readUnionAllOrderIds(database: SqliteDatabase): string[] {
  const rows = database.raw
    .prepare(unionAllOrderIdsQuery())
    .all(
      TARGET_MARKET,
      BUYER_REFUND_ID,
      ...seekParams(SEEK_OR),
      DISTRACTOR_MARKET,
      BUYER_REFUND_ID,
      ...seekParams(SEEK_OR),
      TOTAL_ORDERS + 1,
    ) as Array<Record<string, unknown>>;
  return rows.map((row) => String(row['id']));
}

function capturingDatabase(database: SqliteDatabase, captures: CapturedStatement[]): SqlDatabase {
  return {
    prepare(sql: string): SqlStatement {
      const statement = database.prepare(sql);
      return {
        bind(...values: unknown[]): SqlStatement {
          captures.push({ sql, params: values });
          return statement.bind(...values);
        },
        first: () => statement.first(),
        all: () => statement.all(),
        run: () => statement.run(),
      };
    },
    batch: (statements) => database.batch(statements),
  };
}

async function request(
  database: SqliteDatabase,
  actor: AssignmentStaffAuthorization,
  path: string,
  captures: CapturedStatement[] = [],
): Promise<Response> {
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', `refund-plan-${crypto.randomUUID()}`);
    context.set('staffAuthorization', actor);
    await next();
  });
  registerStaffOrderDetailRoutes(app);
  return app.request(
    `${ORIGIN}${path}`,
    {},
    {
      DB: capturingDatabase(database, captures),
    },
  );
}

function capturedListStatement(captures: readonly CapturedStatement[]): CapturedStatement {
  const captured = [...captures]
    .reverse()
    .find(
      (entry) =>
        entry.sql.includes('FROM formal_orders o') &&
        entry.sql.includes('ORDER BY o.confirmed_at DESC, o.id DESC') &&
        entry.sql.includes('LIMIT ?'),
    );
  if (!captured) throw new Error('staff_order_list_sql_not_captured');
  return captured;
}

function capturedListPlan(
  database: SqliteDatabase,
  captures: readonly CapturedStatement[],
): QueryPlanRow[] {
  const captured = capturedListStatement(captures);
  const rows = database.raw
    .prepare(`EXPLAIN QUERY PLAN ${captured.sql}`)
    .all(...(captured.params as SQLInputValue[])) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row['id']),
    parent: Number(row['parent']),
    detail: String(row['detail']),
  }));
}

describe('buyer_refund fixed-assignment order-list query plan', () => {
  it.each(SELECTIVITY_CASES)(
    'records the Schema 37 baseline parent sort for $label',
    ({ share }) => {
      const corpus = seedSyntheticCorpus(share);
      const plan = explain(corpus.database, '');
      expect(planText(plan)).toContain('idx_formal_orders_market_confirmed_id');
      expect(parentSortSteps(plan).length).toBeGreaterThan(0);
      expect(nestedSortSteps(plan).length).toBeGreaterThan(0);
      corpus.database.close();
    },
  );

  it.each(SELECTIVITY_CASES)(
    'retains the real planner-selected route plan for $label',
    async ({ share }) => {
      const corpus = seedSyntheticCorpus(share);
      const captures: CapturedStatement[] = [];
      const first = await request(
        corpus.database,
        buyerRefundActor(),
        '/api/staff/formal-orders?limit=1',
      );
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as {
        data: { next_cursor: string | null };
      };
      expect(firstBody.data.next_cursor).not.toBeNull();
      const response = await request(
        corpus.database,
        buyerRefundActor(),
        `/api/staff/formal-orders?limit=5&cursor=${encodeURIComponent(firstBody.data.next_cursor!)}`,
        captures,
      );
      expect(response.status).toBe(200);
      const plan = capturedListPlan(corpus.database, captures);
      expect(planText(plan)).toContain('idx_formal_orders_market_confirmed_id');
      expect(capturedListStatement(captures).sql).not.toContain(
        'INDEXED BY idx_formal_orders_confirmed_id',
      );
      expect(capturedListStatement(captures).sql).toContain(
        '(o.confirmed_at<? OR (o.confirmed_at=? AND o.id<?))',
      );
      expect(parentSortSteps(plan).length).toBeGreaterThan(0);
      expect(nestedSortSteps(plan).length).toBeGreaterThan(0);
      corpus.database.close();
    },
  );

  it('preserves first/subsequent pages, tie-breaks, assignment miss, cursor echo and DENY', async () => {
    const corpus = seedSyntheticCorpus(0.2);
    const actor = buyerRefundActor();
    const firstCaptures: CapturedStatement[] = [];
    const first = await request(
      corpus.database,
      actor,
      `/api/staff/formal-orders?limit=5&confirmed_from=${CONFIRMED_AT}`,
      firstCaptures,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      data: {
        items: Array<{
          formal_order_id: string;
          marketplace_code: string;
          confirmed_at: number;
          seller_organization_id: string;
        }>;
        next_cursor: string | null;
      };
    };
    expect(firstBody.data.items.map((item) => item.formal_order_id)).toEqual(
      corpus.visibleOrderIds.slice(0, 5),
    );
    expect(firstBody.data.items.every((item) => item.confirmed_at === CONFIRMED_AT)).toBe(true);
    expect(firstBody.data.next_cursor).not.toBeNull();
    expect(capturedListStatement(firstCaptures).params.at(-1)).toBe(6);
    expect(JSON.parse(decodeCursor(firstBody.data.next_cursor!).echo)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      CONFIRMED_AT,
      null,
    ]);
    expect(
      firstBody.data.items.some((item) => corpus.targetOrderIds.includes(item.formal_order_id)),
    ).toBe(true);
    expect(
      firstBody.data.items.some((item) => item.formal_order_id === corpus.unassignedOrderId),
    ).toBe(false);

    const allIds = firstBody.data.items.map((item) => item.formal_order_id);
    const allMarkets = firstBody.data.items.map((item) => item.marketplace_code);
    const allOrganizations = firstBody.data.items.map((item) => item.seller_organization_id);
    let cursor = firstBody.data.next_cursor;
    let offset = firstBody.data.items.length;
    let pageCount = 1;
    while (cursor !== null) {
      const page = await request(
        corpus.database,
        actor,
        `/api/staff/formal-orders?limit=5&confirmed_from=${CONFIRMED_AT}&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(page.status).toBe(200);
      const body = (await page.json()) as {
        data: {
          items: Array<{
            formal_order_id: string;
            marketplace_code: string;
            confirmed_at: number;
            seller_organization_id: string;
          }>;
          next_cursor: string | null;
        };
      };
      const ids = body.data.items.map((item) => item.formal_order_id);
      expect(ids).toEqual(corpus.visibleOrderIds.slice(offset, offset + 5));
      expect(body.data.items.every((item) => item.confirmed_at === CONFIRMED_AT)).toBe(true);
      allIds.push(...ids);
      allMarkets.push(...body.data.items.map((item) => item.marketplace_code));
      allOrganizations.push(...body.data.items.map((item) => item.seller_organization_id));
      offset += ids.length;
      cursor = body.data.next_cursor;
      pageCount += 1;
      expect(pageCount).toBeLessThanOrEqual(corpus.visibleOrderIds.length + 1);
    }
    expect(allIds).toEqual(corpus.visibleOrderIds);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(new Set(allMarkets)).toEqual(new Set([TARGET_MARKET, DISTRACTOR_MARKET]));
    expect(new Set(allOrganizations)).toEqual(
      new Set(['synthetic-us-refund-seller', 'synthetic-jp-refund-seller']),
    );

    const mismatchedFilter = await request(
      corpus.database,
      actor,
      `/api/staff/formal-orders?limit=5&confirmed_to=${CONFIRMED_AT}&cursor=${encodeURIComponent(firstBody.data.next_cursor!)}`,
    );
    expect(mismatchedFilter.status).toBe(400);

    const hiddenDetail = await request(
      corpus.database,
      actor,
      `/api/staff/formal-orders/${corpus.unassignedOrderId}`,
    );
    expect(hiddenDetail.status).toBe(404);
    const denied = await request(
      corpus.database,
      buyerRefundActor(['ORDER_VIEW']),
      '/api/staff/formal-orders?limit=5',
    );
    expect(denied.status).toBe(403);
    corpus.database.close();
  });

  it('keeps the global index hint as a rejected equivalent candidate', () => {
    const corpus = seedSyntheticCorpus(0.2);
    const baseline = explain(corpus.database, '');
    const forced = explain(corpus.database, ' INDEXED BY idx_formal_orders_confirmed_id');
    expect(planText(baseline)).toContain('idx_formal_orders_market_confirmed_id');
    expect(planText(forced)).toContain('idx_formal_orders_confirmed_id');
    expect(parentSortSteps(baseline).length).toBeGreaterThan(0);
    expect(parentSortSteps(forced)).toEqual([]);
    expect(nestedSortSteps(forced).length).toBeGreaterThan(0);
    expect(readOrderIds(corpus.database, ' INDEXED BY idx_formal_orders_confirmed_id')).toEqual(
      readOrderIds(corpus.database),
    );
    corpus.database.close();
  });

  it.each(SELECTIVITY_CASES)(
    'rejects an unconditional global-index hint with deterministic cost probes for $label',
    ({ share, label }) => {
      const corpus = seedSyntheticCorpus(share);
      const baseline = explain(corpus.database, '');
      const forced = explain(corpus.database, ' INDEXED BY idx_formal_orders_confirmed_id');
      const probes = collectCostProbes(corpus);
      const maximumAmplification = Math.max(...probes.map((probe) => probe.amplification));

      expect(planText(baseline)).toContain('idx_formal_orders_market_confirmed_id');
      expect(planText(forced)).toContain('idx_formal_orders_confirmed_id');
      expect(parentSortSteps(baseline).length).toBeGreaterThan(0);
      expect(parentSortSteps(forced)).toEqual([]);
      expect(probes.map((probe) => probe.page)).toEqual(['first', 'deep', 'tail']);
      expect(probes.every((probe) => probe.returnedRows > 0)).toBe(true);
      expect(
        probes.every(
          (probe) => probe.globalIndexCandidateRows >= probe.marketplaceIndexCandidateRows,
        ),
      ).toBe(true);
      expect(
        probes.some(
          (probe) => probe.globalIndexCandidateRows > probe.marketplaceIndexCandidateRows,
        ),
      ).toBe(true);
      expect(maximumAmplification).toBeGreaterThan(1);
      if (share <= 0.2) expect(maximumAmplification).toBeGreaterThan(4);
      expect(corpus.visibleOrderIds).not.toContain(corpus.unassignedOrderId);
      expect(corpus.visibleOrderIds).toHaveLength(corpus.scopedOrderCount - 1);

      console.info(
        `[LOCAL COST EVIDENCE] ${label} total=${TOTAL_ORDERS}` +
          ` scoped=${corpus.scopedOrderCount} visible=${corpus.visibleOrderIds.length}` +
          ` ${probes
            .map(
              (probe) =>
                `${probe.page}=${probe.globalIndexCandidateRows}` +
                `/${probe.marketplaceIndexCandidateRows}`,
            )
            .join(' ')}`,
      );
      corpus.database.close();
    },
  );

  it.each(SELECTIVITY_CASES)(
    'evaluates row-value and UNION ALL rewrite plans for $label',
    ({ share }) => {
      const corpus = seedSyntheticCorpus(share);
      const baseline = explain(corpus.database, '');
      const rowValue = explain(corpus.database, '', SEEK_ROW_VALUE);
      const unionAll = explainUnionAll(corpus.database);
      expect(parentSortSteps(baseline).length).toBeGreaterThan(0);
      expect(parentSortSteps(rowValue).length).toBeGreaterThan(0);
      expect(unionAll.some((row) => row.detail === 'MERGE (UNION ALL)')).toBe(true);
      expect(parentSortSteps(unionAll)).toEqual([]);
      expect(readOrderIds(corpus.database, '', SEEK_ROW_VALUE)).toEqual(
        readOrderIds(corpus.database),
      );
      expect(readUnionAllOrderIds(corpus.database)).toEqual(readOrderIds(corpus.database));
      corpus.database.close();
    },
  );
});
