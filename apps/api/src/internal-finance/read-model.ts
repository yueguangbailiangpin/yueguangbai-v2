import type {
  FinanceGroupBy,
  FinanceStatus,
  InternalFinanceCashFlowDto,
  InternalFinanceExceptionDto,
  InternalFinanceExceptionPageDto,
  InternalFinanceFilters,
  InternalFinanceGroupDto,
  InternalFinanceOrderPageDto,
  InternalFinanceSummaryDto,
  InternalFinanceTotalsDto,
  InternalOrderFinancePositionDto,
  OrderFinanceDateBasis,
  PricingReviewType,
  SqlDatabase,
} from '@ygb/contracts';
import {
  databaseIntegerToBigInt,
  parseSignedIntegerString,
  signedIntegerString,
} from '@ygb/domain';
import {
  decodeSellerPortalCursor,
  encodeSellerPortalCursor,
  isRecord,
} from '../seller-portal/pagination';
import {
  assertCashFinanceDateBasis,
  assertOrderFinanceDateBasis,
  financeDateColumn,
} from './filters';
import { InternalFinanceError, validation } from './shared';

const REPORT_BATCH_SIZE = 750;

interface PositionRow {
  formal_order_id: string;
  amazon_order_number: string;
  seller_organization_id: string;
  store_id: string;
  product_id: string;
  asin: string;
  product_name: string;
  review_type: string;
  confirmed_at: number;
  confirmed_business_date: string;
  review_approved_at: number | null;
  review_approved_business_date: string | null;
  last_cash_business_date: string | null;
  final_paid_jpy: number | string;
  financial_snapshot_id: string | null;
  buyer_self_pay_bps: number | null;
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

interface PositionCursor {
  confirmed_at: number;
  formal_order_id: string;
}

interface CashRow {
  occurred_at: number;
  movement_id: string;
  movement_type: string;
  amount_cny_fen: number | string;
}

interface CashCursor {
  occurred_at: number;
  movement_id: string;
}

interface FinanceTotalsAccumulator {
  orderCount: number;
  projectedCount: number;
  completedCount: number;
  conflictCount: number;
  projected: bigint;
  completed: bigint;
  cash: bigint;
  principalDue: bigint;
  principalCollected: bigint;
  principalOutstanding: bigint;
  feeDue: bigint;
  feeCollected: bigint;
  feeOutstanding: bigint;
  refundDue: bigint;
  refundPaid: bigint;
  refundOutstanding: bigint;
  refundOverpaid: bigint;
}

interface GroupAccumulator {
  label: string;
  totals: FinanceTotalsAccumulator;
}

type OrderFinanceFilters = InternalFinanceFilters & {
  date_basis: OrderFinanceDateBasis;
};

const POSITION_SELECT = `
  position.formal_order_id,
  position.amazon_order_number,
  position.seller_organization_id,
  position.store_id,
  position.product_id,
  position.asin,
  position.product_name,
  position.review_type,
  position.confirmed_at,
  position.confirmed_business_date,
  position.review_approved_at,
  position.review_approved_business_date,
  position.last_cash_business_date,
  CAST(position.final_paid_jpy AS TEXT) AS final_paid_jpy,
  position.financial_snapshot_id,
  position.buyer_self_pay_bps,
  CAST(position.buyer_self_pay_jpy AS TEXT) AS buyer_self_pay_jpy,
  CAST(position.buyer_expected_principal_cny_fen AS TEXT)
    AS buyer_expected_principal_cny_fen,
  CAST(position.seller_expected_principal_cny_fen AS TEXT)
    AS seller_expected_principal_cny_fen,
  CAST(position.service_fee_snapshot_cny_fen AS TEXT)
    AS service_fee_snapshot_cny_fen,
  CAST(position.projected_gross_profit_cny_fen AS TEXT)
    AS projected_gross_profit_cny_fen,
  CAST(position.completed_gross_profit_cny_fen AS TEXT)
    AS completed_gross_profit_cny_fen,
  CAST(position.seller_principal_due_cny_fen AS TEXT)
    AS seller_principal_due_cny_fen,
  CAST(position.seller_principal_collected_cny_fen AS TEXT)
    AS seller_principal_collected_cny_fen,
  CAST(position.seller_principal_outstanding_cny_fen AS TEXT)
    AS seller_principal_outstanding_cny_fen,
  CAST(position.seller_service_fee_due_cny_fen AS TEXT)
    AS seller_service_fee_due_cny_fen,
  CAST(position.seller_service_fee_collected_cny_fen AS TEXT)
    AS seller_service_fee_collected_cny_fen,
  CAST(position.seller_service_fee_outstanding_cny_fen AS TEXT)
    AS seller_service_fee_outstanding_cny_fen,
  CAST(position.buyer_refund_due_cny_fen AS TEXT)
    AS buyer_refund_due_cny_fen,
  CAST(position.buyer_refund_net_paid_cny_fen AS TEXT)
    AS buyer_refund_net_paid_cny_fen,
  CAST(position.buyer_refund_outstanding_cny_fen AS TEXT)
    AS buyer_refund_outstanding_cny_fen,
  CAST(position.buyer_refund_overpaid_cny_fen AS TEXT)
    AS buyer_refund_overpaid_cny_fen,
  CAST(position.attributed_cash_net_cny_fen AS TEXT)
    AS attributed_cash_net_cny_fen,
  position.finance_status
`;

export async function readFinanceSummary(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
  dataAsOf = Date.now(),
): Promise<InternalFinanceSummaryDto> {
  assertOrderFinanceDateBasis(filters);
  const totals = createTotalsAccumulator();
  for await (const position of iterateFinancePositions(database, filters)) {
    addPosition(totals, position);
  }
  return Object.freeze({
    ...finishTotals(totals),
    seller_unallocated_credit_cny_fen: await readUnallocatedCredit(
      database,
      filters,
    ),
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
  assertOrderFinanceDateBasis(filters);
  const cursor = decodeCursor(input.cursor);
  const where = positionWhere(filters, cursor, 'DESC');
  const result = await database.prepare(`
    SELECT ${POSITION_SELECT}
    FROM internal_order_finance_positions position
    WHERE ${where.sql}
    ORDER BY position.confirmed_at DESC, position.formal_order_id DESC
    LIMIT ?
  `).bind(...where.values, input.limit + 1).all<PositionRow>();
  const pageRows = result.results.slice(0, input.limit);
  const visible = pageRows.map(mapPosition);
  const last = pageRows.at(-1);
  return Object.freeze({
    items: Object.freeze(visible),
    page: Object.freeze({
      limit: input.limit,
      next_cursor: result.results.length > input.limit && last
        ? encodeCursor(last)
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
    SELECT ${POSITION_SELECT}
    FROM internal_order_finance_positions position
    WHERE position.formal_order_id=?
    LIMIT 1
  `).bind(formalOrderId).first<PositionRow>();
  if (!row) throw new InternalFinanceError('NOT_FOUND', 404);
  return mapPosition(row);
}

export async function* iterateFinancePositions(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
  options: { exceptionsOnly?: boolean } = {},
): AsyncGenerator<InternalOrderFinancePositionDto, void, void> {
  assertOrderFinanceDateBasis(filters);
  let cursor: PositionCursor | null = null;
  while (true) {
    const where = positionWhere(
      filters,
      cursor,
      'ASC',
      options.exceptionsOnly === true,
    );
    const result = await database.prepare(`
      SELECT ${POSITION_SELECT}
      FROM internal_order_finance_positions position
      WHERE ${where.sql}
      ORDER BY position.confirmed_at ASC, position.formal_order_id ASC
      LIMIT ?
    `).bind(...where.values, REPORT_BATCH_SIZE).all<PositionRow>();
    if (result.results.length === 0) return;
    for (const row of result.results) yield mapPosition(row);
    const last = result.results.at(-1)!;
    cursor = {
      confirmed_at: Number(last.confirmed_at),
      formal_order_id: last.formal_order_id,
    };
    if (result.results.length < REPORT_BATCH_SIZE) return;
  }
}

export async function readFinanceGroups(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
  groupBy: FinanceGroupBy,
  options: { maxGroups?: number } = {},
): Promise<readonly InternalFinanceGroupDto[]> {
  assertOrderFinanceDateBasis(filters);
  const grouped = new Map<string, GroupAccumulator>();
  for await (const row of iterateFinancePositions(database, filters)) {
    const key = groupKey(row, groupBy, filters.date_basis);
    if (key === null) continue;
    let current = grouped.get(key);
    if (!current) {
      if (options.maxGroups !== undefined
        && grouped.size >= options.maxGroups) {
        throw new InternalFinanceError('EXPORT_TOO_LARGE', 413);
      }
      current = {
        label: groupLabel(row, groupBy, key),
        totals: createTotalsAccumulator(),
      };
      grouped.set(key, current);
    }
    addPosition(current.totals, row);
  }

  const output: InternalFinanceGroupDto[] = [];
  const entries = [...grouped.entries()].sort(
    ([left], [right]) => compareText(left, right),
  );
  for (const [key, group] of entries) {
    output.push(Object.freeze({
      group_by: groupBy,
      group_key: key,
      group_label: group.label,
      ...finishTotals(group.totals),
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
  assertCashFinanceDateBasis(filters);
  let sellerIn = 0n;
  let sellerReversal = 0n;
  let buyerOut = 0n;
  let buyerReversal = 0n;
  for await (const row of iterateCashMovements(database, filters)) {
    const amount = databaseIntegerToBigInt(row.amount_cny_fen);
    if (row.movement_type === 'SELLER_PAYMENT') sellerIn += amount;
    else if (row.movement_type === 'SELLER_PAYMENT_REVERSAL') {
      sellerReversal += amount;
    } else if (row.movement_type === 'BUYER_REFUND_PAYMENT') {
      buyerOut += amount;
    } else if (row.movement_type === 'BUYER_REFUND_REVERSAL') {
      buyerReversal += amount;
    }
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

export async function readFinanceExceptionPage(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
  input: { limit: number; cursor: string | null },
  dataAsOf = Date.now(),
): Promise<InternalFinanceExceptionPageDto> {
  assertOrderFinanceDateBasis(filters);
  const cursor = decodeCursor(input.cursor);
  const where = positionWhere(filters, cursor, 'DESC', true);
  const result = await database.prepare(`
    SELECT ${POSITION_SELECT}
    FROM internal_order_finance_positions position
    WHERE ${where.sql}
    ORDER BY position.confirmed_at DESC, position.formal_order_id DESC
    LIMIT ?
  `).bind(...where.values, input.limit + 1).all<PositionRow>();
  const pageRows = result.results.slice(0, input.limit);
  const last = pageRows.at(-1);
  return Object.freeze({
    items: Object.freeze(pageRows.map((row) => mapException(mapPosition(row)))),
    page: Object.freeze({
      limit: input.limit,
      next_cursor: result.results.length > input.limit && last
        ? encodeCursor(last)
        : null,
    }),
    filters,
    data_as_of: dataAsOf,
  });
}

export async function* iterateFinanceExceptions(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
): AsyncGenerator<InternalFinanceExceptionDto, void, void> {
  for await (const row of iterateFinancePositions(
    database,
    filters,
    { exceptionsOnly: true },
  )) {
    yield mapException(row);
  }
}

function positionWhere(
  filters: OrderFinanceFilters,
  cursor: PositionCursor | null,
  direction: 'ASC' | 'DESC',
  exceptionsOnly = false,
): { sql: string; values: unknown[] } {
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
    if (value !== null) {
      clauses.push(`${column}=?`);
      values.push(value);
    }
  }
  if (exceptionsOnly) {
    clauses.push("position.finance_status NOT IN ('PROJECTED_ONLY','COMPLETED')");
  }
  if (cursor !== null) {
    const comparison = direction === 'ASC' ? '>' : '<';
    clauses.push(
      `(position.confirmed_at${comparison}? OR (`
      + `position.confirmed_at=? AND position.formal_order_id${comparison}?))`,
    );
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
    review_approved_at: row.review_approved_at === null
      ? null
      : Number(row.review_approved_at),
    review_approved_business_date: row.review_approved_business_date,
    last_cash_business_date: row.last_cash_business_date,
    final_paid_jpy: integer(row.final_paid_jpy),
    financial_snapshot_id: row.financial_snapshot_id,
    buyer_self_pay_bps: row.buyer_self_pay_bps === null
      ? null
      : Number(row.buyer_self_pay_bps),
    buyer_self_pay_jpy: nullableInteger(row.buyer_self_pay_jpy),
    buyer_expected_principal_cny_fen: nullableInteger(
      row.buyer_expected_principal_cny_fen,
    ),
    seller_expected_principal_cny_fen: nullableInteger(
      row.seller_expected_principal_cny_fen,
    ),
    service_fee_snapshot_cny_fen: nullableInteger(
      row.service_fee_snapshot_cny_fen,
    ),
    projected_gross_profit_cny_fen: nullableInteger(
      row.projected_gross_profit_cny_fen,
    ),
    completed_gross_profit_cny_fen: nullableInteger(
      row.completed_gross_profit_cny_fen,
    ),
    seller_principal_due_cny_fen: integer(row.seller_principal_due_cny_fen),
    seller_principal_collected_cny_fen: integer(
      row.seller_principal_collected_cny_fen,
    ),
    seller_principal_outstanding_cny_fen: integer(
      row.seller_principal_outstanding_cny_fen,
    ),
    seller_service_fee_due_cny_fen: integer(
      row.seller_service_fee_due_cny_fen,
    ),
    seller_service_fee_collected_cny_fen: integer(
      row.seller_service_fee_collected_cny_fen,
    ),
    seller_service_fee_outstanding_cny_fen: integer(
      row.seller_service_fee_outstanding_cny_fen,
    ),
    buyer_refund_due_cny_fen: integer(row.buyer_refund_due_cny_fen),
    buyer_refund_net_paid_cny_fen: integer(
      row.buyer_refund_net_paid_cny_fen,
    ),
    buyer_refund_outstanding_cny_fen: integer(
      row.buyer_refund_outstanding_cny_fen,
    ),
    buyer_refund_overpaid_cny_fen: integer(row.buyer_refund_overpaid_cny_fen),
    attributed_cash_net_cny_fen: integer(row.attributed_cash_net_cny_fen),
    finance_status: row.finance_status as FinanceStatus,
  });
}

function mapException(
  row: InternalOrderFinancePositionDto,
): InternalFinanceExceptionDto {
  return Object.freeze({
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
  });
}

async function* iterateCashMovements(
  database: SqlDatabase,
  filters: InternalFinanceFilters & { date_basis: 'CASH' },
): AsyncGenerator<CashRow, void, void> {
  let cursor: CashCursor | null = null;
  while (true) {
    const clauses = ['movement.cash_business_date BETWEEN ? AND ?'];
    const values: unknown[] = [filters.from_date, filters.to_date];
    if (filters.seller_organization_id !== null) {
      clauses.push('movement.seller_organization_id=?');
      values.push(filters.seller_organization_id);
    }
    if (cursor !== null) {
      clauses.push(
        '(movement.occurred_at>? OR ('
        + 'movement.occurred_at=? AND movement.movement_id>?))',
      );
      values.push(cursor.occurred_at, cursor.occurred_at, cursor.movement_id);
    }
    const result = await database.prepare(`
      SELECT
        movement.occurred_at,
        movement.movement_id,
        movement.movement_type,
        CAST(movement.amount_cny_fen AS TEXT) AS amount_cny_fen
      FROM internal_finance_cash_movements movement
      WHERE ${clauses.join(' AND ')}
      ORDER BY movement.occurred_at ASC, movement.movement_id ASC
      LIMIT ?
    `).bind(...values, REPORT_BATCH_SIZE).all<CashRow>();
    if (result.results.length === 0) return;
    for (const row of result.results) yield row;
    const last = result.results.at(-1)!;
    cursor = {
      occurred_at: Number(last.occurred_at),
      movement_id: last.movement_id,
    };
    if (result.results.length < REPORT_BATCH_SIZE) return;
  }
}

async function readUnallocatedCredit(
  database: SqlDatabase,
  filters: InternalFinanceFilters,
): Promise<string> {
  if (filters.store_id !== null
    || filters.product_id !== null
    || filters.asin !== null
    || filters.formal_order_id !== null
    || filters.amazon_order_number !== null
    || filters.review_type !== null
    || filters.finance_status !== null) return '0';
  if (filters.seller_organization_id !== null) {
    return readOrganizationUnallocatedCredit(
      database,
      filters.seller_organization_id,
    );
  }

  let cursor: string | null = null;
  let total = 0n;
  while (true) {
    const result = cursor === null
      ? await database.prepare(`
          SELECT seller_organization_id,
            CAST(unallocated_credit_cny_fen AS TEXT) AS value
          FROM seller_organization_settlement_balances
          ORDER BY seller_organization_id ASC
          LIMIT ?
        `).bind(REPORT_BATCH_SIZE).all<{
          seller_organization_id: string;
          value: string | number;
        }>()
      : await database.prepare(`
          SELECT seller_organization_id,
            CAST(unallocated_credit_cny_fen AS TEXT) AS value
          FROM seller_organization_settlement_balances
          WHERE seller_organization_id>?
          ORDER BY seller_organization_id ASC
          LIMIT ?
        `).bind(cursor, REPORT_BATCH_SIZE).all<{
          seller_organization_id: string;
          value: string | number;
        }>();
    for (const row of result.results) {
      total += databaseIntegerToBigInt(row.value);
    }
    if (result.results.length < REPORT_BATCH_SIZE) break;
    cursor = result.results.at(-1)!.seller_organization_id;
  }
  return signedIntegerString(total);
}

async function readOrganizationUnallocatedCredit(
  database: SqlDatabase,
  id: string,
): Promise<string> {
  const row = await database.prepare(`
    SELECT CAST(unallocated_credit_cny_fen AS TEXT) AS value
    FROM seller_organization_settlement_balances
    WHERE seller_organization_id=?
  `).bind(id).first<{ value: string | number }>();
  return integer(row?.value ?? 0);
}

function groupKey(
  row: InternalOrderFinancePositionDto,
  groupBy: FinanceGroupBy,
  basis: OrderFinanceDateBasis,
): string | null {
  if (groupBy === 'SELLER_ORGANIZATION') return row.seller_organization_id;
  if (groupBy === 'STORE') return row.store_id;
  if (groupBy === 'PRODUCT') return row.product_id;
  if (groupBy === 'ASIN') return row.asin;
  const day = basis === 'CONFIRMED'
    ? row.confirmed_business_date
    : row.review_approved_business_date;
  if (day === null) return null;
  return groupBy === 'MONTH' ? day.slice(0, 7) : day;
}

function groupLabel(
  row: InternalOrderFinancePositionDto,
  groupBy: FinanceGroupBy,
  key: string,
): string {
  if (groupBy === 'PRODUCT') return row.product_name;
  return key;
}

function suggestedAction(
  status: FinanceStatus,
): InternalFinanceExceptionDto['suggested_actions'][number] {
  if (status === 'MISSING_FINANCIAL_SNAPSHOT'
    || status === 'MULTIPLE_FINANCIAL_SNAPSHOTS') {
    return 'REVIEW_FORMAL_ORDER_SNAPSHOT';
  }
  if (status === 'MISSING_PRINCIPAL_PAYABLE'
    || status === 'MISSING_SERVICE_FEE_PAYABLE') {
    return 'RUN_SELLER_PAYABLE_RECONCILIATION';
  }
  if (status === 'MISSING_BUYER_REFUND_OBLIGATION') {
    return 'REVIEW_BUYER_REFUND_OBLIGATION';
  }
  return 'MANUAL_INTERNAL_INVESTIGATION';
}

function createTotalsAccumulator(): FinanceTotalsAccumulator {
  return {
    orderCount: 0,
    projectedCount: 0,
    completedCount: 0,
    conflictCount: 0,
    projected: 0n,
    completed: 0n,
    cash: 0n,
    principalDue: 0n,
    principalCollected: 0n,
    principalOutstanding: 0n,
    feeDue: 0n,
    feeCollected: 0n,
    feeOutstanding: 0n,
    refundDue: 0n,
    refundPaid: 0n,
    refundOutstanding: 0n,
    refundOverpaid: 0n,
  };
}

function addPosition(
  totals: FinanceTotalsAccumulator,
  row: InternalOrderFinancePositionDto,
): void {
  totals.orderCount += 1;
  if (row.projected_gross_profit_cny_fen !== null) {
    totals.projected += parseSignedIntegerString(
      row.projected_gross_profit_cny_fen,
    );
    totals.projectedCount += 1;
  }
  if (row.completed_gross_profit_cny_fen !== null) {
    totals.completed += parseSignedIntegerString(
      row.completed_gross_profit_cny_fen,
    );
    totals.completedCount += 1;
  }
  if (row.finance_status !== 'PROJECTED_ONLY'
    && row.finance_status !== 'COMPLETED') {
    totals.conflictCount += 1;
  }
  totals.cash += parseSignedIntegerString(row.attributed_cash_net_cny_fen);
  totals.principalDue += parseSignedIntegerString(
    row.seller_principal_due_cny_fen,
  );
  totals.principalCollected += parseSignedIntegerString(
    row.seller_principal_collected_cny_fen,
  );
  totals.principalOutstanding += parseSignedIntegerString(
    row.seller_principal_outstanding_cny_fen,
  );
  totals.feeDue += parseSignedIntegerString(
    row.seller_service_fee_due_cny_fen,
  );
  totals.feeCollected += parseSignedIntegerString(
    row.seller_service_fee_collected_cny_fen,
  );
  totals.feeOutstanding += parseSignedIntegerString(
    row.seller_service_fee_outstanding_cny_fen,
  );
  totals.refundDue += parseSignedIntegerString(row.buyer_refund_due_cny_fen);
  totals.refundPaid += parseSignedIntegerString(
    row.buyer_refund_net_paid_cny_fen,
  );
  totals.refundOutstanding += parseSignedIntegerString(
    row.buyer_refund_outstanding_cny_fen,
  );
  totals.refundOverpaid += parseSignedIntegerString(
    row.buyer_refund_overpaid_cny_fen,
  );
}

function finishTotals(
  totals: FinanceTotalsAccumulator,
): InternalFinanceTotalsDto {
  return Object.freeze({
    order_count: totals.orderCount,
    projected_order_count: totals.projectedCount,
    completed_order_count: totals.completedCount,
    conflict_order_count: totals.conflictCount,
    projected_gross_profit_cny_fen: signedIntegerString(totals.projected),
    completed_gross_profit_cny_fen: signedIntegerString(totals.completed),
    attributed_cash_net_cny_fen: signedIntegerString(totals.cash),
    seller_principal_due_cny_fen: signedIntegerString(totals.principalDue),
    seller_principal_collected_cny_fen: signedIntegerString(
      totals.principalCollected,
    ),
    seller_principal_outstanding_cny_fen: signedIntegerString(
      totals.principalOutstanding,
    ),
    seller_service_fee_due_cny_fen: signedIntegerString(totals.feeDue),
    seller_service_fee_collected_cny_fen: signedIntegerString(
      totals.feeCollected,
    ),
    seller_service_fee_outstanding_cny_fen: signedIntegerString(
      totals.feeOutstanding,
    ),
    buyer_refund_due_cny_fen: signedIntegerString(totals.refundDue),
    buyer_refund_net_paid_cny_fen: signedIntegerString(totals.refundPaid),
    buyer_refund_outstanding_cny_fen: signedIntegerString(
      totals.refundOutstanding,
    ),
    buyer_refund_overpaid_cny_fen: signedIntegerString(
      totals.refundOverpaid,
    ),
  });
}

function decodeCursor(value: string | null): PositionCursor | null {
  try {
    return decodeSellerPortalCursor(
      value,
      (candidate): candidate is PositionCursor => isRecord(candidate)
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

function encodeCursor(row: PositionRow): string {
  return encodeSellerPortalCursor({
    confirmed_at: Number(row.confirmed_at),
    formal_order_id: row.formal_order_id,
  });
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function integer(value: number | string | bigint): string {
  return signedIntegerString(databaseIntegerToBigInt(value));
}

function nullableInteger(value: number | string | null): string | null {
  return value === null ? null : integer(value);
}
