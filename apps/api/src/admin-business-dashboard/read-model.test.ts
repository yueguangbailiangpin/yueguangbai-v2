import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { SqlDatabase } from '@ygb/contracts';
import { readAdminBusinessDashboardSummary } from './read-model';

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

describe('admin business dashboard D1 cohort read model', () => {
  it('uses active Buyer facts, immutable lead origins and permanent reservation participation', async () => {
    database = db();
    seedDashboardFacts(database);
    const summary = await readAdminBusinessDashboardSummary(
      database,
      'MONTH',
      Date.parse('2026-08-08T04:00:00.000Z'),
    );

    expect(summary.window).toMatchObject({
      from_date: '2026-08-01', to_date: '2026-08-08', timezone: 'Asia/Shanghai',
    });
    expect(summary.cards).toEqual({
      new_buyers: 1, reservations: 0, formal_orders: 0, business_completions: 0,
    });
    expect(summary.buyer_funnel.stages.map((stage) => [stage.code, stage.count]))
      .toEqual([
        ['CONSULTATION', 0], ['WECHAT_ADDED', 2], ['REGISTERED', 1],
        ['RESERVATION_SUBMITTED', 1], ['FORMAL_ORDER', 1],
        ['BUSINESS_COMPLETED', 0],
      ]);
    expect(summary.buyer_funnel.stages[1]?.conversion_rate_bps).toBeNull();
    expect(summary.buyer_funnel.no_participation_count).toBe(1);
    expect(summary.seller_funnel.stages[1]?.conversion_rate_bps).toBeNull();
    expect(summary.staff_performance).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dimension_id: 'staff-origin', buyer_lead_count: 2,
        buyer_reservation_count: 1, buyer_formal_order_count: 1,
        current_owner_active_lead_count: 1,
      }),
      expect.objectContaining({
        dimension_id: 'staff-current', current_owner_active_lead_count: 2,
      }),
      expect.objectContaining({
        dimension_id: 'staff-zero', buyer_lead_count: 0,
        seller_lead_count: 0, current_owner_active_lead_count: 0,
      }),
    ]));
    expect(summary.channel_performance).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dimension_id: 'dashboard-channel-zero', buyer_lead_count: 0,
        seller_lead_count: 0, consultation_count: 0,
      }),
    ]));
    expect(summary.projected_profit).toEqual({
      amount_cny_fen: '0', valid_order_count: 0, conflict_order_count: 0,
    });
    expect(JSON.stringify(summary)).not.toMatch(
      /wechat_masked|identity_hash|ciphertext|internal_note|object_key|file_object/iu,
    );
  });

  it('executes the frozen 8 Staff / 200 attributed-order daily scale on schema 73', async () => {
    database = db();
    seedCapacityFacts(database, 8, 200);
    const summary = await readAdminBusinessDashboardSummary(
      database,
      'TODAY',
      Date.parse('2026-08-08T04:00:00.000Z'),
    );
    expect(summary.buyer_funnel.stages.find((stage) => stage.code === 'FORMAL_ORDER')?.count)
      .toBe(200);
    expect(summary.staff_performance).toHaveLength(8);
    expect(database.raw.prepare(
      'SELECT schema_version FROM app_schema_state WHERE singleton_id=1',
    ).get()).toEqual({ schema_version: 74 });
  });

  it('aggregates decimal-string BigInt profit and excludes missing or conflicting facts', async () => {
    const huge = '9007199254740993';
    const summary = await readAdminBusinessDashboardSummary(
      financeDatabase([
        financeRow('valid', huge, huge, 'COMPLETED', '2026-08-08'),
        financeRow('projected-only', '5', null, 'PROJECTED_ONLY', null),
        financeRow('conflict', '700', null, 'AMOUNT_MISMATCH', '2026-08-08'),
      ]),
      'TODAY',
      Date.parse('2026-08-08T04:00:00.000Z'),
    );
    expect(summary.projected_profit).toEqual({
      amount_cny_fen: (BigInt(huge) + 5n).toString(),
      valid_order_count: 2,
      conflict_order_count: 1,
    });
    expect(summary.completed_profit).toEqual({
      amount_cny_fen: huge,
      valid_order_count: 1,
      conflict_order_count: 1,
    });
    expect(summary.staff_performance[0]).toMatchObject({
      dimension_id: 'origin',
      projected_profit: summary.projected_profit,
      completed_profit: summary.completed_profit,
    });
  });
});

function financeRow(
  id: string,
  projected: string|null,
  completed: string|null,
  status: 'COMPLETED'|'PROJECTED_ONLY'|'AMOUNT_MISMATCH',
  approvedDate: string|null,
) {
  return { formal_order_id: `order-${id}`, confirmed_business_date: '2026-08-08',
    review_approved_business_date: approvedDate,
    projected_gross_profit_cny_fen: projected,
    completed_gross_profit_cny_fen: completed, finance_status: status };
}

function financeDatabase(positions: readonly ReturnType<typeof financeRow>[]): SqlDatabase {
  return {
    prepare(sql: string) {
      const statement = {
        bind() { return statement; },
        async all<T>() {
          if (sql.includes('internal_order_finance_positions')) {
            return { results: [...positions] as unknown as T[] };
          }
          if (sql.includes('link.target_id AS formal_order_id')) {
            return { results: positions.map((row) => ({ formal_order_id: row.formal_order_id,
              origin_staff_id: 'origin', origin_staff_name: '来源员工',
              origin_channel_id: 'channel', origin_channel_name: '来源渠道' })) as T[] };
          }
          return { results: [] as T[] };
        },
        async first<T>() { return null as T|null; },
        async run() { return { meta: { changes: 0 } }; },
      };
      return statement;
    },
    async batch() { return []; },
  };
}

function db(): SqliteDatabase {
  const value = createMigratedTestDatabase();
  value.exec(`
    INSERT INTO staff_users (id,display_name,status,authorization_version,version,
      created_at,updated_at,disabled_at,session_version) VALUES
      ('staff-origin','来源员工','ACTIVE',1,1,1,1,NULL,1),
      ('staff-current','当前负责人','ACTIVE',1,1,1,1,NULL,1),
      ('staff-zero','暂无业绩员工','ACTIVE',1,1,1,1,NULL,1);
    INSERT INTO staff_role_assignments (staff_id,role_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,created_at,updated_at) VALUES
      ('staff-origin','pre_sales','ACTIVE','zz-phase3h-test-owner',1,NULL,1,1),
      ('staff-current','pre_sales','ACTIVE','zz-phase3h-test-owner',1,NULL,1,1),
      ('staff-zero','buyer_refund','ACTIVE','zz-phase3h-test-owner',1,NULL,1,1);
    INSERT INTO acquisition_channels (id,code,channel_type,display_name,status,version,
      created_by_staff_id,created_at,updated_at,disabled_at) VALUES
      ('dashboard-channel','DASHBOARD_XHS','XIAOHONGSHU','小红书一号','ACTIVE',1,
        'zz-phase3h-test-owner',1,1,NULL),
      ('dashboard-channel-zero','DASHBOARD_ZERO','XIAOHONGSHU','暂无业绩渠道','ACTIVE',1,
        'zz-phase3h-test-owner',1,1,NULL);
  `);
  return value;
}

function seedDashboardFacts(db: SqliteDatabase): void {
  const before = Date.parse('2026-07-31T15:59:59.999Z');
  const inside = Date.parse('2026-07-31T16:00:00.000Z');
  db.exec(`
    INSERT INTO buyer_channels (id,code,name,status,next_sequence,version,
      created_at,updated_at,disabled_at) VALUES
      ('dashboard-buyers','DASH','看板买家','ACTIVE',1,1,1,1,NULL);
    INSERT INTO customer_identity_subjects (id,subject_type,created_at) VALUES
      ('dashboard-subject-before','BUYER_CUSTOMER',1),
      ('dashboard-subject-inside','BUYER_CUSTOMER',1);
    INSERT INTO buyer_customers (id,identity_subject_id,marketplace_code,buyer_channel_id,
      buyer_customer_no,buyer_sequence,first_valid_order_business_date,display_name,
      access_status,identity_review_status,version,created_at,updated_at,activated_at,disabled_at)
      VALUES
      ('buyer-before','dashboard-subject-before','JP','dashboard-buyers',NULL,NULL,NULL,
        '边界前','ACTIVE','CLEAR',1,1,${before},${before},NULL),
      ('buyer-inside','dashboard-subject-inside','JP','dashboard-buyers',NULL,NULL,NULL,
        '边界内','ACTIVE','CLEAR',1,1,${inside},${inside},NULL);
    INSERT INTO acquisition_leads (id,lead_type,identity_hash,identity_ciphertext,identity_iv,
      wechat_masked,display_name,note,origin_channel_id,origin_staff_id,current_owner_staff_id,
      status,invalidation_reason,retention_hold_reason,version,created_business_date,
      latest_followup_at,retention_due_at,created_at,updated_at,invalidated_at,anonymized_at)
      VALUES
      ('buyer-lead-converted','BUYER','${'a'.repeat(64)}','cipher','iv','已脱敏',NULL,NULL,
        'dashboard-channel','staff-origin','staff-current','ACTIVE',NULL,NULL,1,'2026-08-01',
        1,9999999999999,1,1,NULL,NULL),
      ('buyer-lead-idle','BUYER','${'b'.repeat(64)}','cipher','iv','已脱敏',NULL,NULL,
        'dashboard-channel','staff-origin','staff-origin','ACTIVE',NULL,NULL,1,'2026-08-01',
        1,9999999999999,1,1,NULL,NULL),
      ('seller-lead','SELLER','${'c'.repeat(64)}','cipher','iv','已脱敏',NULL,NULL,
        'dashboard-channel','staff-origin','staff-current','ACTIVE',NULL,NULL,1,'2026-08-01',
        1,9999999999999,1,1,NULL,NULL);
    INSERT INTO acquisition_lead_links (id,lead_id,link_type,target_id,linked_at) VALUES
      ('link-buyer','buyer-lead-converted','BUYER_CUSTOMER','buyer-inside',2),
      ('link-reservation','buyer-lead-converted','RESERVATION','historical-reservation',2),
      ('link-order','buyer-lead-converted','FORMAL_ORDER','historical-order',2),
      ('link-seller','seller-lead','SELLER_ORGANIZATION','historical-seller',2);
  `);
}

function seedCapacityFacts(db: SqliteDatabase, staffCount: number, orderCount: number): void {
  const staff = db.raw.prepare(`INSERT INTO staff_users (id,display_name,status,
    authorization_version,version,created_at,updated_at,disabled_at,session_version)
    VALUES (?,?, 'ACTIVE',1,1,1,1,NULL,1)`);
  const roles = db.raw.prepare(`INSERT INTO staff_role_assignments (staff_id,role_code,status,
    assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at)
    VALUES (?,'pre_sales','ACTIVE','zz-phase3h-test-owner',1,NULL,1,1)`);
  const existing = db.raw.prepare(`SELECT id FROM staff_users WHERE status='ACTIVE'
    ORDER BY id`).all() as { id: string }[];
  for (let index = existing.length; index < staffCount; index += 1) {
    staff.run(`capacity-staff-${index}`, `员工${index}`);
    roles.run(`capacity-staff-${index}`);
  }
  const staffIds = (db.raw.prepare(`SELECT id FROM staff_users WHERE status='ACTIVE'
    ORDER BY id`).all() as { id: string }[]).map((row) => row.id);
  const lead = db.raw.prepare(`INSERT INTO acquisition_leads (id,lead_type,identity_hash,
    identity_ciphertext,identity_iv,wechat_masked,display_name,note,origin_channel_id,
    origin_staff_id,current_owner_staff_id,status,invalidation_reason,retention_hold_reason,
    version,created_business_date,latest_followup_at,retention_due_at,created_at,updated_at,
    invalidated_at,anonymized_at) VALUES (?,'BUYER',?,'cipher','iv','已脱敏',NULL,NULL,
    'dashboard-channel',?,?,'ACTIVE',NULL,NULL,1,'2026-08-08',1,9999999999999,1,1,NULL,NULL)`);
  const link = db.raw.prepare(`INSERT INTO acquisition_lead_links
    (id,lead_id,link_type,target_id,linked_at) VALUES (?,?,'FORMAL_ORDER',?,2)`);
  for (let index = 0; index < orderCount; index += 1) {
    const leadId = `capacity-lead-${index}`;
    const staffId = staffIds[index % staffCount]!;
    lead.run(leadId, index.toString(16).padStart(64, '0'), staffId, staffId);
    link.run(`capacity-link-${index}`, leadId, `capacity-order-${index}`);
  }
}
