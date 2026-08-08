export const ADMIN_BUSINESS_DASHBOARD_PATHS = Object.freeze({
  summary: '/api/staff/admin-business-dashboard/summary',
  trends: '/api/staff/admin-business-dashboard/trends',
  drillDown: '/api/staff/admin-business-dashboard/drill-down',
} as const);

export const DASHBOARD_WINDOWS = ['TODAY', 'WEEK', 'MONTH'] as const;
export type DashboardWindow = typeof DASHBOARD_WINDOWS[number];

export const DASHBOARD_GRANULARITIES = ['DAY', 'WEEK', 'MONTH'] as const;
export type DashboardGranularity = typeof DASHBOARD_GRANULARITIES[number];

export const DASHBOARD_DRILL_DOWN_METRICS = [
  'NEW_BUYERS', 'RESERVATIONS', 'FORMAL_ORDERS', 'BUSINESS_COMPLETIONS',
  'PROJECTED_PROFIT_CONFLICTS', 'COMPLETED_PROFIT_CONFLICTS',
] as const;
export type DashboardDrillDownMetric =
  typeof DASHBOARD_DRILL_DOWN_METRICS[number];

export interface DashboardWindowDto {
  key: DashboardWindow;
  from_date: string;
  to_date: string;
  timezone: 'Asia/Shanghai';
  data_as_of: number;
}

export interface DashboardFunnelStageDto {
  code: string;
  label: string;
  count: number;
  conversion_rate_bps: number | null;
}

export interface DashboardProfitDto {
  amount_cny_fen: string;
  valid_order_count: number;
  conflict_order_count: number;
}

export interface DashboardPerformanceDto {
  dimension_id: string;
  dimension_name: string;
  buyer_lead_count: number;
  buyer_registered_count: number;
  buyer_reservation_count: number;
  buyer_formal_order_count: number;
  buyer_business_completed_count: number;
  buyer_no_participation_count: number;
  seller_lead_count: number;
  seller_cooperation_count: number;
  current_owner_active_lead_count: number | null;
  consultation_count: number | null;
  projected_profit: DashboardProfitDto;
  completed_profit: DashboardProfitDto;
}

export interface AdminBusinessDashboardSummaryDto {
  window: DashboardWindowDto;
  cards: {
    new_buyers: number;
    reservations: number;
    formal_orders: number;
    business_completions: number;
  };
  buyer_funnel: {
    stages: readonly DashboardFunnelStageDto[];
    no_participation_count: number;
  };
  seller_funnel: { stages: readonly DashboardFunnelStageDto[] };
  projected_profit: DashboardProfitDto;
  completed_profit: DashboardProfitDto;
  staff_performance: readonly DashboardPerformanceDto[];
  channel_performance: readonly DashboardPerformanceDto[];
}

export interface AdminBusinessDashboardTrendPointDto {
  from_date: string;
  to_date: string;
  new_buyers: number;
  reservations: number;
  formal_orders: number;
  business_completions: number;
  projected_profit: DashboardProfitDto;
  completed_profit: DashboardProfitDto;
}

export interface AdminBusinessDashboardTrendDto {
  granularity: DashboardGranularity;
  from_date: string;
  to_date: string;
  timezone: 'Asia/Shanghai';
  data_as_of: number;
  points: readonly AdminBusinessDashboardTrendPointDto[];
}

export interface AdminBusinessDashboardDrillDownItemDto {
  reference_id: string;
  business_date: string;
  status: string;
}

export interface AdminBusinessDashboardDrillDownDto {
  metric: DashboardDrillDownMetric;
  from_date: string;
  to_date: string;
  timezone: 'Asia/Shanghai';
  data_as_of: number;
  items: readonly AdminBusinessDashboardDrillDownItemDto[];
  next_cursor: string | null;
}

export function isDashboardWindow(value: unknown): value is DashboardWindow {
  return published(value, DASHBOARD_WINDOWS);
}

export function isDashboardGranularity(
  value: unknown,
): value is DashboardGranularity {
  return published(value, DASHBOARD_GRANULARITIES);
}

export function isDashboardDrillDownMetric(
  value: unknown,
): value is DashboardDrillDownMetric {
  return published(value, DASHBOARD_DRILL_DOWN_METRICS);
}

function published<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}
