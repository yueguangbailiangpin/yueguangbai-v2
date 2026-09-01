import { Hono } from 'hono';
import type { SQLInputValue } from 'node:sqlite';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { describe, expect, it } from 'vitest';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { decodeCursor, registerStaffOrderDetailRoutes } from './routes';
import { responsibilitySelects } from './responsibility';

/**
 * Forward-performance preparation for the future multi-market rollout.
 *
 * The corpus is synthetic and is written through the current canonical schema
 * with the existing source guards. It does not add or alter marketplace
 * registry/configuration rows. The request path remains the existing Staff
 * order list with fixed seller assignment plus one marketplace scope.
 */

const ORIGIN = 'https://api.example.test';
const TOTAL_ORDERS = 100;
const CONFIRMED_AT = Date.UTC(2026, 7, 1, 0, 0, 0);
const OWNER_ID = 'zz-phase3h-test-owner';
const SELLER_OPS_ID = 'synthetic-multimarket-seller-ops';
const BUYER_REFUND_ID = 'synthetic-multimarket-buyer-refund';
const TARGET_MARKET = 'AMAZON_US';
const DISTRACTOR_MARKET = 'AMAZON_JP';
const SELECTIVITY_CASES = [
  { label: 'low-selectivity', share: 0.01 },
  { label: 'medium-selectivity', share: 0.2 },
  { label: 'high-selectivity', share: 0.8 },
] as const;

interface SyntheticCorpus {
  database: SqliteDatabase;
  targetCount: number;
  targetOrderIds: string[];
}

interface QueryPlanRow {
  id: number;
  parent: number;
  detail: string;
}

function sellerOpsActor(): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set(['seller_ops']),
    grants: new Set(),
    denies: new Set(),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId: SELLER_OPS_ID,
    displayName: '合成卖家运营',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: effective.roles,
    permissions: effective.permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

function seedSyntheticCorpus(targetShare: number, throughSchemaVersion?: number): SyntheticCorpus {
  const database =
    throughSchemaVersion === undefined
      ? createMigratedTestDatabase()
      : createMigratedTestDatabase({ throughSchemaVersion });
  const targetCount = Math.round(TOTAL_ORDERS * targetShare);
  const targetOrderIds = Array.from(
    { length: targetCount },
    (_, index) => `synthetic-us-order-${String(index).padStart(4, '0')}`,
  );

  database.exec(`
    INSERT INTO staff_users(
      id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at
    ) VALUES
      ('${SELLER_OPS_ID}','合成卖家运营','ACTIVE',1,1,1000,1000,NULL),
      ('${BUYER_REFUND_ID}','合成返款员工','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO staff_role_assignments(
      id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at
    ) VALUES
      ('synthetic-seller-ops-role','${SELLER_OPS_ID}','seller_ops','ACTIVE','${OWNER_ID}',1000,NULL,1000,1000),
      ('synthetic-buyer-refund-role','${BUYER_REFUND_ID}','buyer_refund','ACTIVE','${OWNER_ID}',1000,NULL,1000,1000);
    INSERT INTO staff_marketplace_scopes(
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,revoked_at,
      reason,created_at,updated_at,scope_kind
    ) VALUES
      ('synthetic-seller-ops-us-scope','${SELLER_OPS_ID}','seller_ops','${TARGET_MARKET}',
        'ACTIVE','${OWNER_ID}',1000,NULL,'synthetic query-plan scope',1000,1000,'PRIMARY'),
      ('synthetic-buyer-refund-jp-scope','${BUYER_REFUND_ID}','buyer_refund','${DISTRACTOR_MARKET}',
        'ACTIVE','${OWNER_ID}',1000,NULL,'synthetic query-plan scope',1000,1000,'PRIMARY'),
      ('synthetic-buyer-refund-us-scope','${BUYER_REFUND_ID}','buyer_refund','${TARGET_MARKET}',
        'ACTIVE','${OWNER_ID}',1000,NULL,'synthetic query-plan scope',1000,1000,'SUPPORT');
    INSERT OR IGNORE INTO buyer_channels(
      id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at
    ) VALUES('buyer-channel-wechat-b','B','合成查询计划渠道','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO seller_organizations(
      id,marketplace_code,seller_code,origin_channel_id,current_channel_id,seller_sequence,
      organization_name,status,version,created_at,updated_at,activated_at,disabled_at,next_member_number
    ) VALUES
      ('synthetic-us-seller','${TARGET_MARKET}','synthetic-us-seller','seller-channel-ido-mango',
        'seller-channel-ido-mango',9801,'合成美国市场卖家','ACTIVE',1,1000,1000,1000,NULL,2),
      ('synthetic-jp-seller','${DISTRACTOR_MARKET}','synthetic-jp-seller','seller-channel-ido-mango',
        'seller-channel-ido-mango',9802,'合成日本市场卖家','ACTIVE',1,1000,1000,1000,NULL,2);
    INSERT INTO customer_identity_subjects(id,subject_type,created_at) VALUES
      ('synthetic-us-seller-subject','SELLER_ORG_MEMBER',1000),
      ('synthetic-jp-seller-subject','SELLER_ORG_MEMBER',1000);
    INSERT INTO seller_organization_members(
      id,identity_subject_id,organization_id,member_number,username_fallback,display_name,role,
      primary_owner,status,version,created_at,updated_at,activated_at,disabled_at
    ) VALUES
      ('synthetic-us-seller-member','synthetic-us-seller-subject','synthetic-us-seller',1,
        'synthetic-us-owner','合成美国卖家负责人','OWNER',1,'ACTIVE',1,1000,1000,1000,NULL),
      ('synthetic-jp-seller-member','synthetic-jp-seller-subject','synthetic-jp-seller',1,
        'synthetic-jp-owner','合成日本卖家负责人','OWNER',1,'ACTIVE',1,1000,1000,1000,NULL);
    INSERT INTO seller_stores(
      id,organization_id,marketplace_code,display_name,normalized_name,status,version,
      created_at,updated_at,disabled_at
    ) VALUES
      ('synthetic-us-store','synthetic-us-seller','${TARGET_MARKET}','合成美国店铺','合成美国店铺',
        'ACTIVE',1,1000,1000,NULL),
      ('synthetic-jp-store','synthetic-jp-seller','${DISTRACTOR_MARKET}','合成日本店铺','合成日本店铺',
        'ACTIVE',1,1000,1000,NULL);
    INSERT INTO products(
      id,organization_id,store_id,marketplace_code,asin_display,asin_normalized,status,
      current_version_no,version,created_at,updated_at,disabled_at
    ) VALUES
      ('synthetic-us-product','synthetic-us-seller','synthetic-us-store','${TARGET_MARKET}',
        'B0SYNTHUS1','B0SYNTHUS1','ACTIVE',1,1,1000,1000,NULL),
      ('synthetic-jp-product','synthetic-jp-seller','synthetic-jp-store','${DISTRACTOR_MARKET}',
        'B0SYNTHJP1','B0SYNTHJP1','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO product_versions(
      id,product_id,version_no,product_name,search_keywords_json,product_url,buyer_visible_notes,
      internal_notes,created_by_staff_id,created_at,ordering_guide_expected_amount_jpy,color_spec_mode
    ) VALUES
      ('synthetic-us-product-version','synthetic-us-product',1,'合成美国产品','[]',NULL,NULL,NULL,
        '${OWNER_ID}',1000,1980,'MAIN_IMAGE_VARIANT'),
      ('synthetic-jp-product-version','synthetic-jp-product',1,'合成日本产品','[]',NULL,NULL,NULL,
        '${OWNER_ID}',1000,1980,'MAIN_IMAGE_VARIANT');
    INSERT INTO demand_batches(
      id,organization_id,store_id,marketplace_code,product_id,product_version_no,submitted_by_member_id,
      task_type,target_quantity,buyer_visible_notes,seller_notes,open_at,reservation_deadline,order_deadline,
      status,review_reason,close_reason,reviewed_by_staff_id,closed_by_staff_id,version,submitted_at,
      updated_at,reviewed_at,published_at,withdrawn_at,closed_at,held_reservation_count,approved_reservation_count
    ) VALUES
      ('synthetic-us-demand','synthetic-us-seller','synthetic-us-store','${TARGET_MARKET}',
        'synthetic-us-product',1,'synthetic-us-seller-member','IMAGE',${targetCount || 1},NULL,NULL,
        2000,5000,20000,'PUBLISHED',NULL,NULL,'${OWNER_ID}',NULL,2,1000,3000,3000,3000,NULL,NULL,0,${targetCount}),
      ('synthetic-jp-demand','synthetic-jp-seller','synthetic-jp-store','${DISTRACTOR_MARKET}',
        'synthetic-jp-product',1,'synthetic-jp-seller-member','IMAGE',${TOTAL_ORDERS - targetCount || 1},NULL,NULL,
        2000,5000,20000,'PUBLISHED',NULL,NULL,'${OWNER_ID}',NULL,2,1000,3000,3000,3000,NULL,NULL,0,${TOTAL_ORDERS - targetCount});
    INSERT INTO seller_staff_assignments(
      id,seller_organization_id,duty_code,staff_id,status,source,assigned_by_actor_type,
      assigned_by_actor_id,reason,version,created_at,updated_at,revoked_at
    ) VALUES('synthetic-seller-account-assignment','synthetic-us-seller','SELLER_ACCOUNT_MANAGER',
      '${SELLER_OPS_ID}','ACTIVE','MANUAL_REASSIGN','STAFF','${OWNER_ID}',
      'synthetic query-plan assignment',1,1000,1000,NULL);
  `);

  seedMarketRows(database, TARGET_MARKET, 'us', targetCount, 0);
  seedMarketRows(database, DISTRACTOR_MARKET, 'jp', TOTAL_ORDERS - targetCount, targetCount);
  seedBuyerRefundAssignments(database);

  const counts = database.raw
    .prepare(
      `
    SELECT marketplace_code,COUNT(*) AS count
    FROM formal_orders
    GROUP BY marketplace_code
    ORDER BY marketplace_code
  `,
    )
    .all() as Array<{ marketplace_code: string; count: number }>;
  expect(counts.reduce((sum, row) => sum + Number(row.count), 0)).toBe(TOTAL_ORDERS);
  expect(counts).toEqual(
    expect.arrayContaining([
      { marketplace_code: TARGET_MARKET, count: targetCount },
      { marketplace_code: DISTRACTOR_MARKET, count: TOTAL_ORDERS - targetCount },
    ]),
  );

  return { database, targetCount, targetOrderIds };
}

function seedMarketRows(
  database: SqliteDatabase,
  marketplaceCode: string,
  marketKey: string,
  count: number,
  buyerSequenceOffset: number,
): void {
  if (count < 1) return;
  const demandId = `synthetic-${marketKey}-demand`;
  const sellerId = `synthetic-${marketKey}-seller`;
  const storeId = `synthetic-${marketKey}-store`;
  const productId = `synthetic-${marketKey}-product`;
  const productVersionId = `synthetic-${marketKey}-product-version`;
  const marketBusinessDate = '2026-08-01';
  const startSequence = 10000 + buyerSequenceOffset;
  const startOrderNumber = marketKey === 'us' ? 0 : 5000;

  database.raw.exec('BEGIN');
  try {
    database.raw
      .prepare(
        `
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i+1<?)
      INSERT INTO customer_identity_subjects(id,subject_type,created_at)
      SELECT 'synthetic-${marketKey}-buyer-subject-'||printf('%04d',i),'BUYER_CUSTOMER',1000 FROM n
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
      SELECT 'synthetic-${marketKey}-buyer-'||printf('%04d',i),
        'synthetic-${marketKey}-buyer-subject-'||printf('%04d',i),?,
        'buyer-channel-wechat-b','20260801B'||printf('%05d',${startSequence}+i),
        ${startSequence}+i,'合成${marketKey}买家'||i,'ACTIVE','CLEAR',1,1000,1000,1000,NULL
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
      SELECT 'synthetic-${marketKey}-reservation-'||printf('%04d',i),?,
        'synthetic-${marketKey}-buyer-'||printf('%04d',i),?,?,?,1,?,
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
      SELECT 'synthetic-${marketKey}-marker-'||printf('%04d',i),
        'synthetic-${marketKey}-reservation-'||printf('%04d',i),NULL,
        'HISTORICAL_EVIDENCE_CONTEXT','{}',1000
      FROM n
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
      SELECT 'synthetic-${marketKey}-submission-'||printf('%04d',i),
        'synthetic-${marketKey}-reservation-'||printf('%04d',i),
        'synthetic-${marketKey}-buyer-'||printf('%04d',i),?,'PENDING_VERIFICATION',1,1,NULL,NULL,
        7000,7000,NULL,NULL,NULL,NULL,7000
      FROM n
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
      SELECT 'synthetic-${marketKey}-evidence-'||printf('%04d',i),
        'synthetic-${marketKey}-submission-'||printf('%04d',i),
        'synthetic-${marketKey}-reservation-'||printf('%04d',i),
        'synthetic-${marketKey}-buyer-'||printf('%04d',i),?,1,
        '123-9000000-'||printf('%07d',${startOrderNumber}+i),
        '123-9000000-'||printf('%07d',${startOrderNumber}+i),?,1980,
        'synthetic-${marketKey}-buyer-'||printf('%04d',i),NULL,NULL,7000
      FROM n
    `,
      )
      .run(count, marketplaceCode, marketBusinessDate);
    database.raw
      .prepare(
        `
      UPDATE order_evidence_submissions
      SET status='VERIFIED',version=2,verified_by_staff_id=?,verified_at=8000,updated_at=8000
      WHERE id LIKE 'synthetic-${marketKey}-submission-%'
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
      SELECT 'synthetic-${marketKey}-order-'||printf('%04d',i),
        'synthetic-${marketKey}-submission-'||printf('%04d',i),
        'synthetic-${marketKey}-evidence-'||printf('%04d',i),
        'synthetic-${marketKey}-reservation-'||printf('%04d',i),?,
        'synthetic-${marketKey}-buyer-'||printf('%04d',i),
        '20260801B'||printf('%05d',${startSequence}+i),?,?,?,
        ?,?,1,?,?,'${marketKey === 'us' ? '合成美国产品' : '合成日本产品'}','IMAGE',
        '123-9000000-'||printf('%07d',${startOrderNumber}+i),
        '123-9000000-'||printf('%07d',${startOrderNumber}+i),1980,'CONFIRMED',1,?,
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
        marketKey === 'us' ? 'B0SYNTHUS1' : 'B0SYNTHJP1',
        marketKey === 'us' ? 'B0SYNTHUS1' : 'B0SYNTHJP1',
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

function seedBuyerRefundAssignments(database: SqliteDatabase): void {
  for (const marketKey of ['us', 'jp']) {
    const count = Number(
      database.raw
        .prepare(
          `SELECT COUNT(*) AS count FROM buyer_customers WHERE id LIKE 'synthetic-${marketKey}-buyer-%'`,
        )
        .get()?.['count'] ?? 0,
    );
    database.raw
      .prepare(
        `
      INSERT INTO buyer_staff_assignments(
        id,buyer_customer_id,duty_code,staff_id,status,source,assigned_by_actor_type,
        assigned_by_actor_id,reason,version,created_at,updated_at,revoked_at
      )
      SELECT 'synthetic-${marketKey}-refund-assignment-'||printf('%04d',i),
        'synthetic-${marketKey}-buyer-'||printf('%04d',i),'BUYER_REFUND_OWNER',?,
        'ACTIVE','MANUAL_REASSIGN','STAFF',?,'synthetic query-plan assignment',1,1000,1000,NULL
      FROM (WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i+1<?) SELECT i FROM n)
    `,
      )
      .run(BUYER_REFUND_ID, OWNER_ID, count);
  }
}

function staffListPlan(
  database: SqliteDatabase,
  where: string,
  params: readonly SQLInputValue[],
): QueryPlanRow[] {
  const rows = database.raw
    .prepare(
      `
    EXPLAIN QUERY PLAN
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
    FROM formal_orders o
    JOIN seller_stores store ON store.id=o.store_id
    JOIN buyer_customers buyer ON buyer.id=o.buyer_customer_id
    LEFT JOIN formal_order_financial_snapshots snapshot
      ON snapshot.formal_order_id=o.id
    WHERE ${where}
    ORDER BY o.confirmed_at DESC, o.id DESC
    LIMIT ?
  `,
    )
    .all(...params);
  return rows.map((row) => ({
    id: Number(row['id']),
    parent: Number(row['parent']),
    detail: String(row['detail']),
  }));
}

function planText(plan: readonly QueryPlanRow[]): string {
  return JSON.stringify(plan);
}

function topLevelSortSteps(plan: readonly QueryPlanRow[]): QueryPlanRow[] {
  return plan.filter((row) => row.parent === 0 && row.detail === 'USE TEMP B-TREE FOR ORDER BY');
}

function sellerOpsMarketPlan(database: SqliteDatabase): QueryPlanRow[] {
  return staffListPlan(
    database,
    `o.marketplace_code IN (?)
     AND o.seller_organization_id IN (
       SELECT assignment.seller_organization_id
       FROM seller_staff_assignments assignment
       WHERE assignment.staff_id=?
         AND assignment.duty_code='SELLER_ACCOUNT_MANAGER'
         AND assignment.status='ACTIVE'
     )
     AND (o.confirmed_at<? OR (o.confirmed_at=? AND o.id<?))`,
    [TARGET_MARKET, SELLER_OPS_ID, CONFIRMED_AT, CONFIRMED_AT, 'synthetic-us-order-9999', 38],
  );
}

async function listPage(
  database: SqliteDatabase,
  actor: AssignmentStaffAuthorization,
  query: string,
): Promise<Response> {
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', `synthetic-${crypto.randomUUID()}`);
    context.set('staffAuthorization', actor);
    await next();
  });
  registerStaffOrderDetailRoutes(app);
  return app.request(`${ORIGIN}/api/staff/formal-orders${query}`, {}, { DB: database });
}

describe('future multi-market Staff order-list index preparation', () => {
  it.each(SELECTIVITY_CASES)(
    'records the real Schema 36 fallback for $label scoped pages',
    ({ share }) => {
      const corpus = seedSyntheticCorpus(share, 36);
      const schema = corpus.database.raw
        .prepare('SELECT schema_version FROM app_schema_state WHERE singleton_id=1')
        .get() as { schema_version: number };
      const candidateIndex = corpus.database.raw
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type='index' AND name='idx_formal_orders_market_confirmed_id'`,
        )
        .get();
      expect(Number(schema.schema_version)).toBe(36);
      expect(candidateIndex).toBeUndefined();

      const plan = sellerOpsMarketPlan(corpus.database);
      expect(planText(plan)).not.toContain('idx_formal_orders_market_confirmed_id');
      expect(planText(plan)).toMatch(/idx_formal_orders_marketplace_business_date/u);
      expect(topLevelSortSteps(plan).length).toBeGreaterThan(0);
    },
  );

  it.each(SELECTIVITY_CASES)(
    'uses the marketplace-leading order index for $label scoped pages',
    async ({ share }) => {
      const corpus = seedSyntheticCorpus(share);
      const schema = corpus.database.raw
        .prepare('SELECT schema_version FROM app_schema_state WHERE singleton_id=1')
        .get() as { schema_version: number };
      expect(Number(schema.schema_version)).toBe(39);
      const actor = sellerOpsActor();
      const expected = [...corpus.targetOrderIds].reverse();
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 40; page += 1) {
        const query =
          cursor === null ? '?limit=37' : `?limit=37&cursor=${encodeURIComponent(cursor)}`;
        const response = await listPage(corpus.database, actor, query);
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          data: {
            items: Array<{ formal_order_id: string; marketplace_code: string }>;
            next_cursor: string | null;
          };
        };
        expect(body.data.items.every((item) => item.marketplace_code === TARGET_MARKET)).toBe(true);
        seen.push(...body.data.items.map((item) => item.formal_order_id));
        cursor = body.data.next_cursor;
        if (cursor === null) break;
      }
      expect(seen).toEqual(expected);

      const plan = sellerOpsMarketPlan(corpus.database);
      expect(planText(plan)).toMatch(
        /SEARCH o USING (?:COVERING )?INDEX idx_formal_orders_market_confirmed_id/u,
      );
      expect(topLevelSortSteps(plan)).toEqual([]);
    },
  );

  it('keeps the owner no-market path on the existing confirmed_at/id index', () => {
    const corpus = seedSyntheticCorpus(0.2);
    const index = corpus.database.raw
      .prepare(
        `
      SELECT sql FROM sqlite_schema
      WHERE type='index' AND name='idx_formal_orders_market_confirmed_id'
    `,
      )
      .get() as { sql: string };
    expect(index.sql).toMatch(
      /formal_orders\s*\(marketplace_code,\s*confirmed_at DESC,\s*id DESC\)/u,
    );
    const plan = staffListPlan(
      corpus.database,
      '(o.confirmed_at<? OR (o.confirmed_at=? AND o.id<?))',
      [CONFIRMED_AT, CONFIRMED_AT, 'synthetic-us-order-9999', 38],
    );
    expect(planText(plan)).toContain('idx_formal_orders_confirmed_id');
    expect(planText(plan)).not.toContain('idx_formal_orders_market_confirmed_id');
  });

  it('preserves cursor filter echo at the existing HTTP boundary', async () => {
    const corpus = seedSyntheticCorpus(0.2);
    const filter = `confirmed_from=${CONFIRMED_AT}`;
    const first = await listPage(corpus.database, sellerOpsActor(), `?limit=2&${filter}`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      data: {
        items: Array<{ formal_order_id: string; marketplace_code: string }>;
        next_cursor: string | null;
      };
    };
    expect(firstBody.data.next_cursor).not.toBeNull();
    expect(firstBody.data.items).toHaveLength(2);
    expect(firstBody.data.items.every((item) => item.marketplace_code === TARGET_MARKET)).toBe(
      true,
    );
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

    const sameFilterPage = await listPage(
      corpus.database,
      sellerOpsActor(),
      `?limit=2&${filter}&cursor=${encodeURIComponent(firstBody.data.next_cursor!)}`,
    );
    expect(sameFilterPage.status).toBe(200);
    const sameFilterBody = (await sameFilterPage.json()) as {
      data: {
        items: Array<{ formal_order_id: string; marketplace_code: string }>;
        next_cursor: string | null;
      };
    };
    expect(sameFilterBody.data.items).toHaveLength(2);
    expect(sameFilterBody.data.items.every((item) => item.marketplace_code === TARGET_MARKET)).toBe(
      true,
    );
    expect(sameFilterBody.data.items.map((item) => item.formal_order_id)).toEqual(
      [...corpus.targetOrderIds].reverse().slice(2, 4),
    );

    const mismatchedFilter = await listPage(
      corpus.database,
      sellerOpsActor(),
      `?limit=2&cursor=${encodeURIComponent(firstBody.data.next_cursor!)}`,
    );
    expect(mismatchedFilter.status).toBe(400);
  });

  it('keeps buyer-refund fixed-assignment planning outside the no-temp-sort claim', () => {
    const corpus = seedSyntheticCorpus(0.2);
    const plan = staffListPlan(
      corpus.database,
      `o.marketplace_code IN (?,?)
       AND o.buyer_customer_id IN (
         SELECT assignment.buyer_customer_id
         FROM buyer_staff_assignments assignment
         WHERE assignment.staff_id=?
           AND assignment.duty_code='BUYER_REFUND_OWNER'
           AND assignment.status='ACTIVE'
       )
       AND (o.confirmed_at<? OR (o.confirmed_at=? AND o.id<?))`,
      [
        TARGET_MARKET,
        DISTRACTOR_MARKET,
        BUYER_REFUND_ID,
        CONFIRMED_AT,
        CONFIRMED_AT,
        'synthetic-us-order-9999',
        38,
      ],
    );
    expect(planText(plan)).toMatch(/idx_formal_orders_market_confirmed_id/u);
    // The fixed-assignment seek OR still has a top-level sort TEMP-BTREE on
    // the current SQLite planner; keep this as an explicit follow-up boundary.
    expect(topLevelSortSteps(plan).length).toBeGreaterThan(0);
  });
});
