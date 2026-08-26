import type { SqlDatabase } from '@ygb/contracts';
import { canonicalJson, sha256Hex } from '@ygb/domain';

/**
 * Stage 6 historical order importer (D-054 lossless-import obligation).
 *
 * Layered, resumable pipeline: source discovery → raw parsing →
 * normalization → validation → identity resolution → conflict/quarantine →
 * dry-run report → local apply → reconciliation. External sources are read
 * verbatim and never modified; every run is keyed by source SHA-256 and is
 * idempotent; financial facts are integer snapshots that are never
 * recomputed from current policy.
 *
 * This module intentionally reuses the seller-partner import vocabulary
 * (manifest hash, quarantine codes, conservation counts) instead of
 * inventing a parallel framework.
 */

export const HISTORICAL_PARSER_VERSION = '2026-08-26-historical-order-v1';
export const HISTORICAL_MAPPING_VERSION = '2026-08-26-baseline-30col-v1';

export const HISTORICAL_CSV_HEADERS = [
  '下单日期', '更新状态', '客户编号', '买家微信', '店铺名字', 'ASIN', '订单价格', '聊天截图',
  '订单截图', '订单号', '到货图', '提交评论日期', '通过日期', '评论通过截图', '补fb日期', '补fb截图',
  '评论状态', '订单详情', '评论链接', '返款状态', '返款汇率', '返款时间', '返款截图', '服务费金额',
  '卖家返金汇率', '结算日期', '买家返金金额', '卖家返金金额', '汇率差', '利润',
] as const;

/** Image columns that become file plans; 到货图 (arrival) stays ignored. */
export const HISTORICAL_IMAGE_COLUMNS = {
  '聊天截图': { purpose: 'ORDER_EVIDENCE', audience: 'INTERNAL_ONLY' },
  '订单截图': { purpose: 'ORDER_EVIDENCE', audience: 'INTERNAL_ONLY' },
  '评论通过截图': { purpose: 'REVIEW_EVIDENCE', audience: 'INTERNAL_ONLY' },
  '补fb截图': { purpose: 'REVIEW_EVIDENCE', audience: 'INTERNAL_ONLY' },
  '返款截图': { purpose: 'BUYER_REFUND_PROOF', audience: 'INTERNAL_ONLY' },
} as const;

export type HistoricalQuarantineCode =
  | 'UNKNOWN_MARKETPLACE' | 'INVALID_ORDER_NUMBER' | 'MISSING_REQUIRED_COLUMN' | 'NON_INTEGER_AMOUNT'
  | 'INVALID_DATE' | 'IDENTITY_CONFLICT' | 'IDENTITY_UNMATCHED' | 'DUPLICATE_SOURCE_ORDER'
  | 'MISSING_FINANCIAL_FIELDS' | 'RATE_SPREAD_MISMATCH' | 'CONFLICTING_DUPLICATE_GROUP'
  | 'FILE_MISSING' | 'FILE_CORRUPT' | 'FILE_ORPHAN' | 'MULTI_SELLER_AMBIGUOUS';

export type HistoricalFileClassification =
  | 'HOT_R2' | 'COLD_ARCHIVE_ELIGIBLE' | 'QUARANTINE' | 'MISSING' | 'CORRUPT' | 'ORPHAN';

export interface HistoricalRawRow {
  rowKey: string;
  lineNumber: number;
  /** Raw 30-column cells keyed by the canonical Chinese header. */
  cells: Record<string, string>;
}

export interface HistoricalNormalizedOrder {
  source_row_key: string;
  source_order_id: string;
  marketplace_code: 'AMAZON_JP';
  ordered_on: string;
  status_snapshot_raw: string | null;
  buyer_customer_no_ref: string | null;
  buyer_wechat_ref: string | null;
  store_name_ref: string | null;
  platform_product_identifier: string | null;
  order_amount_source_minor: number | null;
  platform_order_number_raw: string | null;
  platform_order_number_normalized: string | null;
  review_submitted_on: string | null;
  review_approved_on: string | null;
  review_status_raw: string | null;
  review_url_raw: string | null;
  buyer_rate_source_e8: number | null;
  refunded_on: string | null;
  seller_rate_source_e8: number | null;
  replenishment_submitted_on: string | null;
  service_fee_source_minor: number | null;
  settled_on: string | null;
  buyer_refund_amount_source_minor: number | null;
  seller_principal_amount_source_minor: number | null;
  rate_spread_source_e8: number | null;
  profit_source_minor: number | null;
  order_detail_note: string | null;
}

export interface HistoricalFilePlan {
  source_column: string;
  source_ref: string | null;
  purpose: keyof typeof HISTORICAL_IMAGE_COLUMNS extends infer T ? (T extends keyof typeof HISTORICAL_IMAGE_COLUMNS ? T : never) : never;
  audience: 'INTERNAL_ONLY';
  classification: HistoricalFileClassification;
  classification_reason: string | null;
  content_sha256: string | null;
  mime_type: string | null;
  byte_size: number | null;
}

export interface HistoricalRowOutcome {
  rowKey: string;
  order: HistoricalNormalizedOrder | null;
  files: HistoricalFilePlan[];
  quarantines: { code: HistoricalQuarantineCode; detail: Record<string, unknown> }[];
  duplicateGroup: { key: string; size: number; kind: 'EXACT_SOURCE_FACTS' | 'CONFLICTING' | 'UNIQUE' } | null;
}

export interface HistoricalDryRunReport {
  status: 'LOCAL_DRY_RUN';
  batch_id: string | null;
  source_files: { name: string; sha256: string; bytes: number }[];
  source_rows: number;
  valid_rows: number;
  quarantined_rows: number;
  duplicate_rows: number;
  buyer_matches: { matched: number; unmatched: number; conflicts: number };
  seller_matches: { matched: number; unmatched: number; conflicts: number };
  marketplace_mapping: { AMAZON_JP: number; unknown: number };
  financial_conflicts: number;
  status_conflicts: number;
  missing_fields: number;
  file_plan: {
    planned: number;
    bytes: number;
    by_purpose: Record<string, number>;
    missing: number;
    corrupt: number;
    orphan: number;
    hot_r2: number;
    cold_archive_eligible: number;
    quarantine: number;
  };
  projected_bundles: number;
  quarantine_by_code: Record<string, number>;
  currency_totals: {
    order_amount_jpy_minor: number;
    buyer_refund_cny_minor: number | null;
    seller_principal_cny_minor: number | null;
    service_fee_cny_minor: number | null;
  };
  checkpoint_row_key: string | null;
  can_apply: boolean;
  cannot_apply_reasons: string[];
}

export interface HistoricalSourceInput {
  sourceSystem: 'HISTORICAL_ORDER_CSV' | 'HISTORICAL_ORDER_JSONL';
  files: { name: string; text: string }[];
  /** Optional physical image inventory for file planning (path → facts). */
  imageInventory?: Map<string, { sha256: string; mime: string; byteSize: number }>;
  now?: number;
}

export interface HistoricalImportRunOptions {
  mode: 'INSPECT' | 'DRY_RUN' | 'APPLY_LOCAL';
  /** Resume: continue an existing RUNNING batch from its checkpoint. */
  resumeBatchId?: string;
  actorStaffId?: string;
  perOrderBatchStatements?: number;
  now?: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Amazon JP order numbers: 3-7-7 digits with dashes (missing separators normalized). */
const AMAZON_JP_RAW = /^\d{3}-\d{7}-\d{7}$/;
const AMAZON_JP_COMPACT = /^\d{3}\d{7}\d{7}$/;
const RAKUTEN_RAW = /^\d{6}-\d{8}-\d{10}$/;
const TIKTOK_RAW = /^585\d{15}$/;

// ---------------------------------------------------------------------------
// 1. Source discovery + raw parsing
// ---------------------------------------------------------------------------

export async function discoverHistoricalSources(input: HistoricalSourceInput): Promise<{
  files: { name: string; sha256: string; bytes: number }[];
  combinedSha: string;
}> {
  const files: { name: string; sha256: string; bytes: number }[] = [];
  for (const file of input.files) {
    files.push({
      name: file.name,
      sha256: await sha256Hex(file.text),
      bytes: new TextEncoder().encode(file.text).byteLength,
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  const combinedSha = await sha256Hex(canonicalJson(files.map((file) => [file.name, file.sha256])));
  return { files, combinedSha };
}

export function parseHistoricalCsv(name: string, text: string, sourceSha: string): HistoricalRawRow[] {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error('SOURCE_READ_FAILED');
  const header = splitCsvLine(lines[0]!);
  const expected = [...HISTORICAL_CSV_HEADERS];
  if (header.length !== expected.length || header.some((cell, index) => cell !== expected[index])) {
    throw new Error('SOURCE_HEADER_MISMATCH');
  }
  const rows: HistoricalRawRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const cells = splitCsvLine(lines[index]!);
    const record: Record<string, string> = {};
    expected.forEach((column, columnIndex) => {
      record[column] = (cells[columnIndex] ?? '').trim();
    });
    rows.push({
      rowKey: `historical-order-source:${sourceSha.slice(0, 12)}:${name}:row:${String(index).padStart(6, '0')}`,
      lineNumber: index,
      cells: record,
    });
  }
  return rows;
}

export function parseHistoricalJsonl(name: string, text: string, sourceSha: string): HistoricalRawRow[] {
  const rows: HistoricalRawRow[] = [];
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  lines.forEach((line, index) => {
    const parsed = JSON.parse(line) as { raw_fields?: Record<string, unknown> };
    const raw = parsed['raw_fields'] ?? {};
    const record: Record<string, string> = {};
    for (const column of HISTORICAL_CSV_HEADERS) {
      const value = raw[column];
      record[column] = value === undefined || value === null ? '' : String(value).trim();
    }
    rows.push({
      rowKey: `historical-order-source:${sourceSha.slice(0, 12)}:${name}:row:${String(index + 1).padStart(6, '0')}`,
      lineNumber: index + 1,
      cells: record,
    });
  });
  return rows;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

// ---------------------------------------------------------------------------
// 2–3. Normalization + validation
// ---------------------------------------------------------------------------

/** Exact decimal-text → integer conversion (string arithmetic, no floats). */
export function decimalToScaleE8(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/u.test(trimmed) && !/^0\.\d+$/u.test(trimmed) && !/^\d+\.$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > 8) return null;
  const padded = (fraction + '0'.repeat(8)).slice(0, 8);
  const result = Number(whole ?? '0') * 100_000_000 + Number(padded || '0');
  return Number.isSafeInteger(result) ? result : null;
}

export function classifyOrderIdentifier(raw: string): {
  marketplace: 'AMAZON_JP' | 'RAKUTEN' | 'TIKTOK' | 'UNKNOWN';
  normalized: string | null;
  note: string | null;
} {
  const trimmed = raw.trim();
  if (AMAZON_JP_RAW.test(trimmed)) return { marketplace: 'AMAZON_JP', normalized: trimmed, note: null };
  if (AMAZON_JP_COMPACT.test(trimmed)) {
    return {
      marketplace: 'AMAZON_JP',
      normalized: `${trimmed.slice(0, 3)}-${trimmed.slice(3, 10)}-${trimmed.slice(10)}`,
      note: 'NORMALIZED_MISSING_SEPARATOR',
    };
  }
  if (RAKUTEN_RAW.test(trimmed)) return { marketplace: 'RAKUTEN', normalized: null, note: null };
  if (TIKTOK_RAW.test(trimmed)) return { marketplace: 'TIKTOK', normalized: null, note: null };
  return { marketplace: 'UNKNOWN', normalized: null, note: null };
}

export function normalizeHistoricalRow(row: HistoricalRawRow): HistoricalRowOutcome {
  const cells = row.cells;
  const quarantines: HistoricalRowOutcome['quarantines'] = [];
  const required: Array<keyof typeof cells> = ['下单日期', '客户编号', '买家微信', '店铺名字', 'ASIN', '订单号', '订单价格'];
  const missing = required.filter((column) => cells[column] === '');
  if (missing.length > 0) {
    quarantines.push({ code: 'MISSING_REQUIRED_COLUMN', detail: { columns: missing } });
  }
  const identifier = classifyOrderIdentifier(cells['订单号'] ?? '');
  if (identifier.marketplace !== 'AMAZON_JP') {
    quarantines.push({ code: 'UNKNOWN_MARKETPLACE', detail: { raw: cells['订单号'], marketplace: identifier.marketplace } });
  }
  // JPY amounts are integer yen; CNY amounts arrive as decimal yuan and are
  // scaled to integer fen with exact string arithmetic (never JS floats).
  const orderAmount = parseIntegerAmount(cells['订单价格'] ?? '');
  const serviceFee = parseCnyYuanToMinor(cells['服务费金额'] ?? '');
  const buyerRefund = parseCnyYuanToMinor(cells['买家返金金额'] ?? '');
  const sellerPrincipal = parseCnyYuanToMinor(cells['卖家返金金额'] ?? '');
  const profit = parseCnyYuanToMinor(cells['利润'] ?? '');
  for (const [column, value] of [
    ['订单价格', orderAmount], ['服务费金额', serviceFee],
    ['买家返金金额', buyerRefund], ['卖家返金金额', sellerPrincipal],
  ] as const) {
    if (cells[column] !== '' && value === null) {
      quarantines.push({ code: 'NON_INTEGER_AMOUNT', detail: { column, raw: cells[column] } });
    }
  }
  const buyerRate = cells['返款汇率'] === '' ? null : decimalToScaleE8(cells['返款汇率'] ?? '');
  const sellerRate = cells['卖家返金汇率'] === '' ? null : decimalToScaleE8(cells['卖家返金汇率'] ?? '');
  const spreadSource = cells['汇率差'] === '' ? null : decimalToScaleE8(cells['汇率差'] ?? '');
  if (buyerRate !== null && sellerRate !== null && spreadSource !== null
    && buyerRate - sellerRate !== spreadSource) {
    quarantines.push({ code: 'RATE_SPREAD_MISMATCH', detail: {
      buyer_e8: buyerRate, seller_e8: sellerRate, source_e8: spreadSource,
    } });
  }
  // Financial fidelity: amounts present must be integers; critical financial
  // rows with partial facts quarantine rather than silently importing zeros.
  const financialColumns = [cells['服务费金额'], cells['买家返金金额'], cells['卖家返金金额']];
  const presentFinancial = financialColumns.filter((value) => value !== '').length;
  if (presentFinancial > 0 && presentFinancial < financialColumns.length) {
    quarantines.push({ code: 'MISSING_FINANCIAL_FIELDS', detail: {
      present: presentFinancial, total: financialColumns.length,
    } });
  }
  const dates = {
    ordered_on: normalizeDate(cells['下单日期'] ?? ''),
    review_submitted_on: normalizeDate(cells['提交评论日期'] ?? ''),
    review_approved_on: normalizeDate(cells['通过日期'] ?? ''),
    replenishment_submitted_on: normalizeDate(cells['补fb日期'] ?? ''),
    refunded_on: normalizeDate(cells['返款时间'] ?? ''),
    settled_on: normalizeDate(cells['结算日期'] ?? ''),
  };
  const invalidDates = Object.entries(dates)
    .filter(([, value]) => value === null && cells[DATE_COLUMN_BY_FIELD[0]!] !== '')
    .map(([field]) => field);
  for (const [field, sourceColumn] of [
    ['ordered_on', '下单日期'], ['review_approved_on', '通过日期'], ['refunded_on', '返款时间'], ['settled_on', '结算日期'],
  ] as const) {
    if (cells[sourceColumn] !== '' && dates[field as keyof typeof dates] === null) {
      quarantines.push({ code: 'INVALID_DATE', detail: { column: sourceColumn, raw: cells[sourceColumn] } });
    }
  }
  void invalidDates;
  const order: HistoricalNormalizedOrder = {
    source_row_key: row.rowKey,
    source_order_id: identifier.normalized ?? (cells['订单号'] ?? ''),
    marketplace_code: 'AMAZON_JP',
    ordered_on: dates.ordered_on ?? '',
    status_snapshot_raw: cells['更新状态'] || null,
    buyer_customer_no_ref: cells['客户编号'] || null,
    buyer_wechat_ref: cells['买家微信'] || null,
    store_name_ref: cells['店铺名字'] || null,
    platform_product_identifier: cells['ASIN'] || null,
    order_amount_source_minor: orderAmount,
    platform_order_number_raw: cells['订单号'] || null,
    platform_order_number_normalized: identifier.normalized,
    review_submitted_on: dates.review_submitted_on,
    review_approved_on: dates.review_approved_on,
    review_status_raw: cells['评论状态'] || null,
    review_url_raw: cells['评论链接'] || null,
    buyer_rate_source_e8: buyerRate,
    refunded_on: dates.refunded_on,
    seller_rate_source_e8: sellerRate,
    replenishment_submitted_on: dates.replenishment_submitted_on,
    service_fee_source_minor: serviceFee,
    settled_on: dates.settled_on,
    buyer_refund_amount_source_minor: buyerRefund,
    seller_principal_amount_source_minor: sellerPrincipal,
    rate_spread_source_e8: spreadSource,
    profit_source_minor: profit,
    order_detail_note: cells['订单详情'] || null,
  };
  return { rowKey: row.rowKey, order, files: [], quarantines, duplicateGroup: null };
}

const DATE_COLUMN_BY_FIELD = ['下单日期'] as const;

function parseIntegerAmount(raw: string): number | null {
  const trimmed = raw.replace(/[,\s]/gu, '');
  if (!/^\d+$/u.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/** Exact decimal yuan → integer fen (string arithmetic, ≤2 decimals). */
export function parseCnyYuanToMinor(raw: string): number | null {
  const trimmed = raw.replace(/[,\s]/gu, '');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{1,2})?$/u.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const padded = (fraction + '00').slice(0, 2);
  const value = Number(whole!) * 100 + Number(padded);
  return Number.isSafeInteger(value) ? value : null;
}

function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim().replace(/\//gu, '-');
  if (trimmed === '') return null;
  if (!DATE_ONLY.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// 4–5. Identity resolution (deterministic, override-aware, never fuzzy)
// ---------------------------------------------------------------------------

export interface IdentityResolution {
  buyer_customer_id: string | null;
  seller_organization_id: string | null;
  buyerOutcome: 'MATCHED' | 'UNMATCHED' | 'CONFLICT';
  sellerOutcome: 'MATCHED' | 'UNMATCHED' | 'CONFLICT';
}

export async function resolveHistoricalIdentity(
  database: SqlDatabase,
  order: HistoricalNormalizedOrder,
): Promise<IdentityResolution> {
  const buyerOverride = order.buyer_wechat_ref
    ? await database
      .prepare(`SELECT resolved_id FROM historical_import_identity_overrides
        WHERE source_system='HISTORICAL_ORDER_CSV' AND resolved_kind='BUYER_CUSTOMER' AND source_key=?`)
      .bind(order.buyer_wechat_ref).first<{ resolved_id: string }>()
    : null;
  const sellerOverride = order.store_name_ref
    ? await database
      .prepare(`SELECT resolved_id FROM historical_import_identity_overrides
        WHERE source_system='HISTORICAL_ORDER_CSV' AND resolved_kind='SELLER_ORGANIZATION' AND source_key=?`)
      .bind(order.store_name_ref).first<{ resolved_id: string }>()
    : null;
  let buyerId = buyerOverride?.resolved_id ?? null;
  let buyerOutcome: IdentityResolution['buyerOutcome'] = buyerOverride ? 'MATCHED' : 'UNMATCHED';
  if (!buyerOverride && order.buyer_wechat_ref) {
    const rows = await database
      .prepare(`SELECT DISTINCT buyer.id AS buyer_id FROM wechat_identity_claims claim
        JOIN customer_identity_subjects subject ON subject.id=claim.identity_subject_id
        JOIN buyer_customers buyer ON buyer.identity_subject_id=subject.id
        WHERE claim.normalized_wechat=? LIMIT 2`)
      .bind(normalizeWechat(order.buyer_wechat_ref)).all<{ buyer_id: string }>();
    if (rows.results.length === 1) {
      buyerId = rows.results[0]!.buyer_id;
      buyerOutcome = 'MATCHED';
    } else if (rows.results.length > 1) {
      buyerOutcome = 'CONFLICT';
    }
  }
  let sellerId = sellerOverride?.resolved_id ?? null;
  let sellerOutcome: IdentityResolution['sellerOutcome'] = sellerOverride ? 'MATCHED' : 'UNMATCHED';
  if (!sellerOverride && order.store_name_ref) {
    const rows = await database
      .prepare(`SELECT organization_id FROM seller_stores
        WHERE normalized_name=? AND status='ACTIVE' LIMIT 2`)
      .bind(order.store_name_ref.trim().toLowerCase())
      .all<{ organization_id: string }>();
    const unique = new Set(rows.results.map((row) => row.organization_id));
    if (unique.size === 1) {
      sellerId = [...unique][0]!;
      sellerOutcome = 'MATCHED';
    } else if (unique.size > 1) {
      sellerOutcome = 'CONFLICT';
    }
  }
  return {
    buyer_customer_id: buyerId,
    seller_organization_id: sellerId,
    buyerOutcome,
    sellerOutcome,
  };
}

function normalizeWechat(raw: string): string {
  return raw.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// 6. File classification (fail closed; archive path goes through stage 5)
// ---------------------------------------------------------------------------

export function classifyHistoricalFiles(
  row: HistoricalRawRow,
  order: HistoricalNormalizedOrder,
  inventory: Map<string, { sha256: string; mime: string; byteSize: number }> | undefined,
  today: string,
): HistoricalFilePlan[] {
  const plans: HistoricalFilePlan[] = [];
  const closureComplete = order.review_approved_on !== null
    && order.refunded_on !== null && order.settled_on !== null;
  const lastClosed = closureComplete
    ? maxDate(order.review_approved_on ?? '', order.refunded_on ?? '', order.settled_on ?? '')
    : null;
  const coldEligible = closureComplete && lastClosed !== null && addMonthsUtc(lastClosed, 6) <= today;
  for (const [column, meta] of Object.entries(HISTORICAL_IMAGE_COLUMNS)) {
    const ref = row.cells[column] ?? '';
    if (ref === '') continue;
    const inventoryEntry = inventory?.get(ref) ?? null;
    let classification: HistoricalFileClassification;
    let reason: string | null = null;
    if (!inventory) {
      // No physical source provided (REAL_HISTORICAL_IMPORT=NOT_RUN mode):
      // plan conservatively as HOT_R2 — cold eligibility is only assigned
      // when closure facts are complete AND bytes were actually inspected.
      classification = coldEligible ? 'QUARANTINE' : 'HOT_R2';
      reason = coldEligible ? 'cold_candidate_requires_byte_inspection' : null;

    } else if (!inventoryEntry) {
      classification = 'MISSING';
      reason = 'referenced_source_not_found';
    } else if (inventoryEntry.mime === '' || inventoryEntry.byteSize === 0) {
      classification = 'CORRUPT';
      reason = 'unreadable_or_empty';
    } else if (!closureComplete) {
      classification = 'QUARANTINE';
      reason = 'closure_time_incomplete';
    } else {
      classification = coldEligible ? 'COLD_ARCHIVE_ELIGIBLE' : 'HOT_R2';
    }
    plans.push({
      source_column: column,
      source_ref: ref,
      purpose: meta.purpose as HistoricalFilePlan['purpose'],
      audience: meta.audience as 'INTERNAL_ONLY',
      classification,
      classification_reason: reason,
      content_sha256: inventoryEntry?.sha256 ?? null,
      mime_type: inventoryEntry?.mime ?? null,
      byte_size: inventoryEntry?.byteSize ?? null,
    });
  }
  return plans;
}

function maxDate(...dates: string[]): string {
  return dates.reduce((max, value) => (value > max ? value : max));
}

export function addMonthsUtc(dateOnly: string, months: number): string {
  const parts = dateOnly.split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = total % 12 + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}
