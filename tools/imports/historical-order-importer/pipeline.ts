import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { canonicalJson, sha256Hex } from '@ygb/domain';
import {
  classifyHistoricalFiles,
  discoverHistoricalSources,
  HISTORICAL_LINE_DEFINING_COLUMNS,
  HISTORICAL_MAPPING_VERSION,
  HISTORICAL_PARSER_VERSION,
  normalizeHistoricalRow,
  parseHistoricalCsv,
  parseHistoricalJsonl,
  resolveHistoricalIdentity,
  type HistoricalDryRunReport,
  type HistoricalImportRunOptions,
  type HistoricalRawRow,
  type HistoricalRowOutcome,
  type HistoricalSourceInput,
} from './index';

/**
 * Orchestrator for the stage 6 import lifecycle. DRY_RUN is the default and
 * writes nothing; APPLY_LOCAL writes only the historical_* snapshot tables
 * (never live formal_orders) in per-order batches with a resumable
 * checkpoint; repeated runs of the same source are idempotent by
 * (source_system, files_sha, parser, mapping, mode).
 */

const CRITICAL_QUARANTINE_CODES = new Set([
  'UNKNOWN_MARKETPLACE', 'INVALID_ORDER_NUMBER', 'MISSING_REQUIRED_COLUMN',
  'NON_INTEGER_AMOUNT', 'CONFLICTING_DUPLICATE_GROUP', 'MULTI_LINE_ORDER_REQUIRES_MAPPING',
  'RATE_SPREAD_MISMATCH',
]);

export interface HistoricalRunResult {
  report: HistoricalDryRunReport;
  batch_id: string | null;
  replayed: boolean;
  resumed_from: string | null;
  applied_orders: number;
}

export async function runHistoricalImport(
  database: SqlDatabase,
  input: HistoricalSourceInput,
  options: HistoricalImportRunOptions,
): Promise<HistoricalRunResult> {
  const now = options.now ?? input.now ?? Date.now();
  const { files, combinedSha } = await discoverHistoricalSources(input);
  const rawRows: HistoricalRawRow[] = [];
  for (const file of input.files) {
    if (input.sourceSystem === 'HISTORICAL_ORDER_CSV') {
      rawRows.push(...parseHistoricalCsv(file.name, file.text, files.find((f) => f.name === file.name)!.sha256));
    } else {
      rawRows.push(...parseHistoricalJsonl(file.name, file.text, files.find((f) => f.name === file.name)!.sha256));
    }
  }
  rawRows.sort((a, b) => a.rowKey.localeCompare(b.rowKey));

  // Idempotent run identity: same source + versions + mode replays.
  const existing = options.resumeBatchId
    ? await database
      .prepare('SELECT id,status,checkpoint_row_key FROM historical_import_batches WHERE id=?')
      .bind(options.resumeBatchId).first<{ id: string; status: string; checkpoint_row_key: string | null }>()
    : await database
      .prepare(`SELECT id,status,checkpoint_row_key FROM historical_import_batches
        WHERE source_system=? AND source_files_sha256=? AND parser_version=? AND mapping_version=? AND mode=?`)
      .bind(
        input.sourceSystem,
        combinedSha,
        HISTORICAL_PARSER_VERSION,
        HISTORICAL_MAPPING_VERSION,
        options.mode === 'APPLY_LOCAL' ? 'APPLY_LOCAL' : 'DRY_RUN',
      ).first<{ id: string; status: string; checkpoint_row_key: string | null }>();
  if (existing && existing.status === 'COMPLETED' && !options.resumeBatchId) {
    const prior = await reconcileHistoricalImport(database, existing.id);
    return {
      report: prior.report,
      batch_id: existing.id,
      replayed: true,
      resumed_from: null,
      // Replays apply nothing new; durable rows are the evidence.
      applied_orders: 0,
    };
  }

  const batchId = existing?.id ?? `historical-import-${crypto.randomUUID()}`;
  const mode = options.mode === 'APPLY_LOCAL' ? 'APPLY_LOCAL' : 'DRY_RUN';
  if (!existing) {
    await database.batch([
      database.prepare(
        `INSERT INTO historical_import_batches(id,source_system,source_files_json,source_files_sha256,
       parser_version,mapping_version,mode,status,created_by_staff_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        batchId,
        input.sourceSystem,
        canonicalJson(files.map((file) => ({ name: file.name, sha256: file.sha256, bytes: file.bytes }))),
        combinedSha,
        HISTORICAL_PARSER_VERSION,
        HISTORICAL_MAPPING_VERSION,
        mode,
        'RUNNING',
        options.actorStaffId ?? null,
        now,
        now,
      ),
    ]);
  }
  const checkpoint = options.resumeBatchId ? existing?.checkpoint_row_key ?? null : null;
  // Resume from the recorded checkpoint: everything at or before it already
  // has durable rows and must not be written twice.
  const startIndex = checkpoint ? rawRows.findIndex((row) => row.rowKey === checkpoint) + 1 : 0;

  // Duplicate groups by source order id (exact-facts duplicates collapse;
  // conflicting duplicates quarantine and block apply).
  const byOrderId = new Map<string, HistoricalRawRow[]>();
  for (const row of rawRows) {
    const key = row.cells['订单号'] ?? '';
    if (key === '') continue;
    byOrderId.set(key, [...(byOrderId.get(key) ?? []), row]);
  }
  // Exact-facts groups are ONE logical order repeated (the data contract
  // allows duplicate source rows): only the first member may produce a
  // historical_orders row — a later member would be silently ignored by the
  // batch insert and its file rows would then dangle on a missing FK.
  const collapsedExactRowKeys = new Set<string>();
  for (const group of byOrderId.values()) {
    if (group.length < 2) continue;
    const signatures = new Set(group.map((member) => canonicalJson(member.cells)));
    if (signatures.size !== 1) continue;
    const sorted = [...group].sort((a, b) => a.rowKey.localeCompare(b.rowKey));
    for (const member of sorted.slice(1)) collapsedExactRowKeys.add(member.rowKey);
  }

  const today = new Date(now).toISOString().slice(0, 10);
  const outcomes: HistoricalRowOutcome[] = [];
  for (const row of rawRows) {
    const outcome = normalizeHistoricalRow(row);
    const group = byOrderId.get(row.cells['订单号'] ?? '') ?? [];
    if (group.length > 1) {
      const signatures = new Set(group.map((member) => canonicalJson(member.cells)));
      if (signatures.size === 1) {
        outcome.duplicateGroup = {
          key: row.cells['订单号'] ?? '',
          size: group.length,
          kind: 'EXACT_SOURCE_FACTS',
        };
      } else {
        // Non-identical rows under one order id split into two contracts:
        // differing line-defining facts (product/amount/fee/rate) make it a
        // MULTI-LINE order that only an explicit mapping may fold; any other
        // difference is a plain conflicting duplicate. Both HOLD the group
        // (critical) — first/last/sum are never guessed.
        const differingLineColumns = HISTORICAL_LINE_DEFINING_COLUMNS.filter(
          (column) => new Set(group.map((member) => member.cells[column] ?? '')).size > 1,
        );
        const multiLine = differingLineColumns.length > 0;
        outcome.duplicateGroup = {
          key: row.cells['订单号'] ?? '',
          size: group.length,
          kind: multiLine ? 'MULTI_LINE_ORDER' : 'CONFLICTING',
        };
        outcome.quarantines.push(multiLine
          ? {
            code: 'MULTI_LINE_ORDER_REQUIRES_MAPPING',
            detail: {
              order_number: row.cells['订单号'],
              group_size: group.length,
              differing_line_columns: differingLineColumns,
            },
          }
          : {
            code: 'CONFLICTING_DUPLICATE_GROUP',
            detail: { order_number: row.cells['订单号'], group_size: group.length },
          });
      }
    }
    outcome.files = outcome.order
      ? classifyHistoricalFiles(row, outcome.order, input.imageInventory, today)
      : [];
    outcomes.push(outcome);
  }

  // Identity resolution with overrides (dry-run reports; apply records rows
  // regardless of match state — unmatched identity is a quarantine fact, not
  // a silent merge). Every unmatched row now carries a DURABLE
  // IDENTITY_UNMATCHED quarantine row: the snapshot still imports losslessly,
  // but the record stays explicitly unresolved until a deterministic mapping
  // or an audited manual override promotes it. Collapsed exact-duplicate
  // members are represented by their group head and are never written, so
  // they must not emit quarantine rows.
  const identityStats = { matched: 0, unmatched: 0, conflicts: 0 };
  const sellerStats = { matched: 0, unmatched: 0, conflicts: 0 };
  for (const outcome of outcomes) {
    if (!outcome.order || outcome.quarantines.length > 0) continue;
    const identity = await resolveHistoricalIdentity(database, outcome.order);
    const unmatchedKinds: ('BUYER_CUSTOMER' | 'SELLER_ORGANIZATION')[] = [];
    if (identity.buyerOutcome === 'MATCHED') identityStats.matched += 1;
    else if (identity.buyerOutcome === 'CONFLICT') {
      identityStats.conflicts += 1;
      outcome.quarantines.push({ code: 'IDENTITY_CONFLICT', detail: { kind: 'BUYER_CUSTOMER', key: outcome.order.buyer_wechat_ref } });
    } else {
      identityStats.unmatched += 1;
      unmatchedKinds.push('BUYER_CUSTOMER');
    }
    if (identity.sellerOutcome === 'MATCHED') sellerStats.matched += 1;
    else if (identity.sellerOutcome === 'CONFLICT') {
      sellerStats.conflicts += 1;
      outcome.quarantines.push({ code: 'IDENTITY_CONFLICT', detail: { kind: 'SELLER_ORGANIZATION', key: outcome.order.store_name_ref } });
    } else {
      sellerStats.unmatched += 1;
      unmatchedKinds.push('SELLER_ORGANIZATION');
    }
    if (unmatchedKinds.length > 0 && !collapsedExactRowKeys.has(outcome.rowKey)) {
      outcome.quarantines.push({ code: 'IDENTITY_UNMATCHED', detail: { kinds: unmatchedKinds } });
    }
  }

  const valid = outcomes.filter((outcome) => outcome.quarantines.length === 0);
  const quarantined = outcomes.filter((outcome) => outcome.quarantines.length > 0);
  const filePlan = summarizeFiles(outcomes);
  // Currency totals follow the collapsed set of logical orders that
  // APPLY_LOCAL actually writes — quarantined-but-written snapshot rows
  // (e.g. IDENTITY_UNMATCHED) still contribute their source amounts, so the
  // dry-run report reconciles exactly with the durable rows.
  const currencyTotals = sumCurrencies(outcomes
    .filter((outcome) => outcome.order && !collapsedExactRowKeys.has(outcome.rowKey))
    .map((outcome) => outcome.order!));

  const cannotApplyReasons: string[] = [];
  const criticalQuarantines = quarantined.filter((outcome) =>
    outcome.quarantines.some((entry) => CRITICAL_QUARANTINE_CODES.has(entry.code)));
  if (criticalQuarantines.length > 0) {
    cannotApplyReasons.push(`critical_quarantine_rows:${criticalQuarantines.length}`);
  }
  if (valid.length + quarantined.length !== rawRows.length) {
    cannotApplyReasons.push('row_conservation_violation');
  }

  let appliedOrders = 0;
  if (options.mode === 'APPLY_LOCAL' && cannotApplyReasons.length === 0) {
    appliedOrders = await applyLocal(
      database,
      batchId,
      outcomes,
      startIndex,
      now,
      options.perOrderBatchStatements ?? 40,
      collapsedExactRowKeys,
    );
  }

  const lastRowKey = rawRows.length > 0 ? rawRows[rawRows.length - 1]!.rowKey : null;
  const finished = options.mode !== 'APPLY_LOCAL' || cannotApplyReasons.length === 0;
  await database.batch([
    database.prepare(
      `UPDATE historical_import_batches SET status=?,checkpoint_row_key=?,source_row_count=?,
     valid_row_count=?,quarantined_row_count=?,imported_row_count=?,error_code=?,updated_at=?,finished_at=?
     WHERE id=?`,
    ).bind(
      finished ? 'COMPLETED' : 'FAILED',
      options.mode === 'APPLY_LOCAL' ? lastRowKey : null,
      rawRows.length,
      valid.length,
      quarantined.length,
      appliedOrders,
      cannotApplyReasons.length > 0 ? cannotApplyReasons.join(';').slice(0, 80) : null,
      now,
      now,
      batchId,
    ),
  ]);

  const quarantineByCode: Record<string, number> = {};
  for (const outcome of quarantined) {
    for (const entry of outcome.quarantines) {
      quarantineByCode[entry.code] = (quarantineByCode[entry.code] ?? 0) + 1;
    }
  }
  const report: HistoricalDryRunReport = {
    status: 'LOCAL_DRY_RUN',
    batch_id: mode === 'APPLY_LOCAL' ? batchId : null,
    source_files: files,
    source_rows: rawRows.length,
    valid_rows: valid.length,
    quarantined_rows: quarantined.length,
    duplicate_rows: outcomes.filter((outcome) => outcome.duplicateGroup !== null).length,
    buyer_matches: identityStats,
    seller_matches: sellerStats,
    marketplace_mapping: {
      AMAZON_JP: outcomes.filter((outcome) =>
        outcome.order && outcome.order.platform_order_number_normalized !== null).length,
      unknown: quarantineByCode['UNKNOWN_MARKETPLACE'] ?? 0,
    },
    financial_conflicts: quarantineByCode['RATE_SPREAD_MISMATCH'] ?? 0,
    status_conflicts: 0,
    missing_fields: quarantineByCode['MISSING_REQUIRED_COLUMN'] ?? 0,
    file_plan: filePlan,
    projected_bundles: filePlan.cold_archive_eligible > 0
      ? new Set(
          outcomes.flatMap((outcome) =>
            outcome.files
              .filter((file) => file.classification === 'COLD_ARCHIVE_ELIGIBLE')
              .map(() => outcome.rowKey)))
        .size
      : 0,
    quarantine_by_code: quarantineByCode,
    currency_totals: currencyTotals,
    checkpoint_row_key: options.mode === 'APPLY_LOCAL' ? lastRowKey : null,
    can_apply: cannotApplyReasons.length === 0,
    cannot_apply_reasons: cannotApplyReasons,
  };
  return {
    report,
    batch_id: mode === 'APPLY_LOCAL' ? batchId : null,
    replayed: false,
    resumed_from: checkpoint,
    applied_orders: appliedOrders,
  };
}

function summarizeFiles(outcomes: readonly HistoricalRowOutcome[]): HistoricalDryRunReport['file_plan'] {
  const byPurpose: Record<string, number> = {};
  let planned = 0;
  let bytes = 0;
  let missing = 0;
  let corrupt = 0;
  let orphan = 0;
  let hot = 0;
  let cold = 0;
  let quarantine = 0;
  const orderKeys = new Set(outcomes.map((outcome) => outcome.order?.source_order_id ?? ''));
  for (const outcome of outcomes) {
    for (const file of outcome.files) {
      planned += 1;
      bytes += file.byte_size ?? 0;
      byPurpose[file.purpose] = (byPurpose[file.purpose] ?? 0) + 1;
      if (file.classification === 'MISSING') missing += 1;
      else if (file.classification === 'CORRUPT') corrupt += 1;
      else if (file.classification === 'ORPHAN') orphan += 1;
      else if (file.classification === 'HOT_R2') hot += 1;
      else if (file.classification === 'COLD_ARCHIVE_ELIGIBLE') cold += 1;
      else if (file.classification === 'QUARANTINE') quarantine += 1;
      // A referenced image without a resolvable order context is an orphan.
      if (!outcome.order && file.classification !== 'ORPHAN') orphan += 1;
    }
  }
  void orderKeys;
  return {
    planned, bytes, by_purpose: byPurpose,
    missing, corrupt, orphan,
    hot_r2: hot, cold_archive_eligible: cold, quarantine,
  };
}

function sumCurrencies(orders: readonly HistoricalRowOutcome['order'][]): HistoricalDryRunReport['currency_totals'] {
  let jpy = 0;
  let refund: number | null = null;
  let principal: number | null = null;
  let fee: number | null = null;
  for (const order of orders) {
    if (!order) continue;
    if (order.order_amount_source_minor !== null) jpy += order.order_amount_source_minor;
    if (order.buyer_refund_amount_source_minor !== null) {
      refund = (refund ?? 0) + order.buyer_refund_amount_source_minor;
    }
    if (order.seller_principal_amount_source_minor !== null) {
      principal = (principal ?? 0) + order.seller_principal_amount_source_minor;
    }
    if (order.service_fee_source_minor !== null) {
      fee = (fee ?? 0) + order.service_fee_source_minor;
    }
  }
  return {
    order_amount_jpy_minor: jpy,
    buyer_refund_cny_minor: refund,
    seller_principal_cny_minor: principal,
    service_fee_cny_minor: fee,
  };
}

async function applyLocal(
  database: SqlDatabase,
  batchId: string,
  outcomes: readonly HistoricalRowOutcome[],
  startIndex: number,
  now: number,
  perOrderBatchStatements: number,
  collapsedExactRowKeys: ReadonlySet<string>,
): Promise<number> {
  let applied = 0;
  for (let index = startIndex; index < outcomes.length; index += 1) {
    const outcome = outcomes[index]!;
    if (collapsedExactRowKeys.has(outcome.rowKey)) continue;
    const already = await database
      .prepare('SELECT 1 AS found FROM historical_orders WHERE import_batch_id=? AND source_row_key=?')
      .bind(batchId, outcome.rowKey).first<{ found: number }>();
    if (already) continue;
    const statements: SqlStatement[] = [];
    if (outcome.order) {
      const rowSha = await sha256Hex(canonicalJson(outcome.order));
      const historicalOrderId = `historical-order-${crypto.randomUUID()}`;
      // 33 columns, 33 placeholders — aligned one-to-one below.
      statements.push(database.prepare(
        `INSERT OR IGNORE INTO historical_orders(id,import_batch_id,source_system,source_row_key,
       source_order_id,marketplace_code,ordered_on,status_snapshot_raw,buyer_customer_no_ref,
       buyer_wechat_ref,store_name_ref,platform_product_identifier,order_amount_source_minor,
       order_amount_currency,platform_order_number_raw,platform_order_number_normalized,
       review_submitted_on,review_approved_on,review_status_raw,review_url_raw,buyer_rate_source_e8,
       refunded_on,seller_rate_source_e8,replenishment_submitted_on,service_fee_source_minor,
       settled_on,buyer_refund_amount_source_minor,seller_principal_amount_source_minor,
       rate_spread_source_e8,profit_source_minor,order_detail_note,row_sha256,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        historicalOrderId,
        batchId,
        'HISTORICAL_ORDER_CSV',
        outcome.order.source_row_key,
        outcome.order.source_order_id,
        outcome.order.marketplace_code,
        outcome.order.ordered_on === '' ? null : outcome.order.ordered_on,
        outcome.order.status_snapshot_raw,
        outcome.order.buyer_customer_no_ref,
        outcome.order.buyer_wechat_ref,
        outcome.order.store_name_ref,
        outcome.order.platform_product_identifier,
        outcome.order.order_amount_source_minor,
        'JPY',
        outcome.order.platform_order_number_raw,
        outcome.order.platform_order_number_normalized,
        outcome.order.review_submitted_on,
        outcome.order.review_approved_on,
        outcome.order.review_status_raw,
        outcome.order.review_url_raw,
        outcome.order.buyer_rate_source_e8,
        outcome.order.refunded_on,
        outcome.order.seller_rate_source_e8,
        outcome.order.replenishment_submitted_on,
        outcome.order.service_fee_source_minor,
        outcome.order.settled_on,
        outcome.order.buyer_refund_amount_source_minor,
        outcome.order.seller_principal_amount_source_minor,
        outcome.order.rate_spread_source_e8,
        outcome.order.profit_source_minor,
        outcome.order.order_detail_note,
        rowSha,
        now,
      ));
      for (const file of outcome.files) {
        const dedupKey = file.content_sha256 ?? null;
        statements.push(database.prepare(
          `INSERT OR IGNORE INTO historical_order_files(id,import_batch_id,historical_order_id,
         source_row_key,purpose,audience,source_column,source_ref,source_ref_sha256,content_sha256,
         mime_type,byte_size,classification,classification_reason,physical_dedup_key,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          `historical-file-${crypto.randomUUID()}`,
          batchId,
          historicalOrderId,
          outcome.rowKey,
          file.purpose,
          file.audience,
          file.source_column,
          file.source_ref,
          file.source_ref ? await sha256Hex(file.source_ref) : null,
          file.content_sha256,
          file.mime_type,
          file.byte_size,
          file.classification,
          file.classification_reason,
          dedupKey,
          now,
        ));
      }
    }
    for (const entry of outcome.quarantines) {
      statements.push(database.prepare(
        `INSERT OR IGNORE INTO historical_import_quarantine(id,import_batch_id,source_row_key,
       source_order_id,exception_code,detail_json,created_at)
       VALUES(?,?,?,?,?,?,?)`,
      ).bind(
        `historical-quarantine-${crypto.randomUUID()}`,
        batchId,
        outcome.rowKey,
        outcome.order?.source_order_id ?? null,
        entry.code,
        canonicalJson(entry.detail),
        now,
      ));
    }
    // Per-order transaction boundary: every order commits independently so
    // an interrupted apply resumes at the last durable order.
    for (let offset = 0; offset < statements.length; offset += perOrderBatchStatements) {
      await database.batch(statements.slice(offset, offset + perOrderBatchStatements));
    }
    applied += 1;
  }
  return applied;
}

export interface HistoricalReconciliation {
  import_batch_id: string;
  imported_orders: number;
  quarantine_rows: number;
  file_rows: number;
  currency_totals: HistoricalDryRunReport['currency_totals'];
  classification_counts: Record<string, number>;
  missing_amounts: number;
  conflict_amounts: number;
  unmatched_financial_rows: number;
  report: HistoricalDryRunReport;
}

export async function reconcileHistoricalImport(
  database: SqlDatabase,
  batchId: string,
): Promise<HistoricalReconciliation> {
  const batch = await database
    .prepare('SELECT source_row_count,valid_row_count,quarantined_row_count,imported_row_count FROM historical_import_batches WHERE id=?')
    .bind(batchId).first<{ source_row_count: number; valid_row_count: number; quararantined_row_count?: number; quarantined_row_count: number; imported_row_count: number }>();
  if (!batch) throw new Error('BATCH_NOT_FOUND');
  const totals = await database
    .prepare(`SELECT COALESCE(SUM(order_amount_source_minor),0) AS jpy,
     SUM(buyer_refund_amount_source_minor) AS refund,
     SUM(seller_principal_amount_source_minor) AS principal,
     SUM(service_fee_source_minor) AS fee,
     SUM(CASE WHEN buyer_refund_amount_source_minor IS NULL
       AND seller_principal_amount_source_minor IS NULL THEN 1 ELSE 0 END) AS missing_amounts
     FROM historical_orders WHERE import_batch_id=?`)
    .bind(batchId)
    .first<{ jpy: number; refund: number | null; principal: number | null; fee: number | null; missing_amounts: number }>();
  const classifications = await database
    .prepare(`SELECT classification,COUNT(*) AS count FROM historical_order_files
     WHERE import_batch_id=? GROUP BY classification ORDER BY classification`)
    .bind(batchId).all<{ classification: string; count: number }>();
  const quarantineCounts = await database
    .prepare(`SELECT exception_code,COUNT(*) AS count FROM historical_import_quarantine
     WHERE import_batch_id=? GROUP BY exception_code ORDER BY exception_code`)
    .bind(batchId).all<{ exception_code: string; count: number }>();
  const fileCount = await database
    .prepare('SELECT COUNT(*) AS count FROM historical_order_files WHERE import_batch_id=?')
    .bind(batchId).first<{ count: number }>();
  const classificationCounts: Record<string, number> = {};
  for (const row of classifications.results) classificationCounts[row.classification] = row.count;
  const quarantineByCode: Record<string, number> = {};
  for (const row of quarantineCounts.results) quarantineByCode[row.exception_code] = row.count;
  return {
    import_batch_id: batchId,
    imported_orders: batch.imported_row_count,
    quarantine_rows: batch.quarantined_row_count,
    file_rows: Number(fileCount?.count ?? 0),
    currency_totals: {
      order_amount_jpy_minor: Number(totals?.jpy ?? 0),
      buyer_refund_cny_minor: totals?.refund ?? null,
      seller_principal_cny_minor: totals?.principal ?? null,
      service_fee_cny_minor: totals?.fee ?? null,
    },
    classification_counts: classificationCounts,
    missing_amounts: Number(totals?.missing_amounts ?? 0),
    conflict_amounts: quarantineByCode['RATE_SPREAD_MISMATCH'] ?? 0,
    unmatched_financial_rows: quarantineByCode['MISSING_FINANCIAL_FIELDS'] ?? 0,
    report: {
      status: 'LOCAL_DRY_RUN',
      batch_id: batchId,
      source_files: [],
      source_rows: batch.source_row_count,
      valid_rows: batch.valid_row_count,
      quarantined_rows: batch.quarantined_row_count,
      duplicate_rows: 0,
      buyer_matches: { matched: 0, unmatched: 0, conflicts: 0 },
      seller_matches: { matched: 0, unmatched: 0, conflicts: 0 },
      marketplace_mapping: { AMAZON_JP: batch.valid_row_count, unknown: quarantineByCode['UNKNOWN_MARKETPLACE'] ?? 0 },
      financial_conflicts: quarantineByCode['RATE_SPREAD_MISMATCH'] ?? 0,
      status_conflicts: 0,
      missing_fields: quarantineByCode['MISSING_REQUIRED_COLUMN'] ?? 0,
      file_plan: {
        planned: Number(fileCount?.count ?? 0),
        bytes: 0,
        by_purpose: {},
        missing: classificationCounts['MISSING'] ?? 0,
        corrupt: classificationCounts['CORRUPT'] ?? 0,
        orphan: classificationCounts['ORPHAN'] ?? 0,
        hot_r2: classificationCounts['HOT_R2'] ?? 0,
        cold_archive_eligible: classificationCounts['COLD_ARCHIVE_ELIGIBLE'] ?? 0,
        quarantine: classificationCounts['QUARANTINE'] ?? 0,
      },
      projected_bundles: 0,
      quarantine_by_code: quarantineByCode,
      currency_totals: {
        order_amount_jpy_minor: Number(totals?.jpy ?? 0),
        buyer_refund_cny_minor: totals?.refund ?? null,
        seller_principal_cny_minor: totals?.principal ?? null,
        service_fee_cny_minor: totals?.fee ?? null,
      },
      checkpoint_row_key: null,
      can_apply: batch.quarantined_row_count === 0,
      cannot_apply_reasons: [],
    },
  };
}
