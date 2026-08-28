import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { registerStaffOrderDetailRoutes } from './routes';

/**
 * Stage 7.5 batch 1 capacity verification: 20,000 historical orders plus 200
 * same-day orders. Proves the keyset cursor list stays correct and
 * index-driven at target volume: full pagination with no duplicates or gaps,
 * representative filters, and EXPLAIN QUERY PLAN free of full scans over
 * formal_orders.
 */

const TOTAL_ORDERS = 20_200;
const ORIGIN = 'https://api.example.test';

let database: SqliteDatabase | null = null;
let seeded = false;

async function ensureSeeded(): Promise<SqliteDatabase> {
  if (database !== null && seeded) return database;
  database = createMigratedTestDatabase();
  const db = database;

  db.exec(`
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
    VALUES('cap-owner','容量管理员','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at)
    VALUES('cap-owner-role','cap-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000);
    INSERT INTO customer_identity_subjects(id,subject_type,created_at)
    VALUES('cap-seller-subject','SELLER_ORG_MEMBER',1000);
    INSERT OR IGNORE INTO buyer_channels(id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at)
    VALUES('buyer-channel-wechat-b','B','买家微信对接渠道 B','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO seller_organizations(id,marketplace_code,seller_code,origin_channel_id,current_channel_id,seller_sequence,
      organization_name,status,version,created_at,updated_at,activated_at,disabled_at,next_member_number)
    VALUES('cap-seller','AMAZON_JP','cap-seller','seller-channel-ido-mango','seller-channel-ido-mango',9700,
      '容量卖家','ACTIVE',1,1000,1000,1000,NULL,2);
    INSERT INTO seller_organization_members(id,identity_subject_id,organization_id,member_number,username_fallback,
      display_name,role,primary_owner,status,version,created_at,updated_at,activated_at,disabled_at)
    VALUES('cap-seller-member','cap-seller-subject','cap-seller',1,'cap-seller-1','负责人','OWNER',1,'ACTIVE',1,1000,1000,1000,NULL);
    INSERT INTO seller_stores(id,organization_id,marketplace_code,display_name,normalized_name,status,version,created_at,updated_at,disabled_at)
    VALUES('cap-store','cap-seller','AMAZON_JP','容量店铺','容量店铺','ACTIVE',1,1000,1000,NULL);
    INSERT INTO products(id,organization_id,store_id,marketplace_code,asin_display,asin_normalized,status,current_version_no,
      version,created_at,updated_at,disabled_at)
    VALUES('cap-product','cap-seller','cap-store','AMAZON_JP','B0CAPCITY1','B0CAPCITY1','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO product_versions(id,product_id,version_no,product_name,search_keywords_json,product_url,buyer_visible_notes,
      internal_notes,created_by_staff_id,created_at,ordering_guide_expected_amount_jpy,color_spec_mode)
    VALUES('cap-product-version','cap-product',1,'容量产品','[]',NULL,NULL,NULL,'cap-owner',1000,1980,'MAIN_IMAGE_VARIANT');
    INSERT INTO buyer_daily_currency_rate_versions(id,business_date,source_currency_code,quote_currency_code,version_no,
      rate_value,rate_scale,rounding_rule,effective_from,created_by_staff_id,created_at)
    VALUES('cap-rate','2026-08-01','JPY','CNY',1,5500000,100000000,'HALF_UP',2000,'cap-owner',2000);
    INSERT INTO seller_service_fee_rule_versions(id,seller_organization_id,marketplace_code,review_type,version_no,
      fee_amount_minor,fee_currency_code,fee_currency_exponent,effective_from,created_by_staff_id,created_at)
    VALUES('cap-fee','cap-seller','AMAZON_JP','IMAGE',1,2500,'CNY',2,2000,'cap-owner',2000);
    INSERT INTO demand_batches(id,organization_id,store_id,marketplace_code,product_id,product_version_no,submitted_by_member_id,
      task_type,target_quantity,buyer_visible_notes,seller_notes,open_at,reservation_deadline,order_deadline,status,review_reason,
      close_reason,reviewed_by_staff_id,closed_by_staff_id,version,submitted_at,updated_at,reviewed_at,published_at,withdrawn_at,
      closed_at,held_reservation_count,approved_reservation_count)
    VALUES('cap-demand','cap-seller','cap-store','AMAZON_JP','cap-product',1,'cap-seller-member',
      'IMAGE',1000,NULL,NULL,2000,5000,20000,'PUBLISHED',NULL,NULL,'cap-owner',NULL,2,1000,3000,3000,3000,NULL,NULL,0,1);
  `);

  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  // Spread orders across ~101 days; the newest 200 land on the final day so
  // the "200 same-day orders" shape is exercised by the date-range filter.
  for (let chunkStart = 0; chunkStart < TOTAL_ORDERS; chunkStart += 2000) {
    const chunkEnd = Math.min(chunkStart + 2000, TOTAL_ORDERS);
    const params = [chunkStart, chunkEnd - 1];
    db.raw.exec('BEGIN');
    db.raw.prepare(`
      WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i+1 FROM n WHERE i<?)
      INSERT INTO customer_identity_subjects(id,subject_type,created_at)
      SELECT 'cap-subject-'||i,'BUYER_CUSTOMER',1000 FROM n
    `).run(...params);
    db.raw.prepare(`
      WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i+1 FROM n WHERE i<?)
      INSERT INTO buyer_customers(id,identity_subject_id,marketplace_code,buyer_channel_id,buyer_customer_no,
        buyer_sequence,display_name,access_status,identity_review_status,version,created_at,updated_at,
        activated_at,disabled_at)
      SELECT 'cap-buyer-'||i,'cap-subject-'||i,'AMAZON_JP','buyer-channel-wechat-b',
        '20260801B'||printf('%05d',90000+i),90000+i,'容量买家'||i,'ACTIVE','CLEAR',1,1000,1000,1000,NULL
      FROM n
    `).run(...params);
    db.raw.prepare(`
      WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i+1 FROM n WHERE i<?),
      confirmed AS (SELECT i, ${base} + (i / 200) * ${day} AS confirmed_at FROM n)
      INSERT INTO product_reservations(id,demand_batch_id,buyer_customer_id,organization_id,store_id,product_id,
        product_version_no,marketplace_code,status,precheck_snapshot_json,hold_expires_at,order_deadline_snapshot,
        version,submitted_at,updated_at,decided_by_staff_id,decision_reason,decided_at,cancelled_at,expired_at,
        reopened_count,buyer_self_pay_bps_snapshot,reference_order_amount_jpy_snapshot,
        estimated_self_pay_jpy_snapshot,estimated_refundable_principal_jpy_snapshot,
        buyer_self_pay_accepted_at,buyer_self_pay_accepted_demand_version)
      SELECT 'cap-resv-'||i,'cap-demand','cap-buyer-'||i,'cap-seller','cap-store','cap-product',1,
        'AMAZON_JP','APPROVED','{}',5000,20000,2,4000,6000,'cap-owner',NULL,6000,NULL,NULL,0,0,1980,0,1980,4000,2
      FROM confirmed
    `).run(...params);
    db.raw.prepare(`
      WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i+1 FROM n WHERE i<?)
      INSERT INTO order_instruction_reconciliation_markers(id,reservation_id,instruction_id,disposition,
        metadata_json,created_at)
      SELECT 'cap-marker-'||i,'cap-resv-'||i,NULL,'HISTORICAL_EVIDENCE_CONTEXT','{}',1000 FROM n
    `).run(...params);
    db.raw.prepare(`
      WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i+1 FROM n WHERE i<?),
      confirmed AS (SELECT i, ${base} + (i / 200) * ${day} AS confirmed_at FROM n)
      INSERT INTO order_evidence_submissions(id,reservation_id,buyer_customer_id,marketplace_code,status,
        current_version_no,version,public_change_reason,internal_review_note,submitted_at,updated_at,
        verified_by_staff_id,verified_at,withdrawn_at,consumed_at,created_at)
      SELECT 'cap-sub-'||i,'cap-resv-'||i,'cap-buyer-'||i,'AMAZON_JP','PENDING_VERIFICATION',1,1,NULL,NULL,
        confirmed_at+7000,confirmed_at+7000,NULL,NULL,NULL,NULL,confirmed_at+7000
      FROM confirmed
    `).run(...params);
    db.raw.prepare(`
      WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i+1 FROM n WHERE i<?),
      confirmed AS (SELECT i, ${base} + (i / 200) * ${day} AS confirmed_at FROM n)
      INSERT INTO order_evidence_versions(id,submission_id,reservation_id,buyer_customer_id,marketplace_code,
        version_no,amazon_order_number_raw,amazon_order_number_normalized,amazon_order_date,final_paid_jpy,
        submitted_by_buyer_id,buyer_note,submitted_before_deadline,created_at)
      SELECT 'cap-ev-'||i,'cap-sub-'||i,'cap-resv-'||i,'cap-buyer-'||i,'AMAZON_JP',1,
        '123-9000000-'||printf('%07d',i),'123-9000000-'||printf('%07d',i),'2026-08-01',1980,
        'cap-buyer-'||i,NULL,NULL,confirmed_at+7000
      FROM confirmed
    `).run(...params);
    db.raw.prepare(`
      UPDATE order_evidence_submissions SET status='VERIFIED',version=2,verified_by_staff_id='cap-owner',
        verified_at=submitted_at+1000,updated_at=submitted_at+1000
      WHERE id LIKE 'cap-sub-%' AND status='PENDING_VERIFICATION'
    `).run();
    db.raw.prepare(`
      WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i+1 FROM n WHERE i<?),
      confirmed AS (SELECT i, ${base} + (i / 200) * ${day} AS confirmed_at FROM n)
      INSERT INTO formal_orders(id,order_evidence_submission_id,order_evidence_version_id,reservation_id,
        demand_batch_id,buyer_customer_id,buyer_customer_no,seller_organization_id,store_id,marketplace_code,
        product_id,product_version_id,product_version_no,asin_display,asin_normalized,product_name_snapshot,
        review_type,amazon_order_number_raw,amazon_order_number_normalized,final_paid_jpy,status,version,
        confirmed_by_staff_id,confirmed_at,confirmed_business_date,created_at,amazon_order_date)
      SELECT 'cap-order-'||i,'cap-sub-'||i,'cap-ev-'||i,'cap-resv-'||i,'cap-demand',
        'cap-buyer-'||i,'20260801B'||printf('%05d',90000+i),'cap-seller','cap-store','AMAZON_JP','cap-product','cap-product-version',1,
        'B0CAPCITY1','B0CAPCITY1','容量产品','IMAGE','123-9000000-'||printf('%07d',i),
        '123-9000000-'||printf('%07d',i),1980,'CONFIRMED',1,'cap-owner',confirmed_at,
        date(confirmed_at/1000,'unixepoch','+8 hours'),confirmed_at,'2026-08-01'
      FROM confirmed
    `).run(...params);
    db.raw.prepare(`
      WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i+1 FROM n WHERE i<?),
      confirmed AS (SELECT i, ${base} + (i / 200) * ${day} AS confirmed_at FROM n)
      INSERT INTO formal_order_financial_snapshots(id,formal_order_id,snapshot_version,
        buyer_customer_id,seller_organization_id,store_id,marketplace_code,review_type,
        platform_order_identifier,platform_product_identifier,platform_order_date,
        payment_amount_minor,payment_currency_code,payment_currency_exponent,
        buyer_rate_version_id,buyer_rate_version_no,buyer_rate_business_date,buyer_rate_confirmed_at,
        buyer_rate_value,buyer_rate_scale,source_currency_code,quote_currency_code,
        source_currency_exponent,quote_currency_exponent,
        service_fee_rule_version_id,service_fee_version_no,service_fee_effective_from,
        service_fee_confirmed_at,service_fee_cny_fen,service_fee_currency_code,
        buyer_expected_principal_cny_fen,seller_expected_principal_cny_fen,buyer_self_pay_bps,
        buyer_self_pay_jpy,buyer_refundable_principal_jpy,buyer_gross_principal_cny_fen,
        buyer_self_pay_contribution_cny_fen,rounding_rule,created_at)
      SELECT 'cap-snap-'||i,'cap-order-'||i,1,'cap-buyer-'||i,'cap-seller','cap-store','AMAZON_JP','IMAGE',
        '123-9000000-'||printf('%07d',i),'B0CAPCITY1','2026-08-01',
        1980,'JPY',0,'cap-rate',1,'2026-08-01',2000,5500000,100000000,'JPY','CNY',0,2,
        'cap-fee',1,2000,2000,2500,'CNY',100000,90000,NULL,NULL,NULL,NULL,NULL,'HALF_UP',confirmed_at
      FROM confirmed
    `).run(...params);
    db.raw.exec('COMMIT');
  }
  const count = db.raw
    .prepare('SELECT COUNT(*) AS c FROM formal_orders')
    .get() as { c: number };
  if (count.c !== TOTAL_ORDERS) throw new Error(`capacity seed produced ${count.c}`);
  seeded = true;
  return db;
}

function owner(): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set(['owner']),
    grants: new Set(),
    denies: new Set(),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId: 'cap-owner',
    displayName: 'cap',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: effective.roles,
    permissions: effective.permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

async function listPage(query: string): Promise<Response> {
  const db = await ensureSeeded();
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', `cap-${crypto.randomUUID()}`);
    context.set('staffAuthorization', owner());
    await next();
  });
  registerStaffOrderDetailRoutes(app);
  return app.request(`${ORIGIN}/api/staff/formal-orders${query}`, {}, { DB: db });
}

describe('stage 7.5 staff order list capacity', () => {
  it('pages through all orders without duplicates or gaps', async () => {
    await ensureSeeded();
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const query = cursor === null
        ? '?limit=100'
        : `?limit=100&cursor=${encodeURIComponent(cursor)}`;
      const response = await listPage(query);
      expect(response.status).toBe(200);
      const body = await response.json() as {
        data: { items: Array<{ formal_order_id: string }>; next_cursor: string | null };
      };
      for (const item of body.data.items) {
        expect(seen.has(item.formal_order_id)).toBe(false);
        seen.add(item.formal_order_id);
      }
      pages += 1;
      cursor = body.data.next_cursor;
      if (cursor === null) break;
      expect(pages).toBeLessThan(400);
    }
    expect(seen.size).toBe(TOTAL_ORDERS);
  }, 600_000);

  it('answers representative filters at volume', async () => {
    const db = await ensureSeeded();
    const newest = db.raw
      .prepare('SELECT MAX(confirmed_at) AS m FROM formal_orders')
      .get() as { m: number };
    // The corpus spreads confirmed_at continuously across ~101 days; the
    // trailing day holds the newest 200 orders.
    const today = await listPage(`?confirmed_from=${Number(newest.m) - 86_400_000}&limit=100`);
    expect(today.status).toBe(200);
    const todayBody = await today.json() as {
      data: { items: unknown[]; next_cursor: string | null };
    };
    expect(todayBody.data.items).toHaveLength(100);

    const prefix = await listPage('?amazon_order_number_prefix=123-9000000-0000099&limit=100');
    expect(prefix.status).toBe(200);
    const prefixBody = await prefix.json() as { data: { items: unknown[] } };
    // The capacity corpus carries exactly one order with this full prefix.
    expect(prefixBody.data.items).toHaveLength(1);

    // No obligations or payables are seeded in the capacity corpus, so every
    // order is authoritative stage COMPLETED.
    const stage = await listPage('?stage=COMPLETED&limit=100');
    expect(stage.status).toBe(200);
    const stageBody = await stage.json() as { data: { items: unknown[] } };
    expect(stageBody.data.items.length).toBe(100);
    const noSettlement = await listPage('?stage=SELLER_SETTLEMENT&limit=100');
    const noSettlementBody = await noSettlement.json() as { data: { items: unknown[] } };
    expect(noSettlementBody.data.items).toEqual([]);
  }, 600_000);

  it('keeps every list query plan free of full scans over formal_orders', async () => {
    const db = await ensureSeeded();
    const plans = db.raw.prepare(`
      EXPLAIN QUERY PLAN
      SELECT o.id FROM formal_orders o
      WHERE (o.confirmed_at<? OR (o.confirmed_at=? AND o.id<?))
      ORDER BY o.confirmed_at DESC, o.id DESC LIMIT 100
    `).all(2, 2, 'zzz');
    expect(JSON.stringify(plans)).not.toContain('SCAN formal_orders');

    const prefixPlan = db.raw.prepare(`
      EXPLAIN QUERY PLAN
      SELECT o.id FROM formal_orders o
      WHERE o.amazon_order_number_normalized LIKE '123-9000000-0000099%' ESCAPE '\\'
      ORDER BY o.confirmed_at DESC, o.id DESC LIMIT 100
    `).all();
    expect(JSON.stringify(prefixPlan)).not.toContain('SCAN formal_orders');

    const buyerPlan = db.raw.prepare(`
      EXPLAIN QUERY PLAN
      SELECT o.id FROM formal_orders o
      WHERE o.buyer_customer_no='20260801B90001'
      ORDER BY o.confirmed_at DESC, o.id DESC LIMIT 100
    `).all();
    expect(JSON.stringify(buyerPlan)).not.toContain('SCAN formal_orders');

    const sellerPlan = db.raw.prepare(`
      EXPLAIN QUERY PLAN
      SELECT o.id FROM formal_orders o
      WHERE o.seller_organization_id IN (
        SELECT assignment.seller_organization_id FROM seller_staff_assignments assignment
        WHERE assignment.staff_id='x' AND assignment.duty_code='SELLER_ACCOUNT_MANAGER'
          AND assignment.status='ACTIVE'
      )
      ORDER BY o.confirmed_at DESC, o.id DESC LIMIT 100
    `).all();
    expect(JSON.stringify(sellerPlan)).not.toContain('SCAN formal_orders');
  }, 600_000);
});

afterAllClose();
function afterAllClose(): void {
  // node:sqlite databases close with the process; nothing to tear down here
  // beyond dropping the reference for GC between configurations.
}
