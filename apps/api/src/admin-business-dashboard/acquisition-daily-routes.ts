import { apiFailure, apiSuccess, type SqlDatabase } from '@ygb/contracts';
import { parseChinaBusinessDate } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

interface ChannelMetaRow {
  channel_id: string;
  channel_name: string;
  platform_name: string;
  lead_type: 'BUYER' | 'SELLER' | 'BOTH';
  marketplace_code: string;
  staff_label: string | null;
  status: 'ACTIVE' | 'DISABLED';
}
interface CustomerRow {
  business_date: string;
  channel_id: string;
  lead_type: 'BUYER' | 'SELLER';
  count: number;
}
interface OrderRow {
  business_date: string;
  channel_id: string;
  lead_type: 'BUYER' | 'SELLER';
  count: number;
}
interface DailyCountRow {
  business_date: string;
  count: number;
}
interface GapRow {
  business_date: string;
  historical_count: number;
  anomaly_count: number;
}

export function registerAdminAcquisitionDailyRoutes(app: Hono<any>): void {
  app.get('/api/staff/admin-business-dashboard/acquisition-daily', async (context) => {
    const requestId = String(context.get('requestId') ?? crypto.randomUUID());
    try {
      const actor = requireOwner(context);
      if (!actor.permissions.has('FINANCIAL_VIEW')) return forbidden(context, requestId);
      const url = new URL(context.req.url);
      if ([...url.searchParams.keys()].some((key) => !['from_date', 'to_date'].includes(key)))
        throw new Error('INVALID_QUERY');
      const from = parseDate(url.searchParams.get('from_date')),
        to = parseDate(url.searchParams.get('to_date'));
      if (from > to || dayDistance(from, to) > 366) throw new Error('INVALID_RANGE');
      const data = await readDaily(context.env.DB, from, to);
      context.header('Cache-Control', 'no-store');
      return context.json(apiSuccess(data, requestId));
    } catch (error) {
      if (error instanceof Error && error.message === 'FORBIDDEN')
        return forbidden(context, requestId);
      if (error instanceof Error && ['INVALID_QUERY', 'INVALID_RANGE'].includes(error.message))
        return context.json(apiFailure('VALIDATION_ERROR', '日期范围不正确', requestId), 400);
      return context.json(
        apiFailure('DEPENDENCY_UNAVAILABLE', '经营数据暂时无法加载', requestId),
        503,
      );
    }
  });
}

async function readDaily(database: SqlDatabase, from: string, to: string) {
  const config = await database
    .prepare(
      `SELECT precision_started_business_date FROM acquisition_reporting_config WHERE singleton_id=1`,
    )
    .first<{ precision_started_business_date: string | null }>();
  const precisionDate = config?.precision_started_business_date ?? null;
  const [
    channelRows,
    customerRows,
    buyerOrderRows,
    sellerOrderRows,
    buyerRegistrations,
    sellerRegistrations,
    formalOrders,
    buyerGaps,
    sellerGaps,
    distinctAttributionAnomalies,
    identityConflicts,
    financeConflicts,
  ] = await Promise.all([
    database
      .prepare(
        `SELECT channel.id AS channel_id,channel.display_name AS channel_name,channel.platform_name,channel.lead_type,channel.marketplace_code,privacy.staff_label,channel.status
      FROM acquisition_channels channel LEFT JOIN acquisition_channel_privacy_profiles privacy ON privacy.channel_id=channel.id
      ORDER BY channel.marketplace_code,channel.lead_type,channel.display_name,channel.id`,
      )
      .all<ChannelMetaRow>(),
    database
      .prepare(
        `SELECT fact.business_date,
        COALESCE((SELECT correction.new_channel_id FROM acquisition_lead_source_corrections correction WHERE correction.lead_id=fact.lead_id ORDER BY correction.corrected_at DESC,correction.id DESC LIMIT 1),fact.original_channel_id) AS channel_id,
        fact.lead_type,COUNT(*) AS count FROM acquisition_customer_intake_facts fact WHERE fact.business_date BETWEEN ? AND ? GROUP BY fact.business_date,channel_id,fact.lead_type`,
      )
      .bind(from, to)
      .all<CustomerRow>(),
    attributedOrders(database, 'BUYER', from, to),
    attributedOrders(database, 'SELLER', from, to),
    buyerPortalRegistrationQuery(database, from, to),
    sellerPortalRegistrationQuery(database, from, to),
    database
      .prepare(
        `SELECT confirmed_business_date AS business_date,COUNT(*) AS count FROM formal_orders WHERE confirmed_business_date BETWEEN ? AND ? GROUP BY confirmed_business_date`,
      )
      .bind(from, to)
      .all<DailyCountRow>(),
    attributionGaps(database, 'BUYER', from, to, precisionDate),
    attributionGaps(database, 'SELLER', from, to, precisionDate),
    distinctAttributionAnomalyCount(database, from, to, precisionDate),
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM customer_identity_resolution_cases WHERE status='OPEN'`,
      )
      .first<{ count: number }>(),
    database
      .prepare(
        `SELECT COUNT(DISTINCT formal_order_id) AS count FROM internal_order_finance_positions WHERE confirmed_business_date BETWEEN ? AND ? AND (
      projected_gross_profit_cny_fen IS NULL OR finance_status NOT IN ('PROJECTED_ONLY','COMPLETED') OR (review_approved_business_date IS NOT NULL AND (completed_gross_profit_cny_fen IS NULL OR finance_status<>'COMPLETED'))
    )`,
      )
      .bind(from, to)
      .first<{ count: number }>(),
  ]);
  const meta = new Map<string, ChannelMetaRow>(
      channelRows.results.map((row) => [row.channel_id, row]),
    ),
    customerMap = new Map<string, number>();
  for (const row of customerRows.results)
    customerMap.set(key(row.business_date, row.channel_id, row.lead_type), Number(row.count));
  const orderMap = new Map<string, number>();
  for (const row of [...buyerOrderRows.results, ...sellerOrderRows.results])
    orderMap.set(key(row.business_date, row.channel_id, row.lead_type), Number(row.count));
  const buyerRegistrationMap = countMap(buyerRegistrations.results),
    sellerRegistrationMap = countMap(sellerRegistrations.results),
    formalOrderMap = countMap(formalOrders.results),
    buyerGapMap = gapMap(buyerGaps.results),
    sellerGapMap = gapMap(sellerGaps.results),
    days = dateList(from, to);
  const daily = days.map((business_date) => {
    const buyerGap = buyerGapMap.get(business_date) ?? { historical: 0, anomaly: 0 },
      sellerGap = sellerGapMap.get(business_date) ?? { historical: 0, anomaly: 0 };
    return {
      business_date,
      new_buyer_customers: sumCustomers(customerRows.results, business_date, 'BUYER'),
      new_seller_customers: sumCustomers(customerRows.results, business_date, 'SELLER'),
      buyer_portal_registrations: buyerRegistrationMap.get(business_date) ?? 0,
      seller_portal_registrations: sellerRegistrationMap.get(business_date) ?? 0,
      formal_orders: formalOrderMap.get(business_date) ?? 0,
      buyer_historical_unknown_orders: buyerGap.historical,
      seller_historical_unknown_orders: sellerGap.historical,
      buyer_attribution_anomaly_orders: buyerGap.anomaly,
      seller_attribution_anomaly_orders: sellerGap.anomaly,
    };
  });
  const channelDaily: {
    business_date: string;
    channel_id: string;
    channel_name: string;
    channel_label: string;
    platform_name: string;
    channel_status: 'ACTIVE' | 'DISABLED';
    lead_type: 'BUYER' | 'SELLER';
    marketplace_code: string;
    new_customer_count: number;
    formal_order_count: number;
  }[] = [];
  for (const business_date of days) {
    for (const channel of meta.values()) {
      const leadTypes: readonly ('BUYER' | 'SELLER')[] =
        channel.lead_type === 'BOTH' ? ['BUYER', 'SELLER'] : [channel.lead_type];
      for (const leadType of leadTypes) {
        const newCustomerCount =
            customerMap.get(key(business_date, channel.channel_id, leadType)) ?? 0,
          formalOrderCount = orderMap.get(key(business_date, channel.channel_id, leadType)) ?? 0;
        if (newCustomerCount === 0 && formalOrderCount === 0) continue;
        channelDaily.push({
          business_date,
          channel_id: channel.channel_id,
          channel_name: channel.channel_name,
          channel_label: channel.staff_label ?? '未配置',
          platform_name: channel.platform_name,
          channel_status: channel.status,
          lead_type: leadType,
          marketplace_code: channel.marketplace_code,
          new_customer_count: newCustomerCount,
          formal_order_count: formalOrderCount,
        });
      }
    }
  }
  const totals = {
    new_buyer_customers: sum(daily, 'new_buyer_customers'),
    new_seller_customers: sum(daily, 'new_seller_customers'),
    buyer_portal_registrations: sum(daily, 'buyer_portal_registrations'),
    seller_portal_registrations: sum(daily, 'seller_portal_registrations'),
    formal_orders: sum(daily, 'formal_orders'),
    buyer_historical_unknown_orders: sum(daily, 'buyer_historical_unknown_orders'),
    seller_historical_unknown_orders: sum(daily, 'seller_historical_unknown_orders'),
    buyer_attribution_anomaly_orders: sum(daily, 'buyer_attribution_anomaly_orders'),
    seller_attribution_anomaly_orders: sum(daily, 'seller_attribution_anomaly_orders'),
  };
  return Object.freeze({
    from_date: from,
    to_date: to,
    timezone: 'Asia/Shanghai' as const,
    data_as_of: Date.now(),
    reporting_precision: Object.freeze({
      configured: precisionDate !== null,
      business_date: precisionDate,
    }),
    anomalies: Object.freeze({
      identity_conflicts: Number(identityConflicts?.count ?? 0),
      attribution_anomalies: Number(distinctAttributionAnomalies?.count ?? 0),
      buyer_attribution_gaps: totals.buyer_attribution_anomaly_orders,
      seller_attribution_gaps: totals.seller_attribution_anomaly_orders,
      finance_conflicts: Number(financeConflicts?.count ?? 0),
    }),
    totals: Object.freeze(totals),
    daily: Object.freeze(daily),
    channel_daily: Object.freeze(channelDaily),
  });
}

function distinctAttributionAnomalyCount(
  database: SqlDatabase,
  from: string,
  to: string,
  precisionDate: string | null,
) {
  if (precisionDate === null) return Promise.resolve({ count: 0 });
  return database
    .prepare(
      `SELECT COUNT(*) AS count FROM formal_orders formal_order
    WHERE formal_order.confirmed_business_date BETWEEN ? AND ? AND formal_order.confirmed_business_date>=?
      AND (
        (NOT EXISTS(SELECT 1 FROM acquisition_customer_attributions attribution WHERE attribution.subject_type='BUYER_CUSTOMER' AND attribution.subject_id=formal_order.buyer_customer_id)
          AND NOT EXISTS(SELECT 1 FROM acquisition_historical_source_exemptions exemption WHERE exemption.subject_type='BUYER_CUSTOMER' AND exemption.subject_id=formal_order.buyer_customer_id))
        OR
        (NOT EXISTS(SELECT 1 FROM acquisition_customer_attributions attribution WHERE attribution.subject_type='SELLER_ORGANIZATION' AND attribution.subject_id=formal_order.seller_organization_id)
          AND NOT EXISTS(SELECT 1 FROM acquisition_historical_source_exemptions exemption WHERE exemption.subject_type='SELLER_ORGANIZATION' AND exemption.subject_id=formal_order.seller_organization_id))
      )`,
    )
    .bind(from, to, precisionDate)
    .first<{ count: number }>();
}
function attributedOrders(
  database: SqlDatabase,
  type: 'BUYER' | 'SELLER',
  from: string,
  to: string,
) {
  const subjectType = type === 'BUYER' ? 'BUYER_CUSTOMER' : 'SELLER_ORGANIZATION',
    foreignKey = type === 'BUYER' ? 'buyer_customer_id' : 'seller_organization_id';
  return database
    .prepare(
      `SELECT formal_order.confirmed_business_date AS business_date,COALESCE((SELECT correction.new_channel_id FROM acquisition_lead_source_corrections correction WHERE correction.lead_id=attribution.lead_id ORDER BY correction.corrected_at DESC,correction.id DESC LIMIT 1),attribution.origin_channel_id) AS channel_id,? AS lead_type,COUNT(DISTINCT formal_order.id) AS count FROM formal_orders formal_order JOIN acquisition_customer_attributions attribution ON attribution.subject_type=? AND attribution.subject_id=formal_order.${foreignKey} WHERE formal_order.confirmed_business_date BETWEEN ? AND ? GROUP BY formal_order.confirmed_business_date,channel_id`,
    )
    .bind(type, subjectType, from, to)
    .all<OrderRow>();
}
function attributionGaps(
  database: SqlDatabase,
  type: 'BUYER' | 'SELLER',
  from: string,
  to: string,
  precisionDate: string | null,
) {
  const subjectType = type === 'BUYER' ? 'BUYER_CUSTOMER' : 'SELLER_ORGANIZATION',
    foreignKey = type === 'BUYER' ? 'buyer_customer_id' : 'seller_organization_id';
  return database
    .prepare(
      `SELECT formal_order.confirmed_business_date AS business_date,SUM(CASE WHEN exemption.subject_id IS NOT NULL OR ? IS NULL OR formal_order.confirmed_business_date<? THEN 1 ELSE 0 END) AS historical_count,SUM(CASE WHEN exemption.subject_id IS NULL AND ? IS NOT NULL AND formal_order.confirmed_business_date>=? THEN 1 ELSE 0 END) AS anomaly_count FROM formal_orders formal_order LEFT JOIN acquisition_customer_attributions attribution ON attribution.subject_type=? AND attribution.subject_id=formal_order.${foreignKey} LEFT JOIN acquisition_historical_source_exemptions exemption ON exemption.subject_type=? AND exemption.subject_id=formal_order.${foreignKey} WHERE formal_order.confirmed_business_date BETWEEN ? AND ? AND attribution.id IS NULL GROUP BY formal_order.confirmed_business_date`,
    )
    .bind(
      precisionDate,
      precisionDate ?? '',
      precisionDate,
      precisionDate ?? '',
      subjectType,
      subjectType,
      from,
      to,
    )
    .all<GapRow>();
}
function buyerPortalRegistrationQuery(database: SqlDatabase, from: string, to: string) {
  return database
    .prepare(
      `SELECT date(invitation.consumed_at/1000,'unixepoch','+8 hours') AS business_date,COUNT(DISTINCT invitation.id) AS count FROM customer_buyer_invitations invitation WHERE invitation.status='CONSUMED' AND invitation.consumed_at IS NOT NULL AND date(invitation.consumed_at/1000,'unixepoch','+8 hours') BETWEEN ? AND ? GROUP BY date(invitation.consumed_at/1000,'unixepoch','+8 hours')`,
    )
    .bind(from, to)
    .all<DailyCountRow>();
}
function sellerPortalRegistrationQuery(database: SqlDatabase, from: string, to: string) {
  return database
    .prepare(
      `SELECT date(invitation.consumed_at/1000,'unixepoch','+8 hours') AS business_date,COUNT(DISTINCT invitation.seller_organization_id) AS count FROM customer_seller_invitations invitation WHERE invitation.status='CONSUMED' AND invitation.consumed_at IS NOT NULL AND date(invitation.consumed_at/1000,'unixepoch','+8 hours') BETWEEN ? AND ? GROUP BY date(invitation.consumed_at/1000,'unixepoch','+8 hours')`,
    )
    .bind(from, to)
    .all<DailyCountRow>();
}
function requireOwner(context: Context<any>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as AssignmentStaffAuthorization | undefined;
  if (!actor || !actor.roles.has('owner')) throw new Error('FORBIDDEN');
  return actor;
}
function forbidden(context: Context<any>, requestId: string) {
  return context.json(apiFailure('FORBIDDEN', '只有总管理员可以查看该经营数据', requestId), 403);
}
function parseDate(value: string | null): string {
  if (!value) throw new Error('INVALID_QUERY');
  try {
    return parseChinaBusinessDate(value);
  } catch {
    throw new Error('INVALID_QUERY');
  }
}
function key(date: string, channel: string, type: string) {
  return `${date}:${channel}:${type}`;
}
function countMap(rows: readonly DailyCountRow[]): Map<string, number> {
  return new Map(rows.map((row) => [row.business_date, Number(row.count)]));
}
function gapMap(rows: readonly GapRow[]): Map<string, { historical: number; anomaly: number }> {
  return new Map(
    rows.map((row) => [
      row.business_date,
      { historical: Number(row.historical_count ?? 0), anomaly: Number(row.anomaly_count ?? 0) },
    ]),
  );
}
function sumCustomers(rows: readonly CustomerRow[], date: string, type: 'BUYER' | 'SELLER') {
  return rows
    .filter((row) => row.business_date === date && row.lead_type === type)
    .reduce((total, row) => total + Number(row.count), 0);
}
function sum<T extends Record<string, unknown>, K extends keyof T>(rows: readonly T[], keyName: K) {
  return rows.reduce((total, row) => total + Number(row[keyName] ?? 0), 0);
}
function dateList(from: string, to: string): string[] {
  const result: string[] = [];
  let current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (current <= end) {
    result.push(current.toISOString().slice(0, 10));
    current = new Date(current.getTime() + 86_400_000);
  }
  return result;
}
function dayDistance(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
