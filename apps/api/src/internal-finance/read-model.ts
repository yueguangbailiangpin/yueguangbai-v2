import type {
  FinanceGroupBy,
  FinanceStatus,
  InternalFinanceCashFlowDto,
  InternalFinanceExceptionDto,
  InternalFinanceFilters,
  InternalFinanceGroupDto,
  InternalFinanceOrderPageDto,
  InternalFinanceSummaryDto,
  InternalOrderFinancePositionDto,
  PricingReviewType,
  SqlDatabase,
} from '@ygb/contracts';
import {
  databaseIntegerToBigInt,
  signedIntegerString,
  sumFinancePositions,
} from '@ygb/domain';
import {
  decodeSellerPortalCursor,
  encodeSellerPortalCursor,
  isRecord,
} from '../seller-portal/pagination';
import { financeDateColumn } from './filters';
import { InternalFinanceError, validation } from './shared';

interface PositionRow {
  formal_order_id: string; amazon_order_number: string;
  seller_organization_id: string; store_id: string; product_id: string;
  asin: string; product_name: string; review_type: string;
  confirmed_at: number; confirmed_business_date: string;
  review_approved_at: number | null; review_approved_business_date: string | null;
  last_cash_business_date: string | null; final_paid_jpy: number | string;
  financial_snapshot_id: string | null; buyer_self_pay_bps: number | null;
  buyer_self_pay_jpy: number | string | null;
  buyer_expected_principal_cny_fen: number | string | null;
  seller_expected_principal_cny_fen: number | string | null;
  service_fee_snapshot_cny_fen: number | string | null;
  projected_gross_profit_cny_fen: number | string | null;
  completed_gross_profit_cny_fen: number | string | null;
  seller_principal_due_cny_fen: number | string;
  seller_principal_collected_cny_fen: number | string;
  seller_principal_outstanding_cny_fen: number | string;
  seller_service_fee_due_cny_fen: number | string;
  seller_service_fee_collected_cny_fen: number | string;
  seller_service_fee_outstanding_cny_fen: number | string;
  buyer_refund_due_cny_fen: number | string;
  buyer_refund_net_paid_cny_fen: number | string;
  buyer_refund_outstanding_cny_fen: number | string;
  buyer_refund_overpaid_cny_fen: number | string;
  attributed_cash_net_cny_fen: number | string;
  finance_status: string;
}
interface Cursor { confirmed_at: number; formal_order_id: string }
interface CashRow { movement_type: string; amount_cny_fen: number | string }

export async function readFinanceSummary(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
  dataAsOf = Date.now(),
): Promise<InternalFinanceSummaryDto> {
  const positions = await readAllFinancePositions(database, filters);
  const totals = sumFinancePositions(positions);
  return Object.freeze({
    ...totals,
    seller_unallocated_credit_cny_fen: await readUnallocatedCredit(database, filters),
    data_as_of: dataAsOf,
    filters,
  });
}

export async function readFinanceOrderPage(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
  input: { limit: number; cursor: string | null },
  dataAsOf = Date.now(),
): Promise<InternalFinanceOrderPageDto> {
  const cursor = decodeCursor(input.cursor);
  const where = positionWhere(filters, cursor);
  const result = await database.prepare(`
    SELECT position.*
    FROM internal_order_finance_positions position
    WHERE ${where.sql}
    ORDER BY position.confirmed_at DESC, position.formal_order_id DESC
    LIMIT ?
  `).bind(...where.values, input.limit + 1).all<PositionRow>();
  const visible = result.results.slice(0, input.limit).map(mapPosition);
  const last = result.results.slice(0, input.limit).at(-1);
  return Object.freeze({
    items: Object.freeze(visible),
    page: Object.freeze({
      limit: input.limit,
      next_cursor: result.results.length > input.limit && last
        ? encodeSellerPortalCursor({
            confirmed_at: Number(last.confirmed_at),
            formal_order_id: last.formal_order_id,
          })
        : null,
    }),
    filters,
    data_as_of: dataAsOf,
  });
}

export async function readFinanceOrder(
  database: SqlDatabase,
  formalOrderId: string,
): Promise<InternalOrderFinancePositionDto> {
  const row = await database.prepare(`
    SELECT * FROM internal_order_finance_positions
    WHERE formal_order_id=? LIMIT 1
  `).bind(formalOrderId).first<PositionRow>();
  if (!row) throw new InternalFinanceError('NOT_FOUND', 404);
  return mapPosition(row);
}

export async function readAllFinancePositions(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
): Promise<readonly InternalOrderFinancePositionDto[]> {
  const where = positionWhere(filters, null);
  const result = await database.prepare(`
    SELECT position.*
    FROM internal_order_finance_positions position
    WHERE ${where.sql}
    ORDER BY position.confirmed_at, position.formal_order_id
  `).bind(...where.values).all<PositionRow>();
  return Object.freeze(result.results.map(mapPosition));
}

export async function readFinanceGroups(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
  groupBy: FinanceGroupBy,
): Promise<readonly InternalFinanceGroupDto[]> {
  const positions = await readAllFinancePositions(database, filters);
  const grouped = new Map<string, InternalOrderFinancePositionDto[]>();
  for (const row of positions) {
    const key = groupKey(row, groupBy, filters.date_basis);
    if (key === null) continue;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  const output: InternalFinanceGroupDto[] = [];
  for (const [key, rows] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const totals = sumFinancePositions(rows);
    output.push(Object.freeze({
      group_by: groupBy,
      group_key: key,
      group_label: groupLabel(rows[0]!, groupBy, key),
      ...totals,
      seller_unallocated_credit_cny_fen: groupBy === 'SELLER_ORGANIZATION'
        ? await readOrganizationUnallocatedCredit(database, key)
        : null,
    }));
  }
  return Object.freeze(output);
}

export async function readFinanceCashFlow(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
  dataAsOf = Date.now(),
): Promise<InternalFinanceCashFlowDto> {
  const values: unknown[] = [filters.from_date, filters.to_date];
  let organization = '';
  if (filters.seller_organization_id !== null) {
    organization = 'AND movement.seller_organization_id=?';
    values.push(filters.seller_organization_id);
  }
  const rows = await database.prepare(`
    SELECT movement_type, amount_cny_fen
    FROM internal_finance_cash_movements movement
    WHERE movement.cash_business_date BETWEEN ? AND ? ${organization}
    ORDER BY movement.occurred_at, movement.movement_id
  `).bind(...values).all<CashRow>();
  let sellerIn = 0n;
  let sellerReversal = 0n;
  let buyerOut = 0n;
  let buyerReversal = 0n;
  for (const row of rows.results) {
    const amount = databaseIntegerToBigInt(row.amount_cny_fen);
    if (row.movement_type === 'SELLER_PAYMENT') sellerIn += amount;
    else if (row.movement_type === 'SELLER_PAYMENT_REVERSAL') sellerReversal += amount;
    else if (row.movement_type === 'BUYER_REFUND_PAYMENT') buyerOut += amount;
    else if (row.movement_type === 'BUYER_REFUND_REVERSAL') buyerReversal += amount;
  }
  return Object.freeze({
    seller_cash_inflow_cny_fen: signedIntegerString(sellerIn),
    seller_payment_reversal_cny_fen: signedIntegerString(sellerReversal),
    buyer_refund_outflow_cny_fen: signedIntegerString(buyerOut),
    buyer_refund_reversal_cny_fen: signedIntegerString(buyerReversal),
    net_cash_flow_cny_fen: signedIntegerString(
      sellerIn - sellerReversal - buyerOut + buyerReversal,
    ),
    from_date: filters.from_date,
    to_date: filters.to_date,
    data_as_of: dataAsOf,
  });
}

export async function readFinanceExceptions(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
): Promise<readonly InternalFinanceExceptionDto[]> {
  const rows = await readAllFinancePositions(database, filters);
  return Object.freeze(rows.filter(
    (row) => row.finance_status !== 'PROJECTED_ONLY'
      && row.finance_status !== 'COMPLETED',
  ).map((row) => Object.freeze({
    formal_order_id: row.formal_order_id,
    seller_organization_id: row.seller_organization_id,
    store_id: row.store_id,
    finance_status: row.finance_status,
    exception_codes: Object.freeze([row.finance_status]),
    detected_facts_summary: Object.freeze({
      financial_snapshot_id: row.financial_snapshot_id,
      projected_gross_profit_cny_fen: row.projected_gross_profit_cny_fen,
      seller_principal_due_cny_fen: row.seller_principal_due_cny_fen,
      seller_service_fee_due_cny_fen: row.seller_service_fee_due_cny_fen,
      buyer_refund_due_cny_fen: row.buyer_refund_due_cny_fen,
    }),
    suggested_actions: Object.freeze([suggestedAction(row.finance_status)]),
  })));
}

function positionWhere(filters: InternalFinanceFilters, cursor: Cursor | null) {
  const clauses = [`${financeDateColumn(filters.date_basis)} BETWEEN ? AND ?`];
  const values: unknown[] = [filters.from_date, filters.to_date];
  const entries: readonly [keyof InternalFinanceFilters, string][] = [
    ['seller_organization_id', 'position.seller_organization_id'],
    ['store_id', 'position.store_id'],
    ['product_id', 'position.product_id'],
    ['asin', 'position.asin'],
    ['formal_order_id', 'position.formal_order_id'],
    ['amazon_order_number', 'position.amazon_order_number'],
    ['review_type', 'position.review_type'],
    ['finance_status', 'position.finance_status'],
  ];
  for (const [key, column] of entries) {
    const value = filters[key];
    if (value !== null) { clauses.push(`${column}=?`); values.push(value); }
  }
  if (cursor !== null) {
    clauses.push('(position.confirmed_at<? OR (position.confirmed_at=? AND position.formal_order_id<?))');
    values.push(cursor.confirmed_at, cursor.confirmed_at, cursor.formal_order_id);
  }
  return { sql: clauses.join(' AND '), values };
}

function mapPosition(row: PositionRow): InternalOrderFinancePositionDto {
  return Object.freeze({
    formal_order_id: row.formal_order_id,
    amazon_order_number: row.amazon_order_number,
    seller_organization_id: row.seller_organization_id,
    store_id: row.store_id,
    product_id: row.product_id,
    asin: row.asin,
    product_name: row.product_name,
    review_type: row.review_type as PricingReviewType,
    confirmed_at: Number(row.confirmed_at),
    confirmed_business_date: row.confirmed_business_date,
    review_approved_at: row.review_approved_at === null ? null : Number(row.review_approved_at),
    review_approved_business_date: row.review_approved_business_date,
    last_cash_business_date: row.last_cash_business_date,
    final_paid_jpy: integer(row.final_paid_jpy),
    financial_snapshot_id: row.financial_snapshot_id,
    buyer_self_pay_bps: row.buyer_self_pay_bps === null ? null : Number(row.buyer_self_pay_bps),
    buyer_self_pay_jpy: nullableInteger(row.buyer_self_pay_jpy),
    buyer_expected_principal_cny_fen: nullableInteger(row.buyer_expected_principal_cny_fen),
    seller_expected_principal_cny_fen: nullableInteger(row.seller_expected_principal_cny_fen),
    service_fee_snapshot_cny_fen: nullableInteger(row.service_fee_snapshot_cny_fen),
    projected_gross_profit_cny_fen: nullableInteger(row.projected_gross_profit_cny_fen),
    completed_gross_profit_cny_fen: nullableInteger(row.completed_gross_profit_cny_fen),
    seller_principal_due_cny_fen: integer(row.seller_principal_due_cny_fen),
    seller_principal_collected_cny_fen: integer(row.seller_principal_collected_cny_fen),
    seller_principal_outstanding_cny_fen: integer(row.seller_principal_outstanding_cny_fen),
    seller_service_fee_due_cny_fen: integer(row.seller_service_fee_due_cny_fen),
    seller_service_fee_collected_cny_fen: integer(row.seller_service_fee_collected_cny_fen),
    seller_service_fee_outstanding_cny_fen: integer(row.seller_service_fee_outstanding_cny_fen),
    buyer_refund_due_cny_fen: integer(row.buyer_refund_due_cny_fen),
    buyer_refund_net_paid_cny_fen: integer(row.buyer_refund_net_paid_cny_fen),
    buyer_refund_outstanding_cny_fen: integer(row.buyer_refund_outstanding_cny_fen),
    buyer_refund_overpaid_cny_fen: integer(row.buyer_refund_overpaid_cny_fen),
    attributed_cash_net_cny_fen: integer(row.attributed_cash_net_cny_fen),
    finance_status: row.finance_status as FinanceStatus,
  });
}

async function readUnallocatedCredit(database: SqlDatabase, filters: InternalFinanceFilters) {
  if (filters.store_id !== null || filters.product_id !== null || filters.asin !== null
    || filters.formal_order_id !== null || filters.amazon_order_number !== null
    || filters.review_type !== null || filters.finance_status !== null) return '0';
  if (filters.seller_organization_id !== null) {
    return readOrganizationUnallocatedCredit(database, filters.seller_organization_id);
  }
  const result = await database.prepare(`
    SELECT CAST(unallocated_credit_cny_fen AS TEXT) AS value
    FROM seller_organization_settlement_balances
    ORDER BY seller_organization_id
  `).all<{ value: string | number }>();
  let total = 0n;
  for (const row of result.results) {
    total += databaseIntegerToBigInt(row.value);
  }
  return signedIntegerString(total);
}
async function readOrganizationUnallocatedCredit(database: SqlDatabase, id: string) {
  const row = await database.prepare(`
    SELECT CAST(unallocated_credit_cny_fen AS TEXT) AS value
    FROM seller_organization_settlement_balances
    WHERE seller_organization_id=?
  `).bind(id).first<{ value: string | number }>();
  return integer(row?.value ?? 0);
}
function groupKey(row: InternalOrderFinancePositionDto, groupBy: FinanceGroupBy, basis: InternalFinanceFilters['date_basis']) {
  if (groupBy === 'SELLER_ORGANIZATION') return row.seller_organization_id;
  if (groupBy === 'STORE') return row.store_id;
  if (groupBy === 'PRODUCT') return row.product_id;
  if (groupBy === 'ASIN') return row.asin;
  const day = basis === 'CONFIRMED' ? row.confirmed_business_date
    : basis === 'APPROVED' ? row.review_approved_business_date
      : row.last_cash_business_date;
  if (day === null) return null;
  return groupBy === 'MONTH' ? day.slice(0, 7) : day;
}
function groupLabel(row: InternalOrderFinancePositionDto, groupBy: FinanceGroupBy, key: string) {
  if (groupBy === 'PRODUCT') return row.product_name;
  return key;
}
function suggestedAction(status: FinanceStatus): InternalFinanceExceptionDto['suggested_actions'][number] {
  if (status === 'MISSING_FINANCIAL_SNAPSHOT' || status === 'MULTIPLE_FINANCIAL_SNAPSHOTS') {
    return 'REVIEW_FORMAL_ORDER_SNAPSHOT';
  }
  if (status === 'MISSING_PRINCIPAL_PAYABLE' || status === 'MISSING_SERVICE_FEE_PAYABLE') {
    return 'RUN_SELLER_PAYABLE_RECONCILIATION';
  }
  if (status === 'MISSING_BUYER_REFUND_OBLIGATION') return 'REVIEW_BUYER_REFUND_OBLIGATION';
  return 'MANUAL_INTERNAL_INVESTIGATION';
}
function decodeCursor(value: string | null): Cursor | null {
  try {
    return decodeSellerPortalCursor(
      value,
      (candidate): candidate is Cursor => isRecord(candidate)
        && Number.isSafeInteger(candidate['confirmed_at'])
        && Number(candidate['confirmed_at']) >= 0
        && typeof candidate['formal_order_id'] === 'string'
        && candidate['formal_order_id'].length >= 1
        && candidate['formal_order_id'].length <= 200,
    );
  } catch {
    return validation();
  }
}
function integer(value: number | string | bigint): string {
  return signedIntegerString(databaseIntegerToBigInt(value));
}
function nullableInteger(value: number | string | null): string | null {
  return value === null ? null : integer(value);
}
