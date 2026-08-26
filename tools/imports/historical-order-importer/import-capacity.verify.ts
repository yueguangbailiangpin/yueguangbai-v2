import { describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { HISTORICAL_CSV_HEADERS } from './index';
import { reconcileHistoricalImport, runHistoricalImport } from './pipeline';

/**
 * Stage 6.7 capacity verification: 20,000 synthetic orders with ~100,000
 * file plans driven through the REAL parse → validate → identity →
 * classification → apply pipeline against the full migration chain. Proves:
 * row conservation, critical-quarantine blocking at scale, exact-duplicate
 * collapse, per-order batching, idempotent replay, interrupted-resume
 * equivalence with a one-shot run, reconciliation totals and bounded per-row
 * work (no O(N²)). Synthetic data only — REAL_HISTORICAL_IMPORT stays NOT_RUN.
 */

const ORDER_COUNT = 20_000;
const IMAGE_COLUMNS = ['聊天截图', '订单截图', '评论通过截图', '补fb截图', '返款截图'] as const;
const IMAGE_SLOTS = ['chat', 'order', 'review', 'fb', 'refund'] as const;
const NOW = Date.UTC(2026, 7, 26);

type RowKind =
  | 'NORMAL' | 'EXACT_DUP' | 'CONFLICT_DUP'
  | 'BAD_UNKNOWN_MARKETPLACE' | 'BAD_MISSING_COLUMN' | 'BAD_NON_INTEGER'
  | 'BAD_SPREAD' | 'BAD_DATE' | 'BAD_PARTIAL_FINANCE'
  | 'BAD_IDENTITY_BUYER' | 'BAD_IDENTITY_SELLER';

interface ExpectedTotals {
  sourceRows: number;
  validRows: number;
  quarantinedRows: number;
  criticalRows: number;
  logicalOrders: number;
  duplicateRows: number;
  quarantineByCode: Record<string, number>;
  currency: { jpy: number; refundFen: number; principalFen: number; feeFen: number };
  files: { cold: number; hot: number; quarantineClosure: number; planned: number };
  buyerMatchedRows: number;
  sellerMatchedRows: number;
  buyerConflictRows: number;
  sellerConflictRows: number;
  /** Durable IDENTITY_UNMATCHED rows (explicit unresolved identity facts). */
  identityUnmatchedRows: number;
}

const REFUND_BY_RATE = [
  { text: '95.50', fen: 9550 }, { text: '99.00', fen: 9900 },
  { text: '102.10', fen: 10210 }, { text: '107.25', fen: 10725 },
] as const;
const PRINCIPAL_BY_RATE = [
  { text: '90', fen: 9000 }, { text: '92', fen: 9200 },
  { text: '94', fen: 9400 }, { text: '96', fen: 9600 },
] as const;
const RATE_TRIPLES = [
  { buyer: '0.058', seller: '0.053', spread: '0.005' },
  { buyer: '0.060', seller: '0.055', spread: '0.005' },
  { buyer: '0.062', seller: '0.058', spread: '0.004' },
  { buyer: '0.065', seller: '0.059', spread: '0.006' },
] as const;
const FEE_BY_FIVE = [
  { text: '25', fen: 2500 }, { text: '30', fen: 3000 },
  { text: '35', fen: 3500 }, { text: '40', fen: 4000 }, { text: '45', fen: 4500 },
] as const;

function orderNumberOf(index: number): string {
  return `123-${String(index).padStart(7, '0')}-${String((index * 7 + 13) % 10_000_000).padStart(7, '0')}`;
}

/**
 * Deterministic 30-column source generator. `fixed=false` injects ~2% bad
 * rows plus exact/conflicting duplicate groups; `fixed=true` emits the
 * repaired re-import (bad rows normalized, conflicting groups renumbered).
 */
export function generateCapacitySource(fixed: boolean): { csv: string; expected: ExpectedTotals } {
  const lines: string[] = [[...HISTORICAL_CSV_HEADERS].join(',')];
  const expected: ExpectedTotals = {
    sourceRows: ORDER_COUNT, validRows: 0, quarantinedRows: 0, criticalRows: 0,
    logicalOrders: 0, duplicateRows: 0, quarantineByCode: {},
    currency: { jpy: 0, refundFen: 0, principalFen: 0, feeFen: 0 },
    files: { cold: 0, hot: 0, quarantineClosure: 0, planned: 0 },
    buyerMatchedRows: 0,
    sellerMatchedRows: 0,
    buyerConflictRows: 0,
    sellerConflictRows: 0,
    identityUnmatchedRows: 0,
  };
  const bump = (code: string) => { expected.quarantineByCode[code] = (expected.quarantineByCode[code] ?? 0) + 1; };
  for (let index = 0; index < ORDER_COUNT; index += 1) {
    let kind: RowKind = 'NORMAL';
    if (!fixed) {
      if (index % 400 === 100) kind = 'BAD_UNKNOWN_MARKETPLACE';
      else if (index % 400 === 150) kind = 'BAD_MISSING_COLUMN';
      else if (index % 400 === 200) kind = 'BAD_NON_INTEGER';
      else if (index % 400 === 250) kind = 'BAD_SPREAD';
      else if (index % 400 === 300) kind = 'BAD_DATE';
      else if (index % 400 === 350) kind = 'BAD_PARTIAL_FINANCE';
      else if (index % 800 === 50) kind = 'BAD_IDENTITY_BUYER';
      else if (index % 800 === 610) kind = 'BAD_IDENTITY_SELLER';
      else if (index === 1600 || index === 1601
        || index === 2400 || index === 2401 || index === 2402) kind = 'EXACT_DUP';
      else if (index === 3600 || index === 3601 || index === 4400 || index === 4401) kind = 'CONFLICT_DUP';
    } else if (index === 1600 || index === 1601
      || index === 2400 || index === 2401 || index === 2402) kind = 'EXACT_DUP';

    // Exact-duplicate group members derive EVERY column from the group head
    // so their source rows are byte-identical facts (one logical order).
    // Conflicting-group members likewise derive from their head so the ONLY
    // difference is the explicit one applied below (amount for the multi-line
    // group, wechat for the plain-conflict group).
    const derive = kind === 'EXACT_DUP' ? (index <= 1601 ? 1600 : 2400)
      : kind === 'CONFLICT_DUP' ? (index <= 3601 ? 3600 : 4400)
        : index;
    const closure = derive % 10 < 7 ? 'OLD' : derive % 10 < 9 ? 'RECENT' : 'INCOMPLETE';
    const hasFinance = derive % 3 < 2;
    const rateIndex = derive % 4;
    const orderAmount = 500 + (derive % 200) * 10;
    const cells: Record<string, string> = {
      '下单日期': closure === 'OLD' ? '2024-03-05' : '2026-06-01',
      '更新状态': '已完成',
      '客户编号': `CAP-${derive % 97}`,
      '买家微信': kind === 'BAD_IDENTITY_BUYER' ? 'wx-cap-conflict-a'
        : derive % 6 === 0 ? `wx-cap-m${derive % 4}` : `wx-cap-u${derive % 37}`,
      '店铺名字': kind === 'BAD_IDENTITY_SELLER' ? '容量冲突店铺'
        : derive % 5 === 0 ? '容量匹配店铺' : `未知店铺${derive % 3}`,
      'ASIN': kind === 'BAD_MISSING_COLUMN' ? '' : `B0CAP${String(derive % 100000).padStart(5, '0')}`,
      '订单价格': kind === 'BAD_NON_INTEGER' ? '19.99' : String(orderAmount),
      '聊天截图': `cap-img/${derive}/chat.png`,
      '订单截图': `cap-img/${derive}/order.png`,
      '订单号': kind === 'BAD_UNKNOWN_MARKETPLACE' ? `123456-12345678-${String(1_234_567_890 + index)}`
        : kind === 'EXACT_DUP' && index <= 1601 ? orderNumberOf(1600)
          : kind === 'EXACT_DUP' ? orderNumberOf(2400)
            : kind === 'CONFLICT_DUP' && index <= 3601 ? orderNumberOf(3600)
              : kind === 'CONFLICT_DUP' ? orderNumberOf(4400)
                : orderNumberOf(index),
      '到货图': '',
      '提交评论日期': closure === 'OLD' ? '2024-03-20' : '2026-06-15',
      '通过日期': closure === 'OLD' ? '2024-03-25' : '2026-06-20',
      '评论通过截图': `cap-img/${derive}/review.png`,
      '补fb日期': closure === 'OLD' ? '2024-03-26' : '2026-06-21',
      '补fb截图': `cap-img/${derive}/fb.png`,
      '评论状态': derive % 2 === 0 ? '已通过' : '',
      '订单详情': `容量验证订单 ${derive}`,
      '评论链接': '',
      '返款状态': closure === 'INCOMPLETE' ? '待返款' : '已返款',
      '返款汇率': RATE_TRIPLES[rateIndex]!.buyer,
      '返款时间': closure === 'OLD' ? '2024-04-01' : '2026-07-01',
      '返款截图': `cap-img/${derive}/refund.png`,
      '服务费金额': hasFinance ? FEE_BY_FIVE[derive % 5]!.text : '',
      '卖家返金汇率': RATE_TRIPLES[rateIndex]!.seller,
      '结算日期': closure === 'INCOMPLETE' ? '' : closure === 'OLD' ? '2024-04-10' : '2026-07-15',
      '买家返金金额': hasFinance ? REFUND_BY_RATE[rateIndex]!.text : '',
      '卖家返金金额': hasFinance ? PRINCIPAL_BY_RATE[rateIndex]!.text : '',
      '汇率差': kind === 'BAD_SPREAD' ? '0.009' : RATE_TRIPLES[rateIndex]!.spread,
      '利润': '',
    };
    if (kind === 'BAD_DATE') cells['下单日期'] = '2026-13-45';
    if (kind === 'BAD_PARTIAL_FINANCE') {
      cells['服务费金额'] = '25';
      cells['买家返金金额'] = '';
      cells['卖家返金金额'] = '';
    }
    // Conflicting duplicate groups split by contract: group C (3600/3601)
    // differs ONLY on the line-defining amount (multi-line contract), group D
    // (4400/4401) differs ONLY on buyer wechat (plain conflicting duplicate).
    if (!fixed && kind === 'CONFLICT_DUP' && index % 2 === 1) {
      if (index <= 3601) cells['订单价格'] = String(orderAmount + 100);
      else cells['买家微信'] = 'wx-cap-conflict-a';
    }
    lines.push(HISTORICAL_CSV_HEADERS.map((header) => cells[header] ?? '').join(','));

    // ---- expectation aggregation (independent of pipeline internals) ----
    // Collapsed exact-duplicate members are represented by their group head:
    // they are never written, so they contribute no order row and no
    // durable quarantine row.
    const groupHead = kind === 'EXACT_DUP' ? (index <= 1601 ? 1600 : 2400) : null;
    const collapsedMember = groupHead !== null && index !== groupHead;
    // Quarantines discovered BEFORE identity resolution (they skip the loop).
    const preQuarantined = kind === 'BAD_UNKNOWN_MARKETPLACE' || kind === 'BAD_MISSING_COLUMN'
      || kind === 'BAD_NON_INTEGER' || kind === 'BAD_SPREAD' || kind === 'BAD_DATE'
      || kind === 'BAD_PARTIAL_FINANCE' || kind === 'CONFLICT_DUP';
    const rowQuarantineCodes: string[] = [];
    if (preQuarantined) {
      switch (kind) {
        case 'BAD_UNKNOWN_MARKETPLACE': rowQuarantineCodes.push('UNKNOWN_MARKETPLACE'); expected.criticalRows += 1; break;
        case 'BAD_MISSING_COLUMN': rowQuarantineCodes.push('MISSING_REQUIRED_COLUMN'); expected.criticalRows += 1; break;
        case 'BAD_NON_INTEGER': rowQuarantineCodes.push('NON_INTEGER_AMOUNT'); expected.criticalRows += 1; break;
        case 'BAD_SPREAD': rowQuarantineCodes.push('RATE_SPREAD_MISMATCH'); expected.criticalRows += 1; break;
        case 'BAD_DATE': rowQuarantineCodes.push('INVALID_DATE'); break;
        case 'BAD_PARTIAL_FINANCE': rowQuarantineCodes.push('MISSING_FINANCIAL_FIELDS'); break;
        case 'CONFLICT_DUP':
          // Group C (3600/3601) differs on 订单价格 — a line-defining fact —
          // so the multi-line contract holds it as
          // MULTI_LINE_ORDER_REQUIRES_MAPPING; group D (4400/4401) differs
          // only on 买家微信, a plain conflicting duplicate.
          rowQuarantineCodes.push(index <= 3601
            ? 'MULTI_LINE_ORDER_REQUIRES_MAPPING'
            : 'CONFLICTING_DUPLICATE_GROUP');
          expected.criticalRows += 1;
          expected.duplicateRows += 1;
          break;
        default: break;
      }
    } else {
      // Identity stage (rows that reach resolution): conflicts and unmatched
      // outcomes are discovered here, exactly like the pipeline does.
      const buyerWechat = cells['买家微信'] ?? '';
      const store = cells['店铺名字'];
      const buyerOutcome = buyerWechat.startsWith('wx-cap-m') ? 'MATCHED'
        : buyerWechat === 'wx-cap-conflict-a' ? 'CONFLICT' : 'UNMATCHED';
      const sellerOutcome = store === '容量匹配店铺' ? 'MATCHED'
        : store === '容量冲突店铺' ? 'CONFLICT' : 'UNMATCHED';
      if (buyerOutcome === 'CONFLICT') {
        rowQuarantineCodes.push('IDENTITY_CONFLICT');
        expected.buyerConflictRows += 1;
      }
      if (sellerOutcome === 'CONFLICT') {
        rowQuarantineCodes.push('IDENTITY_CONFLICT');
        expected.sellerConflictRows += 1;
      }
      if ((buyerOutcome === 'UNMATCHED' || sellerOutcome === 'UNMATCHED') && !collapsedMember) {
        rowQuarantineCodes.push('IDENTITY_UNMATCHED');
        expected.identityUnmatchedRows += 1;
      }
    }
    if (rowQuarantineCodes.length > 0) expected.quarantinedRows += 1;
    else expected.validRows += 1;
    for (const code of rowQuarantineCodes) bump(code);
    // Written logical orders and their currency: APPLY_LOCAL snapshots every
    // non-collapsed row (quarantined rows included — lossless import).
    if (!collapsedMember) {
      expected.logicalOrders += 1;
      expected.currency.jpy += orderAmount;
      if (hasFinance) {
        expected.currency.refundFen += REFUND_BY_RATE[rateIndex]!.fen;
        expected.currency.principalFen += PRINCIPAL_BY_RATE[rateIndex]!.fen;
        expected.currency.feeFen += FEE_BY_FIVE[derive % 5]!.fen;
      }
    }
    if (kind === 'EXACT_DUP') expected.duplicateRows += 1;
    if (fixed && (cells['买家微信'] ?? '').startsWith('wx-cap-m')) expected.buyerMatchedRows += 1;
    if (fixed && cells['店铺名字'] === '容量匹配店铺') expected.sellerMatchedRows += 1;
    // Dry-run file plans cover EVERY row (quarantined rows still classify).
    expected.files.planned += IMAGE_COLUMNS.length;
    if (closure === 'OLD') expected.files.cold += IMAGE_COLUMNS.length;
    else if (closure === 'RECENT') expected.files.hot += IMAGE_COLUMNS.length;
    else expected.files.quarantineClosure += IMAGE_COLUMNS.length;
  }
  return { csv: `${lines.join('\n')}\n`, expected };
}

export function buildImageInventory(): Map<string, { sha256: string; mime: string; byteSize: number }> {
  const inventory = new Map<string, { sha256: string; mime: string; byteSize: number }>();
  for (let index = 0; index < ORDER_COUNT; index += 1) {
    for (const [slot, name] of IMAGE_SLOTS.entries()) {
      // Every 100th order shares one physical digest across its five slots
      // AND with its neighbours — physical dedup keeps logical rows intact.
      const shared = index % 100 < 5;
      // Digests must be pure lowercase hex (table CHECK constraint).
      const digest = shared
        ? `d${String(index % 100).padStart(4, '0')}`.padEnd(64, '0')
        : `a${String(index).padStart(6, '0')}${String(slot).padStart(2, '0')}`.padEnd(64, '0');
      inventory.set(`cap-img/${index}/${name}.png`, {
        sha256: digest,
        mime: 'image/png',
        byteSize: 100 + (index % 500),
      });
    }
  }
  return inventory;
}

export function seedCapacityIdentities(db: SqliteDatabase): void {
  const buyers = [
    ['wx-cap-m0', 'cap-buyer-m0'], ['wx-cap-m1', 'cap-buyer-m1'],
    ['wx-cap-m2', 'cap-buyer-m2'], ['wx-cap-m3', 'cap-buyer-m3'],
    ['wx-cap-conflict-a', 'cap-buyer-x1'], ['wx-cap-conflict-a', 'cap-buyer-x2'],
  ];
  db.exec(`
    INSERT OR IGNORE INTO buyer_channels(id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at)
    VALUES('cap-channel','Z','容量验证渠道','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO seller_organizations(id,marketplace_code,seller_code,origin_channel_id,current_channel_id,
      seller_sequence,organization_name,status,version,created_at,updated_at,activated_at,disabled_at,next_member_number)
    VALUES('cap-seller-match','AMAZON_JP','cap-match-1','seller-channel-ido-mango','seller-channel-ido-mango',9800,
      '容量匹配卖家','ACTIVE',1,1000,1000,1000,NULL,2),
      ('cap-seller-conflict-1','AMAZON_JP','cap-conf-1','seller-channel-ido-mango','seller-channel-ido-mango',9801,
      '容量冲突卖家一','ACTIVE',1,1000,1000,1000,NULL,2),
      ('cap-seller-conflict-2','AMAZON_JP','cap-conf-2','seller-channel-ido-mango','seller-channel-ido-mango',9802,
      '容量冲突卖家二','ACTIVE',1,1000,1000,1000,NULL,2);
    INSERT INTO seller_stores(id,organization_id,marketplace_code,display_name,normalized_name,status,
      version,created_at,updated_at,disabled_at)
    VALUES('cap-store-match','cap-seller-match','AMAZON_JP','容量匹配店铺','容量匹配店铺','ACTIVE',1,1000,1000,NULL),
      ('cap-store-conflict-1','cap-seller-conflict-1','AMAZON_JP','容量冲突店铺','容量冲突店铺','ACTIVE',1,1000,1000,NULL),
      ('cap-store-conflict-2','cap-seller-conflict-2','AMAZON_JP','容量冲突店铺','容量冲突店铺','ACTIVE',1,1000,1000,NULL);
  `);
  for (const [wechat, buyerId] of buyers) {
    db.exec(`
      INSERT INTO customer_identity_subjects(id,subject_type,created_at)
      VALUES('${buyerId}-subject','BUYER_CUSTOMER',1000);
      INSERT INTO buyer_customers(id,identity_subject_id,marketplace_code,buyer_channel_id,buyer_customer_no,
        buyer_sequence,first_valid_order_business_date,display_name,access_status,identity_review_status,
        version,created_at,updated_at,activated_at,disabled_at)
      VALUES('${buyerId}','${buyerId}-subject','AMAZON_JP','cap-channel',NULL,NULL,NULL,
        '容量验证买家','ACTIVE','CLEAR',1,1000,1000,1000,NULL);
      INSERT INTO wechat_identity_claims(id,identity_subject_id,display_wechat,normalized_wechat,
        status,version,acquired_at,created_at,updated_at)
      VALUES('${buyerId}-claim','${buyerId}-subject','${wechat}','${wechat}','ACTIVE',1,1000,1000,1000);
    `);
  }
}

describe('historical import capacity (stage 6.7)', () => {
  it('runs 20k orders / 100k file plans through dry-run, apply, replay, resume and reconcile',
    { timeout: 590_000 }, async () => {
      const startedAt = Date.now();
      const dirtySource = generateCapacitySource(false);
      const fixedSource = generateCapacitySource(true);
      const imageInventory = buildImageInventory();

      // Sanity on the generator itself before any pipeline involvement.
      expect(dirtySource.expected.sourceRows).toBe(ORDER_COUNT);
      // The injected bad-row mix drives the critical rate; unmatched identity
      // rows now add a large NON-critical quarantine population (realistic:
      // the real import will hold most identities unresolved on first run).
      expect(dirtySource.expected.criticalRows).toBeGreaterThan(ORDER_COUNT * 0.005);
      expect(dirtySource.expected.criticalRows).toBeLessThan(ORDER_COUNT * 0.025);
      expect(dirtySource.expected.quarantinedRows)
        .toBeGreaterThanOrEqual(dirtySource.expected.criticalRows);
      expect(fixedSource.expected.quarantinedRows).toBe(fixedSource.expected.identityUnmatchedRows);
      expect(fixedSource.expected.identityUnmatchedRows).toBeGreaterThan(ORDER_COUNT / 2);
      expect(fixedSource.expected.logicalOrders).toBe(ORDER_COUNT - 3);
      expect(fixedSource.expected.files.planned).toBe(ORDER_COUNT * IMAGE_COLUMNS.length);

      const db1 = createMigratedTestDatabase();
      seedCapacityIdentities(db1);

      // --- 1. DRY_RUN on the dirty source: conservation + blocking gates ---
      const dryDirty = await runHistoricalImport(db1, {
        sourceSystem: 'HISTORICAL_ORDER_CSV',
        files: [{ name: 'capacity-dirty.csv', text: dirtySource.csv }],
        imageInventory,
        now: NOW,
      }, { mode: 'DRY_RUN' });
      expect(dryDirty.report.source_rows).toBe(ORDER_COUNT);
      expect(dryDirty.report.source_rows)
        .toBe(dryDirty.report.valid_rows + dryDirty.report.quarantined_rows);
      expect(dryDirty.report.valid_rows).toBe(dirtySource.expected.validRows);
      expect(dryDirty.report.quarantined_rows).toBe(dirtySource.expected.quarantinedRows);
      expect(dryDirty.report.quarantine_by_code).toEqual(dirtySource.expected.quarantineByCode);
      expect(dryDirty.report.duplicate_rows).toBe(dirtySource.expected.duplicateRows);
      expect(dryDirty.report.buyer_matches.conflicts).toBe(dirtySource.expected.buyerConflictRows);
      expect(dryDirty.report.seller_matches.conflicts).toBe(dirtySource.expected.sellerConflictRows);
      expect(dryDirty.report.file_plan.planned).toBe(dirtySource.expected.files.planned);
      expect(dryDirty.report.file_plan.cold_archive_eligible).toBe(dirtySource.expected.files.cold);
      expect(dryDirty.report.file_plan.hot_r2).toBe(dirtySource.expected.files.hot);
      expect(dryDirty.report.file_plan.quarantine).toBe(dirtySource.expected.files.quarantineClosure);
      expect(dryDirty.report.can_apply).toBe(false);
      expect(dryDirty.report.cannot_apply_reasons[0])
        .toBe(`critical_quarantine_rows:${dirtySource.expected.criticalRows}`);

      // --- 2. APPLY on the dirty source is blocked; nothing is written ---
      const blockedApply = await runHistoricalImport(db1, {
        sourceSystem: 'HISTORICAL_ORDER_CSV',
        files: [{ name: 'capacity-dirty.csv', text: dirtySource.csv }],
        imageInventory,
        now: NOW,
      }, { mode: 'APPLY_LOCAL' });
      expect(blockedApply.applied_orders).toBe(0);
      const afterBlock = await db1.prepare('SELECT COUNT(*) AS count FROM historical_orders')
        .first<{ count: number }>();
      expect(afterBlock!.count).toBe(0);

      // --- 3. APPLY the repaired source in per-order batches ---
      const applyStartedAt = Date.now();
      const applied = await runHistoricalImport(db1, {
        sourceSystem: 'HISTORICAL_ORDER_CSV',
        files: [{ name: 'capacity-fixed.csv', text: fixedSource.csv }],
        imageInventory,
        now: NOW,
      }, { mode: 'APPLY_LOCAL' });
      const applyMs = Date.now() - applyStartedAt;
      expect(applied.report.can_apply).toBe(true);
      expect(applied.applied_orders).toBe(fixedSource.expected.logicalOrders);
      expect(applied.report.buyer_matches.matched).toBe(fixedSource.expected.buyerMatchedRows);
      expect(applied.report.seller_matches.matched).toBe(fixedSource.expected.sellerMatchedRows);
      expect(applied.report.currency_totals).toEqual({
        order_amount_jpy_minor: fixedSource.expected.currency.jpy,
        buyer_refund_cny_minor: fixedSource.expected.currency.refundFen,
        seller_principal_cny_minor: fixedSource.expected.currency.principalFen,
        service_fee_cny_minor: fixedSource.expected.currency.feeFen,
      });
      const durable = await db1.prepare(
        `SELECT (SELECT COUNT(*) FROM historical_orders) AS orders,
          (SELECT COUNT(*) FROM historical_order_files) AS files,
          (SELECT COUNT(*) FROM historical_import_quarantine) AS quarantine`,
      ).first<{ orders: number; files: number; quarantine: number }>();
      expect(durable!.orders).toBe(fixedSource.expected.logicalOrders);
      expect(durable!.files).toBe(fixedSource.expected.logicalOrders * IMAGE_COLUMNS.length);
      expect(durable!.quarantine).toBe(fixedSource.expected.identityUnmatchedRows);

      // --- 4. Replaying the same source is fully idempotent ---
      const replayed = await runHistoricalImport(db1, {
        sourceSystem: 'HISTORICAL_ORDER_CSV',
        files: [{ name: 'capacity-fixed.csv', text: fixedSource.csv }],
        imageInventory,
        now: NOW + 1,
      }, { mode: 'APPLY_LOCAL' });
      expect(replayed.replayed).toBe(true);
      expect(replayed.applied_orders).toBe(0);
      const afterReplay = await db1.prepare('SELECT COUNT(*) AS count FROM historical_orders')
        .first<{ count: number }>();
      expect(afterReplay!.count).toBe(fixedSource.expected.logicalOrders);

      // --- 5. Reconciliation ties the batch back to the input ---
      const reconciliation = await reconcileHistoricalImport(db1, applied.batch_id!);
      expect(reconciliation.imported_orders).toBe(fixedSource.expected.logicalOrders);
      expect(reconciliation.file_rows).toBe(fixedSource.expected.logicalOrders * IMAGE_COLUMNS.length);
      expect(reconciliation.currency_totals).toEqual({
        order_amount_jpy_minor: fixedSource.expected.currency.jpy,
        buyer_refund_cny_minor: fixedSource.expected.currency.refundFen,
        seller_principal_cny_minor: fixedSource.expected.currency.principalFen,
        service_fee_cny_minor: fixedSource.expected.currency.feeFen,
      });
      expect(reconciliation.classification_counts).toEqual({
        COLD_ARCHIVE_ELIGIBLE: fixedSource.expected.files.cold - 3 * IMAGE_COLUMNS.length,
        HOT_R2: fixedSource.expected.files.hot,
        QUARANTINE: fixedSource.expected.files.quarantineClosure,
      });
      // Physical dedup keys repeat across orders while logical rows persist.
      const dedupGroups = await db1.prepare(
        `SELECT COUNT(*) AS groups FROM (SELECT physical_dedup_key FROM historical_order_files
          WHERE physical_dedup_key LIKE 'd000%' GROUP BY physical_dedup_key HAVING COUNT(*)>${IMAGE_COLUMNS.length})`,
      ).first<{ groups: number }>();
      expect(dedupGroups!.groups).toBe(5);

      // --- 6. Interrupted apply + resume == one-shot result (fresh db) ---
      const db2 = createMigratedTestDatabase();
      seedCapacityIdentities(db2);
      const interruptOrderNumber = orderNumberOf(9999);
      db2.exec(`
        CREATE TRIGGER cap_interrupt BEFORE INSERT ON historical_orders
        WHEN NEW.source_order_id='${interruptOrderNumber}'
        BEGIN SELECT RAISE(ABORT,'injected_interrupt'); END;
      `);
      const interruptStartedAt = Date.now();
      const interrupted = await runHistoricalImport(db2, {
        sourceSystem: 'HISTORICAL_ORDER_CSV',
        files: [{ name: 'capacity-fixed.csv', text: fixedSource.csv }],
        imageInventory,
        now: NOW,
      }, { mode: 'APPLY_LOCAL' }).then(() => null, (error: unknown) => error);
      const interruptMs = Date.now() - interruptStartedAt;
      expect(interrupted).toBeInstanceOf(Error);
      const partial = await db2.prepare('SELECT COUNT(*) AS count FROM historical_orders')
        .first<{ count: number }>();
      // Rows 1..9999 contain 3 collapsed exact-duplicate members.
      expect(partial!.count).toBe(9996);
      db2.exec('DROP TRIGGER cap_interrupt');
      const resumeStartedAt = Date.now();
      const runningBatch = await db2.prepare(
        `SELECT id FROM historical_import_batches WHERE status='RUNNING'`,
      ).first<{ id: string }>();
      const resumed = await runHistoricalImport(db2, {
        sourceSystem: 'HISTORICAL_ORDER_CSV',
        files: [{ name: 'capacity-fixed.csv', text: fixedSource.csv }],
        imageInventory,
        now: NOW + 1,
      }, { mode: 'APPLY_LOCAL', resumeBatchId: runningBatch!.id });
      const resumeMs = Date.now() - resumeStartedAt;
      expect(resumed.applied_orders).toBe(fixedSource.expected.logicalOrders - 9996);
      const resumedState = await db2.prepare(
        `SELECT (SELECT COUNT(*) FROM historical_orders) AS orders,
          (SELECT COUNT(*) FROM historical_order_files) AS files,
          (SELECT COUNT(*) FROM historical_import_quarantine) AS quarantine,
          (SELECT COALESCE(SUM(order_amount_source_minor),0) FROM historical_orders) AS jpy,
          (SELECT COALESCE(SUM(buyer_refund_amount_source_minor),0) FROM historical_orders) AS refund,
          (SELECT COALESCE(SUM(seller_principal_amount_source_minor),0) FROM historical_orders) AS principal,
          (SELECT COALESCE(SUM(service_fee_source_minor),0) FROM historical_orders) AS fee`,
      ).first<{ orders: number; files: number; quarantine: number; jpy: number; refund: number; principal: number; fee: number }>();
      expect(resumedState!.orders).toBe(fixedSource.expected.logicalOrders);
      expect(resumedState!.files).toBe(fixedSource.expected.logicalOrders * IMAGE_COLUMNS.length);
      expect(resumedState!.quarantine).toBe(fixedSource.expected.identityUnmatchedRows);
      expect(resumedState!.jpy).toBe(fixedSource.expected.currency.jpy);
      expect(resumedState!.refund).toBe(fixedSource.expected.currency.refundFen);
      expect(resumedState!.principal).toBe(fixedSource.expected.currency.principalFen);
      expect(resumedState!.fee).toBe(fixedSource.expected.currency.feeFen);
      const duplicateRowKeys = await db2.prepare(
        `SELECT COUNT(*) AS count FROM (SELECT source_order_id FROM historical_orders
          GROUP BY import_batch_id, source_order_id HAVING COUNT(*)>1)`,
      ).first<{ count: number }>();
      expect(duplicateRowKeys!.count).toBe(0);

      // --- 7. Bounded per-statement parameters (D1 caps at 100) ---
      for (const table of ['historical_import_batches', 'historical_orders',
        'historical_order_files', 'historical_import_quarantine']) {
        const columns = db2.raw.prepare(`PRAGMA table_info(${table})`).all() as unknown[];
        expect(columns.length).toBeLessThan(100);
      }

      // --- 8. No O(N²): the resumed half (table already 50% full) must not
      // be dramatically slower than the interrupted first half. ---
      expect(resumeMs).toBeLessThan(Math.max(interruptMs * 15, 60_000));

      const summary = {
        orders: ORDER_COUNT,
        file_plans: fixedSource.expected.files.planned,
        logical_orders_imported: fixedSource.expected.logicalOrders,
        dirty_quarantined_rows: dirtySource.expected.quarantinedRows,
        critical_rows: dirtySource.expected.criticalRows,
        identity_unmatched_rows: fixedSource.expected.identityUnmatchedRows,
        apply_ms: applyMs,
        interrupt_ms: interruptMs,
        resume_ms: resumeMs,
        total_ms: Date.now() - startedAt,
        real_historical_import: 'NOT_RUN_SYNTHETIC_ONLY',
      };
      console.log('[historical-import-capacity]', JSON.stringify(summary));
      db1.close();
      db2.close();
    });
});
