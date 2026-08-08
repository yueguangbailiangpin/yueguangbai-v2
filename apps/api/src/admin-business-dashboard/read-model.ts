import type {
  AdminBusinessDashboardDrillDownDto,
  AdminBusinessDashboardSummaryDto,
  AdminBusinessDashboardTrendDto,
  DashboardDrillDownMetric,
  DashboardFunnelStageDto,
  DashboardGranularity,
  DashboardPerformanceDto,
  DashboardProfitDto,
  DashboardWindow,
  FinanceStatus,
  SqlDatabase,
} from '@ygb/contracts';
import { databaseIntegerToBigInt } from '@ygb/domain';
import {
  dashboardBuckets,
  dashboardDateRange,
  dashboardWindow,
} from './time';

type FactRow = { id: string; business_date: string };
type ProfitRow = {
  formal_order_id: string;
  confirmed_business_date: string;
  review_approved_business_date: string | null;
  projected_gross_profit_cny_fen: string | number | null;
  completed_gross_profit_cny_fen: string | number | null;
  finance_status: FinanceStatus;
};
type LeadRow = {
  id: string;
  lead_type: 'BUYER' | 'SELLER';
  origin_channel_id: string;
  origin_channel_name: string;
  origin_staff_id: string;
  origin_staff_name: string;
  registered: number;
  reserved: number;
  reservation_count: number;
  ordered: number;
  formal_order_count: number;
  business_completed: number;
  business_completed_count: number;
  cooperation: number;
};
type ConsultationRow = {
  channel_id: string;
  channel_name: string;
  lead_type: 'BUYER' | 'SELLER';
  count: number;
};
type AttributionRow = {
  formal_order_id: string;
  origin_staff_id: string;
  origin_staff_name: string;
  origin_channel_id: string;
  origin_channel_name: string;
};
type NamedDimension = { id: string; name: string };

interface CoreFacts {
  buyers: readonly FactRow[];
  reservations: readonly FactRow[];
  orders: readonly FactRow[];
  completions: readonly FactRow[];
}

interface MutableProfit {
  amount: bigint;
  valid: number;
  conflicts: number;
}

interface MutablePerformance {
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
  projected: MutableProfit;
  completed: MutableProfit;
}

export async function readAdminBusinessDashboardSummary(
  database: SqlDatabase,
  key: DashboardWindow,
  now = Date.now(),
): Promise<AdminBusinessDashboardSummaryDto> {
  const window = dashboardWindow(key, now);
  const range = dashboardDateRange(window.from_date, window.to_date);
  const [facts, leads, consultations, profitRows, attribution, currentWorkload,
    dimensions] =
    await Promise.all([
      readCoreFacts(database, range, now),
      readLeadCohort(database, range.fromDate, range.toDate, now),
      readConsultations(database, range.fromDate, range.toDate),
      readProfitRows(database, range.fromDate, range.toDate, now),
      readAttribution(database, now),
      readCurrentWorkload(database, now),
      readPerformanceDimensions(database),
    ]);

  const buyerLeads = leads.filter((lead) => lead.lead_type === 'BUYER');
  const sellerLeads = leads.filter((lead) => lead.lead_type === 'SELLER');
  const buyerConsultations = sumConsultations(consultations, 'BUYER');
  const sellerConsultations = sumConsultations(consultations, 'SELLER');
  const buyerCounts = {
    added: buyerLeads.length,
    registered: buyerLeads.filter((lead) => lead.registered === 1).length,
    reserved: buyerLeads.filter((lead) => lead.reserved === 1).length,
    ordered: buyerLeads.filter((lead) => lead.ordered === 1).length,
    completed: buyerLeads.filter((lead) => lead.business_completed === 1).length,
  };
  const sellerCounts = {
    added: sellerLeads.length,
    cooperation: sellerLeads.filter((lead) => lead.cooperation === 1).length,
  };

  const staff = new Map<string, MutablePerformance>();
  const channels = new Map<string, MutablePerformance>();
  for (const row of dimensions.staff) performance(staff, row.id, row.name, false);
  for (const row of dimensions.channels) performance(channels, row.id, row.name, true);
  for (const lead of leads) {
    addLead(performance(staff, lead.origin_staff_id, lead.origin_staff_name, false), lead);
    addLead(performance(channels, lead.origin_channel_id, lead.origin_channel_name, true), lead);
  }
  for (const row of consultations) {
    const target = performance(channels, row.channel_id, row.channel_name, true);
    target.consultation_count = (target.consultation_count ?? 0) + Number(row.count);
  }
  for (const row of currentWorkload) {
    performance(staff, row.id, row.name, false).current_owner_active_lead_count = row.count;
  }
  const attributionByOrder = new Map(attribution.map((row) => [row.formal_order_id, row]));
  const projected = emptyProfit();
  const completed = emptyProfit();
  for (const row of profitRows) {
    const origin = attributionByOrder.get(row.formal_order_id);
    if (row.confirmed_business_date >= range.fromDate
      && row.confirmed_business_date <= range.toDate) {
      addProjected(projected, row);
      if (origin) {
        addProjected(performance(staff, origin.origin_staff_id, origin.origin_staff_name, false).projected, row);
        addProjected(performance(channels, origin.origin_channel_id, origin.origin_channel_name, true).projected, row);
      }
    }
    if (row.review_approved_business_date !== null
      && row.review_approved_business_date >= range.fromDate
      && row.review_approved_business_date <= range.toDate) {
      addCompleted(completed, row);
      if (origin) {
        addCompleted(performance(staff, origin.origin_staff_id, origin.origin_staff_name, false).completed, row);
        addCompleted(performance(channels, origin.origin_channel_id, origin.origin_channel_name, true).completed, row);
      }
    }
  }

  return Object.freeze({
    window,
    cards: Object.freeze({
      new_buyers: facts.buyers.length,
      reservations: facts.reservations.length,
      formal_orders: facts.orders.length,
      business_completions: facts.completions.length,
    }),
    buyer_funnel: Object.freeze({
      stages: Object.freeze(funnelStages([
        ['CONSULTATION', '咨询', buyerConsultations],
        ['WECHAT_ADDED', '加微信', buyerCounts.added],
        ['REGISTERED', '注册', buyerCounts.registered],
        ['RESERVATION_SUBMITTED', '预约', buyerCounts.reserved],
        ['FORMAL_ORDER', '正式订单', buyerCounts.ordered],
        ['BUSINESS_COMPLETED', '业务完成', buyerCounts.completed],
      ])),
      no_participation_count: buyerCounts.added - buyerCounts.reserved,
    }),
    seller_funnel: Object.freeze({
      stages: Object.freeze(funnelStages([
        ['CONSULTATION', '咨询', sellerConsultations],
        ['WECHAT_ADDED', '加微信', sellerCounts.added],
        ['COOPERATION', '确认合作', sellerCounts.cooperation],
      ])),
    }),
    projected_profit: finishProfit(projected),
    completed_profit: finishProfit(completed),
    staff_performance: finishPerformance(staff),
    channel_performance: finishPerformance(channels),
  });
}

export async function readAdminBusinessDashboardTrend(
  database: SqlDatabase,
  input: { fromDate: string; toDate: string; granularity: DashboardGranularity },
  now = Date.now(),
): Promise<AdminBusinessDashboardTrendDto> {
  const range = dashboardDateRange(input.fromDate, input.toDate);
  const buckets = dashboardBuckets(range.fromDate, range.toDate, input.granularity);
  const [facts, profitRows] = await Promise.all([
    readCoreFacts(database, range, now),
    readProfitRows(database, range.fromDate, range.toDate, now),
  ]);
  const points = buckets.map((bucket) => {
    const projected = emptyProfit();
    const completed = emptyProfit();
    for (const row of profitRows) {
      if (inside(row.confirmed_business_date, bucket)) addProjected(projected, row);
      if (row.review_approved_business_date !== null
        && inside(row.review_approved_business_date, bucket)) addCompleted(completed, row);
    }
    return Object.freeze({
      ...bucket,
      new_buyers: facts.buyers.filter((row) => inside(row.business_date, bucket)).length,
      reservations: facts.reservations.filter((row) => inside(row.business_date, bucket)).length,
      formal_orders: facts.orders.filter((row) => inside(row.business_date, bucket)).length,
      business_completions: facts.completions.filter((row) => inside(row.business_date, bucket)).length,
      projected_profit: finishProfit(projected),
      completed_profit: finishProfit(completed),
    });
  });
  return Object.freeze({
    granularity: input.granularity,
    from_date: range.fromDate,
    to_date: range.toDate,
    timezone: 'Asia/Shanghai',
    data_as_of: now,
    points: Object.freeze(points),
  });
}

export async function readAdminBusinessDashboardDrillDown(
  database: SqlDatabase,
  input: {
    metric: DashboardDrillDownMetric;
    fromDate: string;
    toDate: string;
    limit: number;
    cursor: string | null;
  },
  now = Date.now(),
): Promise<AdminBusinessDashboardDrillDownDto> {
  const range = dashboardDateRange(input.fromDate, input.toDate);
  const cursor = decodeCursor(input.cursor);
  const source = drillDownSource(input.metric);
  const values: unknown[] = [...source.bindings(range, now)];
  let cursorSql = '';
  if (cursor) {
    cursorSql = 'AND (fact.business_date<? OR (fact.business_date=? AND fact.reference_id<?))';
    values.push(cursor.business_date, cursor.business_date, cursor.reference_id);
  }
  values.push(input.limit + 1);
  const rows = await database.prepare(`SELECT fact.reference_id,fact.business_date,fact.status
    FROM (${source.sql}) fact WHERE 1=1 ${cursorSql}
    ORDER BY fact.business_date DESC,fact.reference_id DESC LIMIT ?`)
    .bind(...values).all<{ reference_id: string; business_date: string; status: string }>();
  const items = rows.results.slice(0, input.limit).map((row) => Object.freeze(row));
  const last = items.at(-1);
  return Object.freeze({
    metric: input.metric,
    from_date: range.fromDate,
    to_date: range.toDate,
    timezone: 'Asia/Shanghai',
    data_as_of: now,
    items: Object.freeze(items),
    next_cursor: rows.results.length > input.limit && last ? encodeCursor(last) : null,
  });
}

async function readCoreFacts(
  database: SqlDatabase,
  range: ReturnType<typeof dashboardDateRange>,
  now: number,
): Promise<CoreFacts> {
  const [buyers, reservations, orders, completions] = await Promise.all([
    database.prepare(`SELECT id,date(activated_at/1000,'unixepoch','+8 hours') AS business_date
      FROM buyer_customers WHERE activated_at>=? AND activated_at<? AND activated_at<=?`)
      .bind(range.fromEpoch, range.toExclusiveEpoch, now).all<FactRow>(),
    database.prepare(`SELECT id,date(submitted_at/1000,'unixepoch','+8 hours') AS business_date
      FROM product_reservations WHERE submitted_at>=? AND submitted_at<? AND submitted_at<=?`)
      .bind(range.fromEpoch, range.toExclusiveEpoch, now).all<FactRow>(),
    database.prepare(`SELECT id,confirmed_business_date AS business_date FROM formal_orders
      WHERE confirmed_business_date BETWEEN ? AND ? AND confirmed_at<=?`)
      .bind(range.fromDate, range.toDate, now).all<FactRow>(),
    database.prepare(`SELECT formal_order_id AS id,
        date(business_closed_at/1000,'unixepoch','+8 hours') AS business_date
      FROM order_archive_closures WHERE status='CLOSED'
        AND business_closed_at>=? AND business_closed_at<? AND business_closed_at<=?`)
      .bind(range.fromEpoch, range.toExclusiveEpoch, now).all<FactRow>(),
  ]);
  return { buyers: buyers.results, reservations: reservations.results,
    orders: orders.results, completions: completions.results };
}

async function readLeadCohort(
  database: SqlDatabase,
  fromDate: string,
  toDate: string,
  now: number,
): Promise<readonly LeadRow[]> {
  const rows = await database.prepare(`SELECT lead.id,lead.lead_type,
      lead.origin_channel_id,channel.display_name AS origin_channel_name,
      lead.origin_staff_id,staff.display_name AS origin_staff_name,
      EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=lead.id
        AND link.link_type='BUYER_CUSTOMER' AND link.linked_at<=?) AS registered,
      EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=lead.id
        AND link.link_type='RESERVATION' AND link.linked_at<=?) AS reserved,
      (SELECT COUNT(*) FROM acquisition_lead_links link WHERE link.lead_id=lead.id
        AND link.link_type='RESERVATION' AND link.linked_at<=?) AS reservation_count,
      EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=lead.id
        AND link.link_type='FORMAL_ORDER' AND link.linked_at<=?) AS ordered,
      (SELECT COUNT(*) FROM acquisition_lead_links link WHERE link.lead_id=lead.id
        AND link.link_type='FORMAL_ORDER' AND link.linked_at<=?) AS formal_order_count,
      EXISTS(SELECT 1 FROM acquisition_lead_links link
        JOIN order_archive_closures closure ON closure.formal_order_id=link.target_id
          AND closure.status='CLOSED' AND closure.business_closed_at<=?
        WHERE link.lead_id=lead.id AND link.link_type='FORMAL_ORDER' AND link.linked_at<=?)
        AS business_completed,
      (SELECT COUNT(*) FROM acquisition_lead_links link
        JOIN order_archive_closures closure ON closure.formal_order_id=link.target_id
          AND closure.status='CLOSED' AND closure.business_closed_at<=?
        WHERE link.lead_id=lead.id AND link.link_type='FORMAL_ORDER' AND link.linked_at<=?)
        AS business_completed_count,
      EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=lead.id
        AND link.link_type='SELLER_ORGANIZATION' AND link.linked_at<=?) AS cooperation
    FROM acquisition_leads lead
    JOIN acquisition_channels channel ON channel.id=lead.origin_channel_id
    JOIN staff_users staff ON staff.id=lead.origin_staff_id
    WHERE lead.status='ACTIVE' AND lead.created_business_date BETWEEN ? AND ?
      AND lead.created_at<=?`)
    .bind(now, now, now, now, now, now, now, now, now, now,
      fromDate, toDate, now).all<LeadRow>();
  return rows.results;
}

async function readConsultations(
  database: SqlDatabase,
  fromDate: string,
  toDate: string,
): Promise<readonly ConsultationRow[]> {
  const rows = await database.prepare(`SELECT consultation.channel_id,
      channel.display_name AS channel_name,consultation.lead_type,
      SUM(consultation.person_count) AS count
    FROM acquisition_daily_consultations consultation
    JOIN acquisition_channels channel ON channel.id=consultation.channel_id
    WHERE consultation.business_date BETWEEN ? AND ?
    GROUP BY consultation.channel_id,channel.display_name,consultation.lead_type`)
    .bind(fromDate, toDate).all<ConsultationRow>();
  return rows.results;
}

async function readProfitRows(
  database: SqlDatabase,
  fromDate: string,
  toDate: string,
  now: number,
): Promise<readonly ProfitRow[]> {
  const rows = await database.prepare(`SELECT formal_order_id,confirmed_business_date,
      review_approved_business_date,projected_gross_profit_cny_fen,
      completed_gross_profit_cny_fen,finance_status
    FROM internal_order_finance_positions
    WHERE (confirmed_business_date BETWEEN ? AND ? AND confirmed_at<=?)
      OR (review_approved_business_date BETWEEN ? AND ? AND review_approved_at<=?)`)
    .bind(fromDate, toDate, now, fromDate, toDate, now).all<ProfitRow>();
  return rows.results;
}

async function readAttribution(
  database: SqlDatabase,
  now: number,
): Promise<readonly AttributionRow[]> {
  const rows = await database.prepare(`SELECT link.target_id AS formal_order_id,
      lead.origin_staff_id,staff.display_name AS origin_staff_name,
      lead.origin_channel_id,channel.display_name AS origin_channel_name
    FROM acquisition_leads lead JOIN acquisition_lead_links link
      ON link.lead_id=lead.id AND link.link_type='FORMAL_ORDER'
    JOIN staff_users staff ON staff.id=lead.origin_staff_id
    JOIN acquisition_channels channel ON channel.id=lead.origin_channel_id
    WHERE lead.status='ACTIVE' AND lead.lead_type='BUYER' AND link.linked_at<=?`)
    .bind(now).all<AttributionRow>();
  return rows.results;
}

async function readCurrentWorkload(
  database: SqlDatabase,
  now: number,
): Promise<readonly { id: string; name: string; count: number }[]> {
  const rows = await database.prepare(`SELECT lead.current_owner_staff_id AS id,
      staff.display_name AS name,COUNT(*) AS count
    FROM acquisition_leads lead JOIN staff_users staff ON staff.id=lead.current_owner_staff_id
    WHERE lead.status='ACTIVE' AND lead.created_at<=?
    GROUP BY lead.current_owner_staff_id,staff.display_name`)
    .bind(now).all<{ id: string; name: string; count: number }>();
  return rows.results.map((row) => ({ ...row, count: Number(row.count) }));
}

async function readPerformanceDimensions(
  database: SqlDatabase,
): Promise<{ staff: readonly NamedDimension[]; channels: readonly NamedDimension[] }> {
  const [staff, channels] = await Promise.all([
    database.prepare(`SELECT id,display_name AS name FROM staff_users
      WHERE status='ACTIVE' ORDER BY display_name,id`).all<NamedDimension>(),
    database.prepare(`SELECT id,display_name AS name FROM acquisition_channels
      WHERE status='ACTIVE' ORDER BY display_name,id`).all<NamedDimension>(),
  ]);
  return { staff: staff.results, channels: channels.results };
}

function funnelStages(
  input: readonly [code: string, label: string, count: number][],
): DashboardFunnelStageDto[] {
  return input.map(([code, label, count], index) => Object.freeze({
    code,
    label,
    count,
    conversion_rate_bps: index === 0 ? null : rate(count, input[index - 1]![2]),
  }));
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.min(10_000, Math.round(numerator * 10_000 / denominator));
}

function performance(
  values: Map<string, MutablePerformance>,
  id: string,
  name: string,
  channel: boolean,
): MutablePerformance {
  let value = values.get(id);
  if (!value) {
    value = {
      dimension_id: id,
      dimension_name: name,
      buyer_lead_count: 0,
      buyer_registered_count: 0,
      buyer_reservation_count: 0,
      buyer_formal_order_count: 0,
      buyer_business_completed_count: 0,
      buyer_no_participation_count: 0,
      seller_lead_count: 0,
      seller_cooperation_count: 0,
      current_owner_active_lead_count: channel ? null : 0,
      consultation_count: channel ? 0 : null,
      projected: emptyProfit(),
      completed: emptyProfit(),
    };
    values.set(id, value);
  } else if (value.dimension_name === id && name !== id) {
    value.dimension_name = name;
  }
  return value;
}

function addLead(target: MutablePerformance, lead: LeadRow): void {
  if (lead.lead_type === 'SELLER') {
    target.seller_lead_count += 1;
    target.seller_cooperation_count += Number(lead.cooperation);
    return;
  }
  target.buyer_lead_count += 1;
  target.buyer_registered_count += Number(lead.registered);
  target.buyer_reservation_count += Number(lead.reservation_count);
  target.buyer_formal_order_count += Number(lead.formal_order_count);
  target.buyer_business_completed_count += Number(lead.business_completed_count);
  target.buyer_no_participation_count += lead.reserved === 1 ? 0 : 1;
}

function finishPerformance(
  input: Map<string, MutablePerformance>,
): readonly DashboardPerformanceDto[] {
  return Object.freeze([...input.values()]
    .sort((left, right) => left.dimension_name.localeCompare(right.dimension_name, 'zh-CN'))
    .map(({ projected, completed, ...value }) => Object.freeze({
      ...value,
      projected_profit: finishProfit(projected),
      completed_profit: finishProfit(completed),
    })));
}

function emptyProfit(): MutableProfit {
  return { amount: 0n, valid: 0, conflicts: 0 };
}

function addProjected(target: MutableProfit, row: ProfitRow): void {
  if ((row.finance_status !== 'PROJECTED_ONLY' && row.finance_status !== 'COMPLETED')
    || row.projected_gross_profit_cny_fen === null) {
    target.conflicts += 1;
    return;
  }
  target.valid += 1;
  target.amount += databaseIntegerToBigInt(row.projected_gross_profit_cny_fen);
}

function addCompleted(target: MutableProfit, row: ProfitRow): void {
  if (row.finance_status !== 'COMPLETED'
    || row.completed_gross_profit_cny_fen === null) {
    target.conflicts += 1;
    return;
  }
  target.valid += 1;
  target.amount += databaseIntegerToBigInt(row.completed_gross_profit_cny_fen);
}

function finishProfit(value: MutableProfit): DashboardProfitDto {
  return Object.freeze({
    amount_cny_fen: value.amount.toString(),
    valid_order_count: value.valid,
    conflict_order_count: value.conflicts,
  });
}

function sumConsultations(
  rows: readonly ConsultationRow[],
  leadType: 'BUYER' | 'SELLER',
): number {
  return rows.filter((row) => row.lead_type === leadType)
    .reduce((sum, row) => sum + Number(row.count), 0);
}

function inside(date: string, range: { from_date: string; to_date: string }): boolean {
  return date >= range.from_date && date <= range.to_date;
}

function drillDownSource(metric: DashboardDrillDownMetric): {
  sql: string;
  bindings: (
    range: ReturnType<typeof dashboardDateRange>,
    now: number,
  ) => readonly unknown[];
} {
  if (metric === 'NEW_BUYERS') return {
    sql: `SELECT id AS reference_id,date(activated_at/1000,'unixepoch','+8 hours') AS business_date,
      'ACTIVE' AS status FROM buyer_customers
      WHERE activated_at>=? AND activated_at<? AND activated_at<=?`,
    bindings: (range, now) => [range.fromEpoch, range.toExclusiveEpoch, now],
  };
  if (metric === 'RESERVATIONS') return {
    sql: `SELECT id AS reference_id,date(submitted_at/1000,'unixepoch','+8 hours') AS business_date,
      status FROM product_reservations
      WHERE submitted_at>=? AND submitted_at<? AND submitted_at<=?`,
    bindings: (range, now) => [range.fromEpoch, range.toExclusiveEpoch, now],
  };
  if (metric === 'FORMAL_ORDERS') return {
    sql: `SELECT id AS reference_id,confirmed_business_date AS business_date,status
      FROM formal_orders WHERE confirmed_business_date BETWEEN ? AND ? AND confirmed_at<=?`,
    bindings: (range, now) => [range.fromDate, range.toDate, now],
  };
  if (metric === 'BUSINESS_COMPLETIONS') return {
    sql: `SELECT formal_order_id AS reference_id,
      date(business_closed_at/1000,'unixepoch','+8 hours') AS business_date,status
      FROM order_archive_closures WHERE status='CLOSED'
        AND business_closed_at>=? AND business_closed_at<? AND business_closed_at<=?`,
    bindings: (range, now) => [range.fromEpoch, range.toExclusiveEpoch, now],
  };
  if (metric === 'PROJECTED_PROFIT_CONFLICTS') return {
    sql: `SELECT formal_order_id AS reference_id,confirmed_business_date AS business_date,
      finance_status AS status FROM internal_order_finance_positions
      WHERE confirmed_business_date BETWEEN ? AND ?
        AND confirmed_at<=? AND (projected_gross_profit_cny_fen IS NULL
          OR finance_status NOT IN ('PROJECTED_ONLY','COMPLETED'))`,
    bindings: (range, now) => [range.fromDate, range.toDate, now],
  };
  return {
    sql: `SELECT formal_order_id AS reference_id,review_approved_business_date AS business_date,
      finance_status AS status FROM internal_order_finance_positions
      WHERE review_approved_business_date BETWEEN ? AND ? AND review_approved_at<=?
        AND (finance_status<>'COMPLETED' OR completed_gross_profit_cny_fen IS NULL)`,
    bindings: (range, now) => [range.fromDate, range.toDate, now],
  };
}

function encodeCursor(value: { business_date: string; reference_id: string }): string {
  return btoa(JSON.stringify(value));
}

function decodeCursor(value: string | null): { business_date: string; reference_id: string } | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(atob(value)) as Record<string, unknown>;
    if (Object.keys(parsed).length !== 2
      || typeof parsed['business_date'] !== 'string'
      || typeof parsed['reference_id'] !== 'string'
      || parsed['business_date'].length !== 10
      || parsed['reference_id'].length < 1
      || parsed['reference_id'].length > 200) throw new Error('invalid_cursor');
    return {
      business_date: parsed['business_date'],
      reference_id: parsed['reference_id'],
    };
  } catch {
    throw new Error('invalid_dashboard_cursor');
  }
}
