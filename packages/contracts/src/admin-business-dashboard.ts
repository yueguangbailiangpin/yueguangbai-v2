export const ADMIN_BUSINESS_DASHBOARD_PATHS = Object.freeze({
  summary: '/api/staff/admin-business-dashboard/summary',
} as const);

export const DASHBOARD_WINDOWS = ['TODAY', 'WEEK', 'MONTH'] as const;
export type DashboardWindow = typeof DASHBOARD_WINDOWS[number];

export interface DashboardWindowDto {
  key: DashboardWindow;
  from_date: string;
  to_date: string;
  timezone: 'Asia/Shanghai';
  data_as_of: number;
}

export interface DashboardProfitDto {
  amount_cny_fen: string;
  valid_order_count: number;
  conflict_order_count: number;
}

/**
 * Stage 4 simplified dashboard contract (inventory §3.2): counting cards for
 * the current window, pending financial workload counts, abnormal/overdue
 * signals, and the owner-only profit summary that reuses the formal internal
 * finance formulas. Machine-era funnels, trend analysis and drill-downs are
 * retired; manual acquisition facts stay in the acquisition module.
 */
export interface AdminBusinessDashboardSummaryDto {
  window: DashboardWindowDto;
  cards: {
    new_customers_buyer: number;
    new_customers_seller: number;
    reservations: number;
    formal_orders: number;
  };
  pending: {
    buyer_refunds: number;
    seller_settlements: number;
  };
  overdue: {
    open_work_items: number;
    finance_exceptions: number;
  };
  owner_summary: {
    projected_profit: DashboardProfitDto;
    completed_profit: DashboardProfitDto;
  };
}

export function isDashboardWindow(value: unknown): value is DashboardWindow {
  return (
    typeof value === 'string'
    && (DASHBOARD_WINDOWS as readonly string[]).includes(value)
  );
}
