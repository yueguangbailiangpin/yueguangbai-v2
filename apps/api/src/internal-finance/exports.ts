import type {
  FinanceGroupBy,
  FinancialExportType,
  InternalFinanceExceptionDto,
  InternalFinanceFilters,
  InternalFinanceGroupDto,
  InternalOrderFinancePositionDto,
  SqlDatabase,
} from '@ygb/contracts';
import {
  canonicalJson,
  FINANCIAL_CSV_MAX_ROWS,
  FinancialCsvError,
  hashCanonicalJson,
  serializeFinancialCsv,
  sha256Hex,
  type FinancialCsvColumn,
} from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { createAuditEventStatement } from '../foundation/audit';
import { createOutboxStatements, prepareOutboxEvent } from '../foundation/outbox';
import { assertFinancialExportDateBasis } from './filters';
import {
  iterateFinanceExceptions,
  iterateFinancePositions,
  readFinanceCashFlow,
  readFinanceGroups,
} from './read-model';
import { InternalFinanceError } from './shared';

export interface GeneratedFinancialCsv {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  exportId: string;
  rowCount: number;
  outputSha256: string;
}

interface FinancialExportRows {
  rows: readonly Record<string, string | number | null>[];
  columns: readonly FinancialCsvColumn<
    Record<string, string | number | null>
  >[];
}

export async function generateAuditedFinancialCsv(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  input: {
    exportType: FinancialExportType;
    filters: InternalFinanceFilters;
    requestId: string;
    now?: number;
  },
): Promise<GeneratedFinancialCsv> {
  const now = input.now ?? Date.now();
  const data = await buildFinancialExportRows(
    database,
    input.exportType,
    input.filters,
    now,
  );
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = serializeFinancialCsv(data.rows, data.columns);
  } catch (error) {
    if (error instanceof FinancialCsvError && error.code === 'EXPORT_TOO_LARGE') {
      throw new InternalFinanceError('EXPORT_TOO_LARGE', 413);
    }
    throw error;
  }
  const outputSha256 = await sha256Hex(bytes);
  const filterJson = canonicalJson(input.filters);
  const filterHash = await hashCanonicalJson(input.filters);
  const exportId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const outbox = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: `financial-export:${exportId}`,
    eventType: 'FINANCIAL_EXPORT_GENERATED',
    aggregateType: 'FINANCIAL_EXPORT',
    aggregateId: exportId,
    payload: {
      export_id: exportId,
      export_type: input.exportType,
      staff_id: actor.staffId,
      filter_hash: filterHash,
      row_count: data.rows.length,
      output_sha256: outputSha256,
      generated_at: now,
    },
    createdAt: now,
  });

  const statements = [
    database.prepare(`
      INSERT INTO financial_export_events (
        id, export_type, requested_by_staff_id, filter_json, filter_hash,
        data_as_of, row_count, output_byte_length, output_sha256,
        request_id, generated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      exportId,
      input.exportType,
      actor.staffId,
      filterJson,
      filterHash,
      now,
      data.rows.length,
      bytes.byteLength,
      outputSha256,
      input.requestId,
      now,
      now,
    ),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM financial_export_events
        WHERE id=? AND output_sha256=? AND row_count=?
      ) THEN 1 ELSE 0 END
    `).bind(exportId, outputSha256, data.rows.length),
    createAuditEventStatement(database, {
      id: auditId,
      aggregateType: 'FINANCIAL_EXPORT',
      aggregateId: exportId,
      eventType: 'FINANCIAL_EXPORT_GENERATED',
      actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
      requestId: input.requestId,
      nextState: {
        export_type: input.exportType,
        filter_hash: filterHash,
        data_as_of: now,
        row_count: data.rows.length,
        output_byte_length: bytes.byteLength,
        output_sha256: outputSha256,
        generated_at: now,
      },
      metadata: { synchronous_csv: true, persisted_csv: false },
      createdAt: now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM audit_events WHERE id=?
      ) THEN 1 ELSE 0 END
    `).bind(auditId),
    ...createOutboxStatements(database, outbox),
  ];
  try {
    await database.batch(statements);
  } catch {
    throw new InternalFinanceError('DEPENDENCY_UNAVAILABLE', 503);
  }

  return Object.freeze({
    bytes,
    filename: safeFilename(input.exportType, input.filters.to_date),
    exportId,
    rowCount: data.rows.length,
    outputSha256,
  });
}

export async function buildFinancialExportRows(
  database: SqlDatabase,
  exportType: FinancialExportType,
  filters: InternalFinanceFilters,
  now: number,
): Promise<FinancialExportRows> {
  assertFinancialExportDateBasis(exportType, filters.date_basis);
  if (exportType === 'ORDER_DETAIL') {
    return {
      rows: await collectBounded(
        iterateFinancePositions(database, filters),
        orderRecord,
      ),
      columns: orderColumns(),
    };
  }
  if (exportType === 'CASH_FLOW') {
    assertCashFlowFilters(filters);
    const cash = await readFinanceCashFlow(database, filters, now);
    return { rows: [{ ...cash }], columns: cashColumns() };
  }
  if (exportType === 'FINANCIAL_EXCEPTIONS') {
    return {
      rows: await collectBounded(
        iterateFinanceExceptions(database, filters),
        exceptionRecord,
      ),
      columns: exceptionColumns(),
    };
  }
  const groupBy = exportGroup(exportType);
  const groups = await readFinanceGroups(
    database,
    filters,
    groupBy,
    { maxGroups: FINANCIAL_CSV_MAX_ROWS },
  );
  return { rows: groups.map(groupRecord), columns: groupColumns() };
}

async function collectBounded<Input>(
  source: AsyncIterable<Input>,
  map: (value: Input) => Record<string, string | number | null>,
): Promise<readonly Record<string, string | number | null>[]> {
  const rows: Record<string, string | number | null>[] = [];
  for await (const value of source) {
    if (rows.length >= FINANCIAL_CSV_MAX_ROWS) {
      throw new InternalFinanceError('EXPORT_TOO_LARGE', 413);
    }
    rows.push(map(value));
  }
  return Object.freeze(rows);
}

function assertCashFlowFilters(filters: InternalFinanceFilters): void {
  if (filters.date_basis !== 'CASH'
    || filters.store_id !== null
    || filters.product_id !== null
    || filters.asin !== null
    || filters.formal_order_id !== null
    || filters.amazon_order_number !== null
    || filters.review_type !== null
    || filters.finance_status !== null) {
    throw new InternalFinanceError('VALIDATION_ERROR', 400);
  }
}

function exportGroup(type: FinancialExportType): FinanceGroupBy {
  if (type === 'SELLER_SUMMARY') return 'SELLER_ORGANIZATION';
  if (type === 'STORE_SUMMARY') return 'STORE';
  if (type === 'PRODUCT_SUMMARY') return 'PRODUCT';
  if (type === 'ASIN_SUMMARY') return 'ASIN';
  if (type === 'MONTHLY_SUMMARY') return 'MONTH';
  throw new InternalFinanceError('VALIDATION_ERROR', 400);
}

function orderRecord(
  row: InternalOrderFinancePositionDto,
): Record<string, string | number | null> {
  return { ...row };
}

function groupRecord(
  row: InternalFinanceGroupDto,
): Record<string, string | number | null> {
  return { ...row };
}

function exceptionRecord(
  row: InternalFinanceExceptionDto,
): Record<string, string | number | null> {
  return {
    formal_order_id: row.formal_order_id,
    seller_organization_id: row.seller_organization_id,
    store_id: row.store_id,
    finance_status: row.finance_status,
    exception_codes: row.exception_codes.join('|'),
    suggested_actions: row.suggested_actions.join('|'),
    detected_facts_summary: canonicalJson(row.detected_facts_summary),
  };
}

const value = (key: string) => (
  row: Record<string, string | number | null>,
) => row[key] ?? null;
const text = (
  key: string,
): FinancialCsvColumn<Record<string, string | number | null>> => ({
  header: key,
  value: value(key),
  kind: 'TEXT',
});
const integer = (
  key: string,
): FinancialCsvColumn<Record<string, string | number | null>> => ({
  header: key,
  value: value(key),
  kind: 'INTEGER',
});
const fen = (
  key: string,
): FinancialCsvColumn<Record<string, string | number | null>> => ({
  header: key,
  value: value(key),
  kind: 'FEN',
});

function orderColumns() {
  return [
    text('formal_order_id'), text('amazon_order_number'),
    text('seller_organization_id'), text('store_id'), text('product_id'),
    text('asin'), text('product_name'), text('review_type'),
    integer('confirmed_at'), text('confirmed_business_date'),
    integer('review_approved_at'), text('review_approved_business_date'),
    text('last_cash_business_date'), integer('final_paid_jpy'),
    text('financial_snapshot_id'), integer('buyer_self_pay_bps'),
    integer('buyer_self_pay_jpy'), fen('buyer_expected_principal_cny_fen'),
    fen('seller_expected_principal_cny_fen'),
    fen('service_fee_snapshot_cny_fen'),
    fen('projected_gross_profit_cny_fen'),
    fen('completed_gross_profit_cny_fen'),
    fen('seller_principal_due_cny_fen'),
    fen('seller_principal_collected_cny_fen'),
    fen('seller_principal_outstanding_cny_fen'),
    fen('seller_service_fee_due_cny_fen'),
    fen('seller_service_fee_collected_cny_fen'),
    fen('seller_service_fee_outstanding_cny_fen'),
    fen('buyer_refund_due_cny_fen'), fen('buyer_refund_net_paid_cny_fen'),
    fen('buyer_refund_outstanding_cny_fen'),
    fen('buyer_refund_overpaid_cny_fen'),
    fen('attributed_cash_net_cny_fen'), text('finance_status'),
  ] as const;
}

function groupColumns() {
  return [
    text('group_by'), text('group_key'), text('group_label'),
    integer('order_count'), integer('projected_order_count'),
    integer('completed_order_count'), integer('conflict_order_count'),
    fen('projected_gross_profit_cny_fen'),
    fen('completed_gross_profit_cny_fen'),
    fen('attributed_cash_net_cny_fen'),
    fen('seller_principal_due_cny_fen'),
    fen('seller_principal_collected_cny_fen'),
    fen('seller_principal_outstanding_cny_fen'),
    fen('seller_service_fee_due_cny_fen'),
    fen('seller_service_fee_collected_cny_fen'),
    fen('seller_service_fee_outstanding_cny_fen'),
    fen('buyer_refund_due_cny_fen'), fen('buyer_refund_net_paid_cny_fen'),
    fen('buyer_refund_outstanding_cny_fen'),
    fen('buyer_refund_overpaid_cny_fen'),
    fen('seller_unallocated_credit_cny_fen'),
  ] as const;
}

function cashColumns() {
  return [
    fen('seller_cash_inflow_cny_fen'),
    fen('seller_payment_reversal_cny_fen'),
    fen('buyer_refund_outflow_cny_fen'),
    fen('buyer_refund_reversal_cny_fen'),
    fen('net_cash_flow_cny_fen'), text('from_date'), text('to_date'),
    integer('data_as_of'),
  ] as const;
}

function exceptionColumns() {
  return [
    text('formal_order_id'), text('seller_organization_id'), text('store_id'),
    text('finance_status'), text('exception_codes'), text('suggested_actions'),
    text('detected_facts_summary'),
  ] as const;
}

function safeFilename(type: FinancialExportType, toDate: string): string {
  return `financial-${type.toLowerCase().replaceAll('_', '-')}-${toDate}.csv`;
}
