import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { SqlDatabase } from '@ygb/contracts';
import { readAdminBusinessDashboardSummary } from './read-model';

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

describe('stage 4 simplified admin business dashboard read model', () => {
  it('counts window cards from activated customers, reservations and formal orders', async () => {
    database = db();
    seedWindowFacts(database);
    const summary = await readAdminBusinessDashboardSummary(
      database,
      'WEEK',
      Date.parse('2026-08-05T04:00:00.000Z'),
    );

    expect(summary.window).toMatchObject({
      key: 'WEEK', from_date: '2026-08-03', to_date: '2026-08-05',
      timezone: 'Asia/Shanghai',
    });
    expect(summary.cards).toEqual({
      new_customers_buyer: 2,
      new_customers_seller: 1,
      reservations: 1,
      formal_orders: 0,
    });
    expect(summary.pending).toEqual({
      buyer_refunds: 0,
      seller_settlements: 0,
    });
    expect(summary.overdue).toEqual({
      open_work_items: 0,
      finance_exceptions: 0,
    });
    expect(summary.owner_summary.projected_profit.amount_cny_fen).toBe('0');
    expect(JSON.stringify(summary)).not.toMatch(
      /wechat_masked|identity_hash|ciphertext|internal_note|object_key|file_object|staff_id/iu,
    );
  });

  it('aggregates BigInt profit with conflicts excluded and adjustments applied', async () => {
    const huge = '9007199254740993';
    const summary = await readAdminBusinessDashboardSummary(
      financeDatabase([
        financeRow('valid', huge, huge, 'COMPLETED', '2026-08-05'),
        financeRow('projected-only', '5', null, 'PROJECTED_ONLY', null),
        financeRow('conflict', '700', null, 'AMOUNT_MISMATCH', '2026-08-05'),
      ], { projected: '1000', completed: '0' }),
      'TODAY',
      Date.parse('2026-08-05T04:00:00.000Z'),
    );
    expect(summary.owner_summary.projected_profit).toEqual({
      amount_cny_fen: (BigInt(huge) + 5n + 1000n).toString(),
      valid_order_count: 2,
      conflict_order_count: 1,
    });
    expect(summary.owner_summary.completed_profit).toEqual({
      amount_cny_fen: huge,
      valid_order_count: 1,
      conflict_order_count: 1,
    });
  });

  it('runs only indexed aggregates on the applied clean baseline', async () => {
    database = db();
    const summary = await readAdminBusinessDashboardSummary(database, 'MONTH');
    expect(summary.cards).toEqual({
      new_customers_buyer: 0, new_customers_seller: 0,
      reservations: 0, formal_orders: 0,
    });
    expect(database.raw.prepare(
      'SELECT schema_version FROM app_schema_state WHERE singleton_id=1',
    ).get()).toEqual({ schema_version: 34 });
  });
});

function financeRow(
  id: string,
  projected: string | null,
  completed: string | null,
  status: 'COMPLETED' | 'PROJECTED_ONLY' | 'AMOUNT_MISMATCH',
  approvedDate: string | null,
) {
  return {
    formal_order_id: `order-${id}`, confirmed_business_date: '2026-08-05',
    review_approved_business_date: approvedDate,
    projected_gross_profit_cny_fen: projected,
    completed_gross_profit_cny_fen: completed, finance_status: status,
  };
}

function financeDatabase(
  positions: readonly ReturnType<typeof financeRow>[],
  adjustments: { projected: string; completed: string },
): SqlDatabase {
  return {
    prepare(sql: string) {
      const statement = {
        bind() { return statement; },
        async all<T>() {
          if (sql.includes('formal_order_financial_adjustments')) {
            return {
              results: [
                { adjustment_scope: 'PROJECTED_GROSS_PROFIT', amount: adjustments.projected },
                { adjustment_scope: 'COMPLETED_GROSS_PROFIT', amount: adjustments.completed },
              ] as unknown as T[],
            };
          }
          return { results: [] as T[] };
        },
        async first<T>() {
          if (sql.includes('FROM internal_order_finance_positions')) {
            if (sql.includes("SUM(completed_gross_profit_cny_fen)")) {
              const completed = positions.filter((row) => row.review_approved_business_date !== null);
              return {
                amount: completed.reduce((total, row) => total + BigInt(row.completed_gross_profit_cny_fen ?? '0'), 0n).toString(),
                valid: completed.filter((row) => row.finance_status === 'COMPLETED').length,
                conflicts: completed.filter((row) => row.finance_status !== 'COMPLETED').length,
              } as T;
            }
            return {
              amount: positions
                .filter((row) => row.finance_status !== 'AMOUNT_MISMATCH')
                .reduce((total, row) => total + BigInt(row.projected_gross_profit_cny_fen ?? '0'), 0n).toString(),
              valid: positions.filter((row) => row.finance_status !== 'AMOUNT_MISMATCH').length,
              conflicts: positions.filter((row) => row.finance_status === 'AMOUNT_MISMATCH').length,
            } as T;
          }
          if (sql.includes('COUNT(*)')) return { count: 0 } as T;
          return null as T | null;
        },
        async run() { return { meta: { changes: 0 } }; },
      };
      return statement;
    },
    async batch() { return []; },
  };
}

function db(): SqliteDatabase {
  const value = createMigratedTestDatabase();
  return value;
}

function seedWindowFacts(db: SqliteDatabase): void {
  const inside = Date.parse('2026-08-04T00:30:00.000Z');
  db.exec(`
    INSERT INTO staff_users (id,display_name,status,authorization_version,version,
      created_at,updated_at,disabled_at,session_version) VALUES
      ('staff-dashboard','看板员工','ACTIVE',1,1,1,1,NULL,1);
    INSERT INTO seller_channels (id,code,prefix,name,next_sequence,status,version,
      created_at,updated_at,disabled_at) VALUES
      ('dashboard-sellers','dash-sellers','dashsell','看板卖家渠道',1,'ACTIVE',1,1,1,NULL);
    INSERT INTO customer_identity_subjects (id,subject_type,created_at) VALUES
      ('dashboard-subject-1','BUYER_CUSTOMER',1),
      ('dashboard-subject-2','BUYER_CUSTOMER',1);
    INSERT INTO buyer_customers (id,identity_subject_id,marketplace_code,buyer_channel_id,
      buyer_customer_no,buyer_sequence,
      display_name,access_status,identity_review_status,version,created_at,updated_at,
      activated_at,disabled_at) VALUES
      ('buyer-1','dashboard-subject-1','AMAZON_JP','buyer-channel-wechat-b',
        '20260804B0001',1,'买家一',
        'ACTIVE','CLEAR',1,${inside},${inside},${inside},NULL),
      ('buyer-2','dashboard-subject-2','AMAZON_JP','buyer-channel-wechat-b',
        '20260804B0002',2,'买家二',
        'ACTIVE','CLEAR',1,${inside},${inside},${inside},NULL);
    INSERT INTO seller_organizations (id,marketplace_code,seller_code,origin_channel_id,
      current_channel_id,seller_sequence,organization_name,status,version,created_at,
      updated_at,activated_at,disabled_at,next_member_number) VALUES
      ('seller-org-1','AMAZON_JP','DASHSELL-1','dashboard-sellers','dashboard-sellers',1,
        '看板卖家','ACTIVE',1,${inside},${inside},${inside},NULL,2);
  `);
  seedReservationWithObligation(db, inside);
}

function seedReservationWithObligation(db: SqliteDatabase, inside: number): void {
  db.exec(`
    INSERT INTO seller_stores (id,organization_id,marketplace_code,display_name,
      normalized_name,status,version,created_at,updated_at,disabled_at) VALUES
      ('dashboard-store','seller-org-1','AMAZON_JP','看板店铺','dashboard-store',
        'ACTIVE',1,${inside},${inside},NULL);
    INSERT INTO products (id,organization_id,store_id,marketplace_code,asin_display,
      asin_normalized,status,current_version_no,version,created_at,updated_at,disabled_at)
      VALUES ('dashboard-product','seller-org-1','dashboard-store','AMAZON_JP',
        'B0DASHAA01','B0DASHAA01','ACTIVE',1,1,${inside},${inside},NULL);
    INSERT INTO product_versions (id,product_id,version_no,product_name,search_keywords_json,
      created_by_staff_id,created_at,ordering_guide_expected_amount_jpy,color_spec_mode)
      VALUES ('dashboard-product-v1','dashboard-product',1,'看板产品','[]',
        'staff-dashboard',${inside},1000,'MAIN_IMAGE_VARIANT');
    INSERT INTO customer_identity_subjects (id,subject_type,created_at) VALUES
      ('dashboard-member-subject','SELLER_ORG_MEMBER',1);
    INSERT INTO seller_organization_members (id,identity_subject_id,organization_id,
      member_number,username_fallback,display_name,role,status,version,created_at,
      updated_at,activated_at) VALUES
      ('dashboard-member','dashboard-member-subject','seller-org-1',1,'dashboard-member',
        '看板成员','OWNER','ACTIVE',1,${inside},${inside},${inside});
    INSERT INTO demand_batches (id,organization_id,store_id,marketplace_code,product_id,
      product_version_no,submitted_by_member_id,task_type,target_quantity,open_at,
      reservation_deadline,order_deadline,status,version,submitted_at,updated_at,
      reviewed_by_staff_id,reviewed_at,published_at) VALUES
      ('dashboard-demand','seller-org-1','dashboard-store','AMAZON_JP','dashboard-product',1,
        'dashboard-member','TEXT',5,${inside},${inside + 1000},${inside + 2000},
        'PUBLISHED',1,${inside},${inside},'staff-dashboard',${inside},${inside});
    INSERT INTO product_reservations (id,demand_batch_id,buyer_customer_id,organization_id,
      store_id,product_id,product_version_no,marketplace_code,status,precheck_snapshot_json,
      hold_expires_at,order_deadline_snapshot,version,submitted_at,updated_at,
      decided_by_staff_id,decided_at) VALUES
      ('dashboard-reservation','dashboard-demand','buyer-1','seller-org-1','dashboard-store',
        'dashboard-product',1,'AMAZON_JP','APPROVED','{}',${inside + 500},${inside + 2000},
        1,${inside},${inside},'staff-dashboard',${inside});
  `);
}
