import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import {
  addMonthsUtc,
  classifyHistoricalFiles,
  classifyOrderIdentifier,
  decimalToScaleE8,
  normalizeHistoricalRow,
  parseCnyYuanToMinor,
  parseHistoricalCsv,
  resolveHistoricalIdentity,
  HISTORICAL_CSV_HEADERS,
} from './index';
import { reconcileHistoricalImport, runHistoricalImport } from './pipeline';

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

function csvRow(overrides: Record<string, string> = {}): string {
  const cells = HISTORICAL_CSV_HEADERS.map((header) => overrides[header] ?? '');
  return cells.map((cell) => (cell.includes(',') ? `"${cell}"` : cell)).join(',');
}

function buildCsv(rows: string[]): string {
  return `${[...HISTORICAL_CSV_HEADERS].join(',')}\n${rows.join('\n')}\n`;
}

const VALID_ROW: Record<string, string> = {
  '下单日期': '2026-01-10',
  '更新状态': '已完成',
  '客户编号': 'C001',
  '买家微信': 'wx-buyer-a',
  '店铺名字': '历史测试店铺',
  'ASIN': 'B0TEST0001',
  '订单价格': '1980',
  '聊天截图': 'img/chat-a-1.png',
  '订单截图': 'img/order-a-1.png',
  '订单号': '123-1234567-1234567',
  '提交评论日期': '2026-01-20',
  '通过日期': '2026-01-25',
  '评论通过截图': 'img/review-a-1.png',
  '评论状态': '已通过',
  '返款状态': '已返款',
  '返款汇率': '0.058',
  '返款时间': '2026-02-01',
  '返款截图': 'img/refund-a-1.png',
  '服务费金额': '25',
  '卖家返金汇率': '0.053',
  '结算日期': '2026-02-10',
  '买家返金金额': '95.5',
  '卖家返金金额': '90',
  '汇率差': '0.005',
  '利润': '5.5',
};

async function seedBuyer(db: SqliteDatabase, wechat: string, buyerId: string): Promise<void> {
  db.exec(`
    INSERT OR IGNORE INTO buyer_channels(id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at)
    VALUES('cold-archive-channel','Z','历史导入测试渠道','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO customer_identity_subjects(id,subject_type,created_at)
    VALUES('${buyerId}-subject','BUYER_CUSTOMER',1000);
    INSERT INTO buyer_customers(id,identity_subject_id,marketplace_code,buyer_channel_id,buyer_customer_no,
      buyer_sequence,first_valid_order_business_date,display_name,access_status,identity_review_status,
      version,created_at,updated_at,activated_at,disabled_at)
    VALUES('${buyerId}','${buyerId}-subject','AMAZON_JP','cold-archive-channel',NULL,NULL,NULL,
      '历史导入测试买家','ACTIVE','CLEAR',1,1000,1000,1000,NULL);
    INSERT INTO wechat_identity_claims(id,identity_subject_id,display_wechat,normalized_wechat,
      status,version,acquired_at,created_at,updated_at)
    VALUES('${buyerId}-claim','${buyerId}-subject','${wechat}','${wechat}','ACTIVE',1,1000,1000,1000);
  `);
}

async function seedStore(db: SqliteDatabase, name: string, organizationId: string): Promise<void> {
  db.exec(`
    INSERT INTO seller_organizations(id,marketplace_code,seller_code,origin_channel_id,current_channel_id,
      seller_sequence,organization_name,status,version,created_at,updated_at,activated_at,disabled_at,next_member_number)
    VALUES('${organizationId}','AMAZON_JP','hist-${organizationId}','seller-channel-ido-mango',
      'seller-channel-ido-mango',9700,'历史导入测试卖家','ACTIVE',1,1000,1000,1000,NULL,2);
    INSERT INTO seller_stores(id,organization_id,marketplace_code,display_name,normalized_name,status,
      version,created_at,updated_at,disabled_at)
    VALUES('${organizationId}-store','${organizationId}','AMAZON_JP','${name}','${name.toLowerCase()}',
      'ACTIVE',1,1000,1000,NULL);
  `);
}

describe('stage 6 historical import framework', () => {
  it('parses the frozen 30-column CSV contract and fails closed on header drift', () => {
    const text = buildCsv([csvRow(VALID_ROW)]);
    const rows = parseHistoricalCsv('master.csv', text, 'a'.repeat(64));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells['订单号']).toBe('123-1234567-1234567');
    expect(rows[0]!.rowKey).toMatch(/^historical-order-source:aaaaaaaaaaaa:master\.csv:row:000001$/u);
    const mutated = text.replace('下单日期', '下单时间');
    expect(() => parseHistoricalCsv('master.csv', mutated, 'a'.repeat(64))).toThrow('SOURCE_HEADER_MISMATCH');
  });

  it('maps marketplaces exactly: Amazon JP canonical, compact normalized, Rakuten/TikTok quarantined', () => {
    expect(classifyOrderIdentifier('123-1234567-1234567')).toMatchObject({ marketplace: 'AMAZON_JP' });
    expect(classifyOrderIdentifier('12312345671234567')).toMatchObject({
      marketplace: 'AMAZON_JP',
      normalized: '123-1234567-1234567',
      note: 'NORMALIZED_MISSING_SEPARATOR',
    });
    expect(classifyOrderIdentifier('123456-12345678-1234567890').marketplace).toBe('RAKUTEN');
    expect(classifyOrderIdentifier('585123456789012345').marketplace).toBe('TIKTOK');
    expect(classifyOrderIdentifier('not-an-order').marketplace).toBe('UNKNOWN');
    // Runtime storage stays canonical: the historical_orders CHECK only
    // accepts AMAZON_JP and the importer never writes a legacy 'JP' value.
    const outcome = normalizeHistoricalRow({
      rowKey: 'k1', lineNumber: 2, cells: { ...makeCells('123456-12345678-1234567890') },
    });
    expect(outcome.quarantines.map((entry) => entry.code)).toContain('UNKNOWN_MARKETPLACE');
  });

  it('keeps money exact: CNY yuan→fen and rate decimals via string arithmetic, never floats', () => {
    expect(parseCnyYuanToMinor('95.5')).toBe(9550);
    expect(parseCnyYuanToMinor('0.1')).toBe(10);
    expect(parseCnyYuanToMinor('25')).toBe(2500);
    expect(parseCnyYuanToMinor('12.345')).toBe(null);
    expect(parseCnyYuanToMinor('abc')).toBe(null);
    expect(decimalToScaleE8('0.058')).toBe(5_800_000);
    expect(decimalToScaleE8('0.005')).toBe(500_000);
    expect(decimalToScaleE8('0.00000001')).toBe(1);
    expect(decimalToScaleE8('1.234567891')).toBe(null);
  });

  it('quarantines rate spread mismatches and partial financial facts instead of inventing zeros', () => {
    const cells = makeCells('123-1234567-1234568');
    cells['返款汇率'] = '0.058';
    cells['卖家返金汇率'] = '0.053';
    cells['汇率差'] = '0.006';
    const outcome = normalizeHistoricalRow({ rowKey: 'k', lineNumber: 2, cells });
    expect(outcome.quarantines.map((entry) => entry.code)).toContain('RATE_SPREAD_MISMATCH');
    const partial = makeCells('123-1234567-1234569');
    partial['买家返金金额'] = '';
    partial['卖家返金金额'] = '';
    partial['服务费金额'] = '25';
    const partialOutcome = normalizeHistoricalRow({ rowKey: 'k2', lineNumber: 3, cells: partial });
    expect(partialOutcome.quarantines.map((entry) => entry.code)).toContain('MISSING_FINANCIAL_FIELDS');
    expect(partialOutcome.order!.service_fee_source_minor).toBe(2500);
    expect(partialOutcome.order!.buyer_refund_amount_source_minor).toBe(null);
  });

  it('resolves identities deterministically: match, conflict, unmatched, override', async () => {
    database = createMigratedTestDatabase();
    await seedBuyer(database, 'wx-buyer-a', 'hist-buyer-a');
    await seedBuyer(database, 'wx-shared', 'hist-buyer-b1');
    await seedBuyer(database, 'wx-shared', 'hist-buyer-b2');
    await seedStore(database, '历史测试店铺', 'hist-seller-1');
    const base = normalizeHistoricalRow({ rowKey: 'k', lineNumber: 2, cells: makeCells('123-1234567-2000001') });
    const matched = await resolveHistoricalIdentity(database, base.order!);
    expect(matched).toMatchObject({ buyer_customer_id: 'hist-buyer-a', seller_organization_id: 'hist-seller-1' });
    const conflict = await resolveHistoricalIdentity(database, {
      ...base.order!, buyer_wechat_ref: 'wx-shared',
    });
    expect(conflict.buyerOutcome).toBe('CONFLICT');
    const unmatched = await resolveHistoricalIdentity(database, {
      ...base.order!, buyer_wechat_ref: 'wx-nobody',
    });
    expect(unmatched.buyerOutcome).toBe('UNMATCHED');
    expect(unmatched.buyer_customer_id).toBe(null);
    // Manual mapping override wins over ambiguity (audited separately).
    database.exec(`
      INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
      VALUES('hist-import-owner','历史导入','ACTIVE',1,1,1000,1000,NULL);
      INSERT INTO historical_import_identity_overrides(id,source_system,source_key,resolved_kind,resolved_id,
        override_reason,overridden_by_staff_id,created_at)
      VALUES('hist-identity-override-1','HISTORICAL_ORDER_CSV','wx-shared','BUYER_CUSTOMER','hist-buyer-b1',
        '业务确认 b1 为同一买家','hist-import-owner',1000);
    `);
    const overridden = await resolveHistoricalIdentity(database, {
      ...base.order!, buyer_wechat_ref: 'wx-shared',
    });
    expect(overridden.buyer_customer_id).toBe('hist-buyer-b1');
  });

  it('classifies images fail-closed: cold needs complete closure + real bytes', () => {
    const closedOld: Record<string, string> = {
      ...VALID_ROW,
      '订单号': '123-1234567-3000001',
    };
    const row = { rowKey: 'k', lineNumber: 2, cells: closedOld };
    const outcome = normalizeHistoricalRow(row);
    const inventory = new Map([
      ['img/chat-a-1.png', { sha256: 'f'.repeat(64), mime: 'image/png', byteSize: 100 }],
      ['img/order-a-1.png', { sha256: 'e'.repeat(64), mime: 'image/png', byteSize: 120 }],
      ['img/review-a-1.png', { sha256: 'd'.repeat(64), mime: 'image/jpeg', byteSize: 90 }],
      ['img/refund-a-1.png', { sha256: 'c'.repeat(64), mime: 'image/jpeg', byteSize: 80 }],
    ]);
    const today = '2026-12-01';
    expect(addMonthsUtc('2026-02-10', 6)).toBe('2026-08-10');
    const plans = classifyHistoricalFiles(row, outcome.order!, inventory, today);
    expect(plans).toHaveLength(4);
    expect(plans.every((plan) => plan.classification === 'COLD_ARCHIVE_ELIGIBLE')).toBe(true);
    expect(plans.map((plan) => plan.purpose)).toEqual(expect.arrayContaining([
      'ORDER_EVIDENCE', 'REVIEW_EVIDENCE', 'BUYER_REFUND_PROOF',
    ]));
    // Missing byte inspection: a cold candidate without inventory stays
    // quarantined — metadata alone never authorizes cold archive.
    const noInventory = classifyHistoricalFiles(row, outcome.order!, undefined, today);
    expect(noInventory.every((plan) => plan.classification === 'HOT_R2' || plan.classification === 'QUARANTINE')).toBe(true);
    // Incomplete closure → HOT_R2 (fail closed toward hot).
    const open = normalizeHistoricalRow({ rowKey: 'k2', lineNumber: 3, cells: { ...closedOld, '结算日期': '' } });
    const openPlans = classifyHistoricalFiles({ ...row, cells: { ...closedOld, '结算日期': '' } }, open.order!, inventory, today);
    expect(openPlans.every((plan) => plan.classification === 'QUARANTINE')).toBe(true);
    // Missing / corrupt physical sources.
    const missingPlan = classifyHistoricalFiles(row, outcome.order!, new Map(), today);
    expect(missingPlan.every((plan) => plan.classification === 'MISSING')).toBe(true);
    const corrupt = new Map([['img/chat-a-1.png', { sha256: '', mime: '', byteSize: 0 }]]);
    const corruptPlans = classifyHistoricalFiles(row, outcome.order!, corrupt, today);
    expect(corruptPlans.every((plan) => plan.classification === 'CORRUPT' || plan.classification === 'MISSING')).toBe(true);
  });

  it('dry-run is the default and writes nothing, reporting conservation + can_apply gates', async () => {
    database = createMigratedTestDatabase();
    await seedBuyer(database, 'wx-buyer-a', 'hist-buyer-a');
    await seedStore(database, '历史测试店铺', 'hist-seller-1');
    const clean = buildCsv([csvRow(VALID_ROW)]);
    const result = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV',
      files: [{ name: 'master.csv', text: clean }],
    }, { mode: 'DRY_RUN', now: Date.UTC(2026, 7, 26) });
    expect(result.report.source_rows).toBe(1);
    expect(result.report.valid_rows).toBe(1);
    expect(result.report.quarantined_rows).toBe(0);
    expect(result.report.source_rows).toBe(result.report.valid_rows + result.report.quarantined_rows);
    expect(result.report.can_apply).toBe(true);
    expect(result.report.currency_totals).toEqual({
      order_amount_jpy_minor: 1980,
      buyer_refund_cny_minor: 9550,
      seller_principal_cny_minor: 9000,
      service_fee_cny_minor: 2500,
    });
    const rows = await database.prepare('SELECT COUNT(*) AS count FROM historical_orders').first<{ count: number }>();
    expect(rows!.count).toBe(0);
    // A critical quarantine row blocks apply entirely.
    const dirty = buildCsv([
      csvRow(VALID_ROW),
      csvRow({ ...VALID_ROW, '订单号': 'not-an-order', '订单截图': 'img/x.png' }),
    ]);
    const blocked = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV',
      files: [{ name: 'dirty.csv', text: dirty }],
    }, { mode: 'DRY_RUN', now: Date.UTC(2026, 7, 26) });
    expect(blocked.report.quarantined_rows).toBe(1);
    expect(blocked.report.can_apply).toBe(false);
    expect(blocked.report.cannot_apply_reasons[0]).toMatch(/critical_quarantine_rows:1/);
    const applied = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV',
      files: [{ name: 'dirty.csv', text: dirty }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) });
    expect(applied.applied_orders).toBe(0);
    const stillEmpty = await database.prepare('SELECT COUNT(*) AS count FROM historical_orders').first<{ count: number }>();
    expect(stillEmpty!.count).toBe(0);
  });

  it('applies locally per-order, replays idempotently, and keeps snapshots immutable', async () => {
    const db = createMigratedTestDatabase();
    database = db;
    await seedBuyer(database, 'wx-buyer-a', 'hist-buyer-a');
    await seedStore(database, '历史测试店铺', 'hist-seller-1');
    const csv = buildCsv([csvRow(VALID_ROW), csvRow({ ...VALID_ROW, '订单号': '123-1234567-4000002' })]);
    const first = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV', files: [{ name: 'master.csv', text: csv }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) });
    expect(first.applied_orders).toBe(2);
    const counts = await db.prepare(
      'SELECT (SELECT COUNT(*) FROM historical_orders) AS orders,(SELECT COUNT(*) FROM historical_order_files) AS files',
    ).first<{ orders: number; files: number }>();
    expect(counts).toEqual({ orders: 2, files: 8 });
    // Same source again → replay, zero new rows.
    const second = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV', files: [{ name: 'master.csv', text: csv }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) + 1 });
    expect(second.replayed).toBe(true);
    expect(second.applied_orders).toBe(0);
    const countsAfter = await db.prepare('SELECT COUNT(*) AS count FROM historical_orders').first<{ count: number }>();
    expect(countsAfter!.count).toBe(2);
    // Snapshots are immutable once written (exec throws synchronously).
    expect(() => db.exec('UPDATE historical_orders SET profit_source_minor=1'))
      .toThrow('historical_orders_are_immutable');
    // Reconciliation ties back to the source.
    const recon = await reconcileHistoricalImport(db, first.batch_id!);
    expect(recon.imported_orders).toBe(2);
    expect(recon.currency_totals.order_amount_jpy_minor).toBe(2 * 1980);
    expect(recon.currency_totals.buyer_refund_cny_minor).toBe(2 * 9550);
    expect(recon.file_rows).toBe(8);
  });

  it('resumes an interrupted apply to exactly the one-shot result', async () => {
    database = createMigratedTestDatabase();
    await seedBuyer(database, 'wx-buyer-a', 'hist-buyer-a');
    await seedStore(database, '历史测试店铺', 'hist-seller-1');
    const rows = Array.from({ length: 6 }, (_, index) =>
      csvRow({ ...VALID_ROW, '订单号': `123-1234567-500000${index}` }));
    const csv = buildCsv(rows);
    // Inject a failure after the third order commits.
    database.exec(`
      CREATE TRIGGER test_stop_after_third BEFORE INSERT ON historical_orders
      WHEN NEW.source_order_id='123-1234567-5000003'
      BEGIN SELECT RAISE(ABORT,'injected_interrupt'); END;
    `);
    const interrupted = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV', files: [{ name: 'master.csv', text: csv }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) }).catch((error: unknown) => error);
    expect(interrupted).toBeInstanceOf(Error);
    const partial = await database.prepare('SELECT COUNT(*) AS count FROM historical_orders').first<{ count: number }>();
    expect(partial!.count).toBe(3);
    database.exec('DROP TRIGGER test_stop_after_third');
    const resumed = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV', files: [{ name: 'master.csv', text: csv }],
    }, { mode: 'APPLY_LOCAL', resumeBatchId: (await database
      .prepare('SELECT id FROM historical_import_batches WHERE status=\'RUNNING\'')
      .first<{ id: string }>())!.id, now: Date.UTC(2026, 7, 26) + 1 });
    expect(resumed.applied_orders).toBe(3);
    const finalCount = await database.prepare('SELECT COUNT(*) AS count FROM historical_orders').first<{ count: number }>();
    expect(finalCount!.count).toBe(6);
    const dupes = await database.prepare(
      'SELECT COUNT(*) AS count FROM (SELECT source_row_key FROM historical_orders GROUP BY source_row_key HAVING COUNT(*)>1)',
    ).first<{ count: number }>();
    expect(dupes!.count).toBe(0);
  });

  it('never merges identities silently and never touches live formal_orders', async () => {
    database = createMigratedTestDatabase();
    const before = await database.prepare(
      'SELECT (SELECT COUNT(*) FROM buyer_customers) AS buyers,(SELECT COUNT(*) FROM formal_orders) AS orders',
    ).first<{ buyers: number; orders: number }>();
    const csv = buildCsv([csvRow(VALID_ROW)]);
    const result = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV', files: [{ name: 'master.csv', text: csv }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) });
    // Buyer unmatched → still imports the snapshot, but creates no buyer row.
    expect(result.report.buyer_matches.unmatched).toBe(1);
    const after = await database.prepare(
      'SELECT (SELECT COUNT(*) FROM buyer_customers) AS buyers,(SELECT COUNT(*) FROM formal_orders) AS orders',
    ).first<{ buyers: number; orders: number }>();
    expect(after).toEqual(before);
    expect(result.applied_orders).toBe(1);
  });

  it('marks unmatched identities as durable unresolved quarantine facts resolved only by audited override', async () => {
    database = createMigratedTestDatabase();
    const csv = buildCsv([csvRow(VALID_ROW)]);
    const applied = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV', files: [{ name: 'master.csv', text: csv }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) });
    expect(applied.report.can_apply).toBe(true);
    expect(applied.report.quarantine_by_code['IDENTITY_UNMATCHED']).toBe(1);
    const unresolved = await database.prepare(
      `SELECT detail_json FROM historical_import_quarantine
       WHERE import_batch_id=? AND exception_code='IDENTITY_UNMATCHED'`,
    ).bind(applied.batch_id).first<{ detail_json: string }>();
    expect(JSON.parse(unresolved!.detail_json)).toEqual({
      kinds: ['BUYER_CUSTOMER', 'SELLER_ORGANIZATION'],
    });
    // A manual override must record original value, resolved value, operator,
    // reason, time AND the import run it adjudicates (0026 audit contract).
    database.exec(`
      INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
      VALUES('hist-import-owner','历史导入','ACTIVE',1,1,1000,1000,NULL);
      INSERT INTO historical_import_identity_overrides(id,source_system,source_key,resolved_kind,resolved_id,
        override_reason,overridden_by_staff_id,created_at,import_batch_id)
      VALUES('hist-identity-override-2','HISTORICAL_ORDER_CSV','${VALID_ROW['买家微信']}','BUYER_CUSTOMER',
        'hist-buyer-a','业务确认该微信对应买家 A','hist-import-owner',2000,'${applied.batch_id}');
    `);
    const override = await database.prepare(
      `SELECT source_key,resolved_id,overridden_by_staff_id,override_reason,created_at,import_batch_id
       FROM historical_import_identity_overrides WHERE id='hist-identity-override-2'`,
    ).first();
    expect(override).toMatchObject({
      source_key: 'wx-buyer-a',
      resolved_id: 'hist-buyer-a',
      overridden_by_staff_id: 'hist-import-owner',
      override_reason: '业务确认该微信对应买家 A',
      created_at: 2000,
      import_batch_id: applied.batch_id,
    });
    // A second override resolves the seller side the same way (override wins
    // over the deterministic store lookup).
    await seedStore(database, '历史测试店铺', 'hist-seller-1');
    database.exec(`
      INSERT INTO historical_import_identity_overrides(id,source_system,source_key,resolved_kind,resolved_id,
        override_reason,overridden_by_staff_id,created_at,import_batch_id)
      VALUES('hist-identity-override-3','HISTORICAL_ORDER_CSV','${VALID_ROW['店铺名字']}','SELLER_ORGANIZATION',
        'hist-seller-1','业务确认店铺归属卖家一','hist-import-owner',2001,'${applied.batch_id}');
    `);
    // With both overrides in place, a dry-run of the same source fully
    // resolves: no IDENTITY_UNMATCHED remains (DRY_RUN is a distinct batch key).
    const resolved = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV', files: [{ name: 'master.csv', text: csv }],
    }, { mode: 'DRY_RUN', now: Date.UTC(2026, 7, 26) + 1 });
    expect(resolved.report.buyer_matches.matched).toBe(1);
    expect(resolved.report.seller_matches.matched).toBe(1);
    expect(resolved.report.quarantine_by_code['IDENTITY_UNMATCHED']).toBeUndefined();
  });

  it('holds multi-line duplicate groups for an explicit mapping and never folds or sums them', async () => {
    database = createMigratedTestDatabase();
    await seedBuyer(database, 'wx-buyer-a', 'hist-buyer-a');
    await seedStore(database, '历史测试店铺', 'hist-seller-1');
    // Same order id, DIFFERENT product and amount: a multi-product order the
    // importer must never fold, first/last, or auto-sum.
    const line1 = csvRow({ ...VALID_ROW, 'ASIN': 'B0TEST0001', '订单价格': '1980' });
    const line2 = csvRow({ ...VALID_ROW, 'ASIN': 'B0TEST0002', '订单价格': '2480' });
    const multi = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV',
      files: [{ name: 'multi.csv', text: buildCsv([line1, line2]) }],
    }, { mode: 'DRY_RUN', now: Date.UTC(2026, 7, 26) });
    expect(multi.report.quarantine_by_code['MULTI_LINE_ORDER_REQUIRES_MAPPING']).toBe(2);
    expect(multi.report.quarantine_by_code['CONFLICTING_DUPLICATE_GROUP']).toBeUndefined();
    expect(multi.report.can_apply).toBe(false);
    expect(multi.report.cannot_apply_reasons[0]).toBe('critical_quarantine_rows:2');
    // Blocked apply writes NOTHING — every original row stays in the source,
    // waiting for a future explicit mapping contract.
    const blocked = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV',
      files: [{ name: 'multi.csv', text: buildCsv([line1, line2]) }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) });
    expect(blocked.applied_orders).toBe(0);
    const written = await database.prepare('SELECT COUNT(*) AS count FROM historical_orders')
      .first<{ count: number }>();
    expect(written!.count).toBe(0);
    // A group that differs ONLY in a non-line column (e.g. buyer wechat) is a
    // plain conflicting duplicate, not a multi-line order.
    const dupA = csvRow({ ...VALID_ROW, '买家微信': 'wx-buyer-a' });
    const dupB = csvRow({ ...VALID_ROW, '买家微信': 'wx-buyer-b' });
    const conflicting = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV',
      files: [{ name: 'conflict.csv', text: buildCsv([dupA, dupB]) }],
    }, { mode: 'DRY_RUN', now: Date.UTC(2026, 7, 26) });
    expect(conflicting.report.quarantine_by_code['CONFLICTING_DUPLICATE_GROUP']).toBe(2);
    expect(conflicting.report.quarantine_by_code['MULTI_LINE_ORDER_REQUIRES_MAPPING']).toBeUndefined();
    expect(conflicting.report.can_apply).toBe(false);
  });

  it('accepts the JSONL adapter produced by the frozen Python manifest tool', async () => {
    database = createMigratedTestDatabase();
    const record = {
      row_key: 'historical-order-source:data-master:row:000001',
      raw_fields: Object.fromEntries(HISTORICAL_CSV_HEADERS.map((header) => [header, VALID_ROW[header] ?? ''])),
    };
    const result = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_JSONL',
      files: [{ name: 'manifest.jsonl', text: `${JSON.stringify(record)}\n` }],
    }, { mode: 'DRY_RUN', now: Date.UTC(2026, 7, 26) });
    // No seeded identities → the row imports losslessly but is explicitly
    // unresolved: IDENTITY_UNMATCHED is a durable quarantine fact.
    expect(result.report.valid_rows).toBe(0);
    expect(result.report.quarantined_rows).toBe(1);
    expect(result.report.quarantine_by_code['IDENTITY_UNMATCHED']).toBe(1);
    expect(result.report.can_apply).toBe(true);
  });

  it('starts a NEW run when the source content changes (sha-keyed batches never mix)', async () => {
    database = createMigratedTestDatabase();
    await seedBuyer(database, 'wx-buyer-a', 'hist-buyer-a');
    await seedStore(database, '历史测试店铺', 'hist-seller-1');
    const original = buildCsv([csvRow(VALID_ROW)]);
    const first = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV', files: [{ name: 'master.csv', text: original }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) });
    expect(first.applied_orders).toBe(1);
    // Same batch identity but a different source SHA must become its own run
    // and never resume/replay the old one (UNIQUE(source,sha,parser,mapping,mode)).
    const edited = buildCsv([csvRow({ ...VALID_ROW, '订单价格': '2080' })]);
    const second = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV', files: [{ name: 'master.csv', text: edited }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) + 1 });
    expect(second.replayed).toBe(false);
    expect(second.batch_id).not.toBe(first.batch_id);
    expect(second.applied_orders).toBe(1);
    const batches = await database.prepare(
      'SELECT COUNT(*) AS count FROM historical_import_batches',
    ).first<{ count: number }>();
    expect(batches!.count).toBe(2);
    // The two sha-keyed batches coexist without interference: each carries
    // exactly its own source facts (unique source_order_id per batch).
    const amounts = await database.prepare(
      'SELECT order_amount_source_minor FROM historical_orders ORDER BY created_at',
    ).all<{ order_amount_source_minor: number }>();
    expect(amounts.results.map((row) => row.order_amount_source_minor)).toEqual([1980, 2080]);
  });

  it('collapses exact-fact duplicate groups to one logical order on apply', async () => {
    const db = createMigratedTestDatabase();
    database = db;
    await seedBuyer(database, 'wx-buyer-a', 'hist-buyer-a');
    await seedStore(database, '历史测试店铺', 'hist-seller-1');
    // Two identical source rows sharing one order number = one logical order.
    const twin = csvRow({ ...VALID_ROW, '订单号': '123-1234567-6000001' });
    const single = csvRow({ ...VALID_ROW, '订单号': '123-1234567-6000002' });
    const csv = buildCsv([twin, twin, single]);
    const dry = await runHistoricalImport(db, {
      sourceSystem: 'HISTORICAL_ORDER_CSV', files: [{ name: 'master.csv', text: csv }],
    }, { mode: 'DRY_RUN', now: Date.UTC(2026, 7, 26) });
    // Row conservation still counts source rows; currency follows the
    // collapsed logical-order set (2 orders, not 3).
    expect(dry.report.source_rows).toBe(3);
    expect(dry.report.valid_rows).toBe(3);
    expect(dry.report.duplicate_rows).toBe(2);
    expect(dry.report.currency_totals.order_amount_jpy_minor).toBe(2 * 1980);
    expect(dry.report.can_apply).toBe(true);
    const applied = await runHistoricalImport(db, {
      sourceSystem: 'HISTORICAL_ORDER_CSV', files: [{ name: 'master.csv', text: csv }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) });
    expect(applied.applied_orders).toBe(2);
    const counts = await db.prepare(
      'SELECT (SELECT COUNT(*) FROM historical_orders) AS orders,(SELECT COUNT(*) FROM historical_order_files) AS files',
    ).first<{ orders: number; files: number }>();
    expect(counts).toEqual({ orders: 2, files: 8 });
    const recon = await reconcileHistoricalImport(db, applied.batch_id!);
    expect(recon.imported_orders).toBe(2);
    expect(recon.currency_totals.order_amount_jpy_minor).toBe(2 * 1980);
  });
});

function makeCells(orderNumber: string): Record<string, string> {
  return { ...VALID_ROW, '订单号': orderNumber };
}
