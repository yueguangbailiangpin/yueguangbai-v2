import type {
  SellerPayableDto,
  SellerPayablePageDto,
  SellerPaymentAllocationSummaryDto,
  SellerPaymentDto,
  SellerPaymentPageDto,
  SellerSettlementSummaryDto,
  SqlDatabase,
} from '@ygb/contracts';
import type { SellerPortalActor } from '../seller-portal/actor';
import {
  decodeSellerPortalCursor,
  encodeSellerPortalCursor,
  isRecord,
} from '../seller-portal/pagination';
import {
  fixedInteger,
  SellerSettlementError,
} from './shared';

interface ScopeInput {
  sellerOrganizationId: string;
  allActiveStores: boolean;
  storeIds: readonly string[];
}

interface PayableRow {
  payable_id: string;
  formal_order_id: string;
  amazon_order_number: string;
  store_id: string;
  store_display_name: string;
  product_id: string;
  asin: string;
  product_name: string;
  payable_type: 'SELLER_PRINCIPAL' | 'SELLER_SERVICE_FEE';
  due_amount_cny_fen: number | string;
  paid_amount_cny_fen: number | string;
  outstanding_amount_cny_fen: number | string;
  derived_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  due_at: number;
  created_at: number;
}

interface PaymentRow {
  payment_id: string;
  amount_cny_fen: number | string;
  paid_at: number;
  recorded_at: number;
  allocated_amount_cny_fen: number | string;
  unallocated_amount_cny_fen: number | string;
  derived_status:
    | 'REVERSED'
    | 'UNALLOCATED'
    | 'PARTIALLY_ALLOCATED'
    | 'FULLY_ALLOCATED';
  version: number;
}

interface AllocationRow {
  allocation_id: string;
  payable_id: string;
  payable_type: 'SELLER_PRINCIPAL' | 'SELLER_SERVICE_FEE';
  amount_cny_fen: number | string;
  reversed_amount_cny_fen: number | string;
  net_amount_cny_fen: number | string;
  allocated_at: number;
}

interface SummaryRow {
  outstanding_principal_cny_fen: number | string;
  outstanding_service_fee_cny_fen: number | string;
  unallocated_credit_cny_fen: number | string;
}

interface Cursor { at: number; id: string }

export function sellerScope(actor: SellerPortalActor): ScopeInput {
  return {
    sellerOrganizationId: actor.sellerOrganizationId,
    allActiveStores: actor.allActiveStores,
    storeIds: actor.storeIds,
  };
}

export function staffScope(sellerOrganizationId: string): ScopeInput {
  return {
    sellerOrganizationId,
    allActiveStores: true,
    storeIds: [],
  };
}

export async function readSellerSettlementSummary(
  database: SqlDatabase,
  scope: ScopeInput,
): Promise<SellerSettlementSummaryDto> {
  const store = storeSql(scope, 'formal_order.store_id');
  const row = await database.prepare(`
    SELECT
      COALESCE(SUM(CASE
        WHEN balance.payable_type='SELLER_PRINCIPAL'
          THEN balance.outstanding_amount_cny_fen ELSE 0 END),0)
        AS outstanding_principal_cny_fen,
      COALESCE(SUM(CASE
        WHEN balance.payable_type='SELLER_SERVICE_FEE'
          THEN balance.outstanding_amount_cny_fen ELSE 0 END),0)
        AS outstanding_service_fee_cny_fen,
      CASE WHEN ?=1 THEN COALESCE((
        SELECT SUM(payment.unallocated_amount_cny_fen)
        FROM seller_payment_balances payment
        WHERE payment.seller_organization_id=?
      ),0) ELSE 0 END AS unallocated_credit_cny_fen
    FROM seller_payable_balances balance
    JOIN formal_orders formal_order ON formal_order.id=balance.formal_order_id
    WHERE balance.seller_organization_id=? ${store.sql}
  `).bind(
    scope.allActiveStores ? 1 : 0,
    scope.sellerOrganizationId,
    scope.sellerOrganizationId,
    ...store.values,
  ).first<SummaryRow>();
  if (!row) throw dependency();
  const account = await database.prepare(`
    SELECT settlement_account_name, settlement_account_identifier
    FROM seller_organizations
    WHERE id=?
  `).bind(scope.sellerOrganizationId)
    .first<{ settlement_account_name: string | null; settlement_account_identifier: string | null }>();
  if (!account) throw dependency();
  const principal = BigInt(String(row.outstanding_principal_cny_fen));
  const serviceFee = BigInt(String(row.outstanding_service_fee_cny_fen));
  return Object.freeze({
    outstanding_principal_cny_fen: fixedInteger(principal),
    outstanding_service_fee_cny_fen: fixedInteger(serviceFee),
    total_outstanding_cny_fen: fixedInteger(principal + serviceFee),
    unallocated_credit_cny_fen: fixedInteger(row.unallocated_credit_cny_fen),
    settlement_account_name: account.settlement_account_name,
    settlement_account_identifier: account.settlement_account_identifier,
  });
}

export async function listSellerPayables(
  database: SqlDatabase,
  scope: ScopeInput,
  input: { limit: number; cursor: string | null },
): Promise<SellerPayablePageDto> {
  const cursor = decodeCursor(input.cursor);
  const store = storeSql(scope, 'formal_order.store_id');
  const cursorSql = cursor === null
    ? { sql: '', values: [] as unknown[] }
    : {
        sql: `AND (balance.due_at<? OR (balance.due_at=? AND balance.payable_id<?))`,
        values: [cursor.at, cursor.at, cursor.id],
      };
  const result = await database.prepare(`
    ${payableSelect()}
    WHERE balance.seller_organization_id=?
      ${store.sql}
      ${cursorSql.sql}
    ORDER BY balance.due_at DESC, balance.payable_id DESC
    LIMIT ?
  `).bind(
    scope.sellerOrganizationId,
    ...store.values,
    ...cursorSql.values,
    input.limit + 1,
  ).all<PayableRow>();
  const visible = result.results.slice(0, input.limit);
  const last = visible.at(-1);
  return Object.freeze({
    items: Object.freeze(visible.map(mapPayable)),
    page: Object.freeze({
      limit: input.limit,
      next_cursor: result.results.length > input.limit && last
        ? encodeSellerPortalCursor({ at: Number(last.due_at), id: last.payable_id })
        : null,
    }),
  });
}

export async function getSellerPayable(
  database: SqlDatabase,
  scope: ScopeInput,
  payableId: string,
): Promise<SellerPayableDto> {
  const store = storeSql(scope, 'formal_order.store_id');
  const row = await database.prepare(`
    ${payableSelect()}
    WHERE balance.payable_id=?
      AND balance.seller_organization_id=?
      ${store.sql}
    LIMIT 1
  `).bind(payableId, scope.sellerOrganizationId, ...store.values).first<PayableRow>();
  if (!row) throw new SellerSettlementError('NOT_FOUND', 404);
  return mapPayable(row);
}

export async function listSellerPayments(
  database: SqlDatabase,
  scope: ScopeInput,
  input: { limit: number; cursor: string | null },
): Promise<SellerPaymentPageDto> {
  requireOrganizationPaymentScope(scope);
  const cursor = decodeCursor(input.cursor);
  const cursorSql = cursor === null
    ? { sql: '', values: [] as unknown[] }
    : {
        sql: `AND (payment.paid_at<? OR (payment.paid_at=? AND payment.payment_id<?))`,
        values: [cursor.at, cursor.at, cursor.id],
      };
  const result = await database.prepare(`
    SELECT payment.* FROM seller_payment_balances payment
    WHERE payment.seller_organization_id=? ${cursorSql.sql}
    ORDER BY payment.paid_at DESC, payment.payment_id DESC
    LIMIT ?
  `).bind(
    scope.sellerOrganizationId,
    ...cursorSql.values,
    input.limit + 1,
  ).all<PaymentRow>();
  const visible = result.results.slice(0, input.limit);
  const allocations = await allocationsByPayment(
    database,
    visible.map((row) => row.payment_id),
  );
  const last = visible.at(-1);
  return Object.freeze({
    items: Object.freeze(visible.map((row) => mapPayment(
      row,
      allocations.get(row.payment_id) ?? [],
    ))),
    page: Object.freeze({
      limit: input.limit,
      next_cursor: result.results.length > input.limit && last
        ? encodeSellerPortalCursor({ at: Number(last.paid_at), id: last.payment_id })
        : null,
    }),
  });
}

export async function getSellerPayment(
  database: SqlDatabase,
  scope: ScopeInput,
  paymentId: string,
): Promise<SellerPaymentDto> {
  requireOrganizationPaymentScope(scope);
  const row = await database.prepare(`
    SELECT payment.* FROM seller_payment_balances payment
    WHERE payment.payment_id=? AND payment.seller_organization_id=?
  `).bind(paymentId, scope.sellerOrganizationId).first<PaymentRow>();
  if (!row) throw new SellerSettlementError('NOT_FOUND', 404);
  const allocations = await allocationsByPayment(database, [paymentId]);
  return mapPayment(row, allocations.get(paymentId) ?? []);
}

function payableSelect(): string {
  return `
    SELECT
      balance.payable_id,
      balance.formal_order_id,
      formal_order.amazon_order_number_normalized AS amazon_order_number,
      formal_order.store_id,
      store.display_name AS store_display_name,
      formal_order.product_id,
      formal_order.asin_normalized AS asin,
      formal_order.product_name_snapshot AS product_name,
      balance.payable_type,
      balance.amount_cny_fen AS due_amount_cny_fen,
      balance.paid_amount_cny_fen,
      balance.outstanding_amount_cny_fen,
      balance.derived_status,
      balance.due_at,
      balance.created_at
    FROM seller_payable_balances balance
    JOIN formal_orders formal_order ON formal_order.id=balance.formal_order_id
    JOIN seller_stores store
      ON store.id=formal_order.store_id
      AND store.organization_id=balance.seller_organization_id
  `;
}

async function allocationsByPayment(
  database: SqlDatabase,
  paymentIds: readonly string[],
): Promise<ReadonlyMap<string, readonly SellerPaymentAllocationSummaryDto[]>> {
  if (paymentIds.length === 0) return new Map();
  const result = await database.prepare(`
    SELECT
      net.payment_id,
      net.allocation_id,
      net.payable_id,
      payable.payable_type,
      net.amount_cny_fen,
      net.reversed_amount_cny_fen,
      net.net_amount_cny_fen,
      net.allocated_at
    FROM seller_allocation_net_amounts net
    JOIN seller_payables payable ON payable.id=net.payable_id
    WHERE net.payment_id IN (${paymentIds.map(() => '?').join(', ')})
    ORDER BY net.payment_id, net.allocated_at, net.allocation_id
  `).bind(...paymentIds).all<AllocationRow & { payment_id: string }>();
  const grouped = new Map<string, SellerPaymentAllocationSummaryDto[]>();
  for (const row of result.results) {
    const values = grouped.get(row.payment_id) ?? [];
    values.push(Object.freeze({
      allocation_id: row.allocation_id,
      payable_id: row.payable_id,
      payable_type: row.payable_type,
      allocated_amount_cny_fen: fixedInteger(row.amount_cny_fen),
      reversed_amount_cny_fen: fixedInteger(row.reversed_amount_cny_fen),
      net_amount_cny_fen: fixedInteger(row.net_amount_cny_fen),
      allocated_at: Number(row.allocated_at),
    }));
    grouped.set(row.payment_id, values);
  }
  return new Map([...grouped].map(([key, values]) => [key, Object.freeze(values)]));
}

function mapPayable(row: PayableRow): SellerPayableDto {
  return Object.freeze({
    payable_id: row.payable_id,
    formal_order_id: row.formal_order_id,
    amazon_order_number: row.amazon_order_number,
    store: Object.freeze({ id: row.store_id, display_name: row.store_display_name }),
    product: Object.freeze({
      id: row.product_id,
      asin: row.asin,
      name: row.product_name,
    }),
    payable_type: row.payable_type,
    due_amount_cny_fen: fixedInteger(row.due_amount_cny_fen),
    paid_amount_cny_fen: fixedInteger(row.paid_amount_cny_fen),
    outstanding_amount_cny_fen: fixedInteger(row.outstanding_amount_cny_fen),
    status: row.derived_status,
    due_at: Number(row.due_at),
    created_at: Number(row.created_at),
  });
}

function mapPayment(
  row: PaymentRow,
  allocations: readonly SellerPaymentAllocationSummaryDto[],
): SellerPaymentDto {
  return Object.freeze({
    payment_id: row.payment_id,
    amount_cny_fen: fixedInteger(row.amount_cny_fen),
    paid_at: Number(row.paid_at),
    recorded_at: Number(row.recorded_at),
    allocated_amount_cny_fen: fixedInteger(row.allocated_amount_cny_fen),
    unallocated_amount_cny_fen: fixedInteger(row.unallocated_amount_cny_fen),
    status: row.derived_status,
    version: Number(row.version),
    allocations: Object.freeze([...allocations]),
  });
}

function storeSql(
  scope: ScopeInput,
  column: string,
): { sql: string; values: readonly string[] } {
  if (scope.allActiveStores) return { sql: '', values: [] };
  if (scope.storeIds.length === 0) return { sql: 'AND 1=0', values: [] };
  return {
    sql: `AND ${column} IN (${scope.storeIds.map(() => '?').join(', ')})`,
    values: scope.storeIds,
  };
}

function requireOrganizationPaymentScope(scope: ScopeInput): void {
  if (!scope.allActiveStores) throw new SellerSettlementError('NOT_FOUND', 404);
}

function decodeCursor(value: string | null): Cursor | null {
  return decodeSellerPortalCursor(value, (candidate): candidate is Cursor => {
    return isRecord(candidate)
      && Number.isSafeInteger(candidate['at'])
      && Number(candidate['at']) >= 0
      && typeof candidate['id'] === 'string'
      && candidate['id'].length >= 1
      && candidate['id'].length <= 200;
  });
}

function dependency(): SellerSettlementError {
  return new SellerSettlementError('DEPENDENCY_UNAVAILABLE', 503);
}