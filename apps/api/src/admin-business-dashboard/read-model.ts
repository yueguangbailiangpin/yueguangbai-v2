import type {
  AdminBusinessDashboardSummaryDto,
  DashboardProfitDto,
  DashboardWindow,
  SqlDatabase,
} from '@ygb/contracts';
import { dashboardDateRange, dashboardWindow } from './time';

type CountRow = { count: number | string };
type ProfitAggregateRow = {
  amount: string | number | null;
  valid: number | string;
  conflicts: number | string;
};
type AdjustmentRow = { adjustment_scope: string; amount: string | number };

/**
 * Stage 4 simplified dashboard read model (inventory §3.2): every metric is a
 * single indexed aggregate over an explicit Asia/Shanghai window — no row
 * loading, no funnel cohorts, no per-channel/per-staff performance matrices,
 * and no unbounded scans. Owner profit reuses the formal internal finance
 * projection columns plus the audited financial adjustments.
 */
export async function readAdminBusinessDashboardSummary(
  database: SqlDatabase,
  key: DashboardWindow,
  now = Date.now(),
): Promise<AdminBusinessDashboardSummaryDto> {
  const window = dashboardWindow(key, now);
  const range = dashboardDateRange(window.from_date, window.to_date);
  const [
    newBuyers,
    newSellers,
    reservations,
    formalOrders,
    pendingBuyerRefunds,
    pendingSellerSettlements,
    openWorkItems,
    financeExceptions,
    projected,
    completed,
    adjustments,
  ] = await Promise.all([
    database.prepare(`SELECT COUNT(*) AS count FROM buyer_customers
      WHERE activated_at>=? AND activated_at<?`)
      .bind(range.fromEpoch, range.toExclusiveEpoch).first<CountRow>(),
    database.prepare(`SELECT COUNT(*) AS count FROM seller_organizations
      WHERE activated_at>=? AND activated_at<?`)
      .bind(range.fromEpoch, range.toExclusiveEpoch).first<CountRow>(),
    database.prepare(`SELECT COUNT(*) AS count FROM product_reservations
      WHERE submitted_at>=? AND submitted_at<? AND submitted_at<=?`)
      .bind(range.fromEpoch, range.toExclusiveEpoch, now).first<CountRow>(),
    database.prepare(`SELECT COUNT(*) AS count FROM formal_orders
      WHERE confirmed_business_date BETWEEN ? AND ? AND confirmed_at<=?`)
      .bind(range.fromDate, range.toDate, now).first<CountRow>(),
    database.prepare(`SELECT COUNT(*) AS count FROM buyer_refund_ledger_balances ledger
      WHERE ledger.due_amount_cny_fen>ledger.net_paid_cny_fen
        AND ledger.updated_at<=?`)
      .bind(now).first<CountRow>(),
    database.prepare(`SELECT COUNT(*) AS count FROM seller_payable_balances payable
      WHERE payable.outstanding_amount_cny_fen>0 AND payable.created_at<=?`)
      .bind(now).first<CountRow>(),
    database.prepare(`SELECT COUNT(*) AS count FROM staff_work_items
      WHERE status='OPEN' AND created_at<=?`)
      .bind(now).first<CountRow>(),
    database.prepare(`SELECT COUNT(*) AS count FROM internal_finance_exceptions`)
      .first<CountRow>(),
    profitAggregate(database, 'PROJECTED', range.fromDate, range.toDate, now),
    profitAggregate(database, 'COMPLETED', range.fromDate, range.toDate, now),
    database.prepare(`SELECT adjustment_scope,COALESCE(SUM(amount_cny_fen),0) AS amount
      FROM formal_order_financial_adjustments
      WHERE created_at>=? AND created_at<? AND adjustment_scope IN ('PROJECTED_GROSS_PROFIT','COMPLETED_GROSS_PROFIT')
      GROUP BY adjustment_scope`)
      .bind(range.fromEpoch, range.toExclusiveEpoch).all<AdjustmentRow>(),
  ]);

  let projectedAdjustment = 0n,
    completedAdjustment = 0n;
  for (const row of adjustments.results) {
    if (row.adjustment_scope === 'PROJECTED_GROSS_PROFIT')
      projectedAdjustment += BigInt(row.amount);
    if (row.adjustment_scope === 'COMPLETED_GROSS_PROFIT')
      completedAdjustment += BigInt(row.amount);
  }
  return Object.freeze({
    window,
    cards: Object.freeze({
      new_customers_buyer: count(newBuyers),
      new_customers_seller: count(newSellers),
      reservations: count(reservations),
      formal_orders: count(formalOrders),
    }),
    pending: Object.freeze({
      buyer_refunds: count(pendingBuyerRefunds),
      seller_settlements: count(pendingSellerSettlements),
    }),
    overdue: Object.freeze({
      open_work_items: count(openWorkItems),
      finance_exceptions: count(financeExceptions),
    }),
    owner_summary: Object.freeze({
      projected_profit: finishProfit(
        projected,
        projectedAdjustment,
      ),
      completed_profit: finishProfit(
        completed,
        completedAdjustment,
      ),
    }),
  });
}

function profitAggregate(
  database: SqlDatabase,
  side: 'PROJECTED' | 'COMPLETED',
  fromDate: string,
  toDate: string,
  now: number,
): Promise<ProfitAggregateRow | null> {
  if (side === 'PROJECTED') {
    return database.prepare(`SELECT
        CAST(COALESCE(SUM(projected_gross_profit_cny_fen),0) AS TEXT) AS amount,
        COALESCE(SUM(CASE WHEN finance_status IN ('PROJECTED_ONLY','COMPLETED') THEN 1 ELSE 0 END),0) AS valid,
        COALESCE(SUM(CASE WHEN finance_status NOT IN ('PROJECTED_ONLY','COMPLETED') THEN 1 ELSE 0 END),0) AS conflicts
      FROM internal_order_finance_positions
      WHERE finance_status IN ('PROJECTED_ONLY','COMPLETED')
        AND confirmed_business_date BETWEEN ? AND ? AND confirmed_at<=?`)
      .bind(fromDate, toDate, now).first<ProfitAggregateRow>();
  }
  return database.prepare(`SELECT
      CAST(COALESCE(SUM(completed_gross_profit_cny_fen),0) AS TEXT) AS amount,
      COALESCE(SUM(CASE WHEN finance_status='COMPLETED' THEN 1 ELSE 0 END),0) AS valid,
      COALESCE(SUM(CASE WHEN finance_status<>'COMPLETED' THEN 1 ELSE 0 END),0) AS conflicts
    FROM internal_order_finance_positions
    WHERE finance_status='COMPLETED'
      AND review_approved_business_date BETWEEN ? AND ? AND review_approved_at<=?`)
    .bind(fromDate, toDate, now).first<ProfitAggregateRow>();
}

function finishProfit(
  row: ProfitAggregateRow | null,
  adjustment: bigint,
): DashboardProfitDto {
  const amount = BigInt(row?.amount ?? '0') + adjustment;
  return Object.freeze({
    amount_cny_fen: amount.toString(),
    valid_order_count: Number(row?.valid ?? 0),
    conflict_order_count: Number(row?.conflicts ?? 0),
  });
}

function count(row: CountRow | null): number {
  return Number(row?.count ?? 0);
}
