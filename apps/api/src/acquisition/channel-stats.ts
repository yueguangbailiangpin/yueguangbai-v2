import type { SqlDatabase } from '@ygb/contracts';
import { chinaBusinessDateStartEpoch, parseChinaBusinessDate } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { listAcquisitionChannels } from './admin';
import { requireAcquisitionOperator } from './authorization';
import { validation } from './errors';

export interface AcquisitionChannelStatsDto {
  channel_id: string;
  channel_name: string;
  platform_name: string;
  channel_status: 'ACTIVE' | 'DISABLED';
  lead_type: 'BUYER' | 'SELLER' | 'BOTH';
  marketplace_code: string;
  consultation_count: number | null;
  consultation_data_complete: boolean;
  consultation_days_recorded: number;
  consultation_days_expected: number;
  prospect_count: number;
  codex_prospect_count: number;
  lead_count: number;
  registered_count: number;
  reservation_submitted_count: number;
  cooperation_count: number;
  formal_order_count: number;
  buyer_formal_order_count: number;
  seller_formal_order_count: number;
  buyer_projected_gross_profit_cny_fen: string | null;
  buyer_completed_gross_profit_cny_fen: string | null;
  seller_projected_gross_profit_cny_fen: string | null;
  seller_completed_gross_profit_cny_fen: string | null;
}
export interface OrderFinanceRow {
  formal_order_id: string;
  projected: string | null;
  completed: string | null;
}

export async function readAcquisitionChannelStats(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  input: { fromDate: string; toDate: string },
): Promise<readonly AcquisitionChannelStatsDto[]> {
  requireAcquisitionOperator(actor);
  let from: string, to: string;
  try {
    from = parseChinaBusinessDate(input.fromDate);
    to = parseChinaBusinessDate(input.toDate);
  } catch {
    validation();
  }
  if (from > to) validation();
  const fromEpoch = chinaBusinessDateStartEpoch(from),
    toExclusive = chinaBusinessDateStartEpoch(to) + 24 * 60 * 60 * 1000;
  // Disabled channels remain in historical reporting. Disabling only stops future intake.
  const channels = await listAcquisitionChannels(database, actor);
  const result: AcquisitionChannelStatsDto[] = [];
  for (const channel of channels) {
    const meta = await database
      .prepare(`SELECT created_at,disabled_at,status FROM acquisition_channels WHERE id=?`)
      .bind(channel.channel_id)
      .first<{ created_at: number; disabled_at: number | null; status: 'ACTIVE' | 'DISABLED' }>();
    if (!meta) continue;
    const expected = expectedConsultationDays(
      from,
      to,
      Number(meta.created_at),
      meta.disabled_at === null ? null : Number(meta.disabled_at),
    );
    const consultation = await database
      .prepare(
        `SELECT COALESCE(SUM(person_count),0) AS total,COUNT(*) AS days
      FROM acquisition_daily_consultations WHERE channel_id=? AND business_date BETWEEN ? AND ?`,
      )
      .bind(channel.channel_id, from, to)
      .first<{ total: number; days: number }>();
    const recorded = Number(consultation?.days ?? 0);
    const consultationComplete = channel.lead_type !== 'BOTH' && recorded === expected;
    const prospect = await database
      .prepare(
        `SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN origin_mode='CODEX' THEN 1 ELSE 0 END),0) AS codex
      FROM acquisition_prospects WHERE origin_channel_id=? AND discovered_at>=? AND discovered_at<?`,
      )
      .bind(channel.channel_id, fromEpoch, toExclusive)
      .first<{ total: number; codex: number }>();
    const lead = await database
      .prepare(
        `SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM acquisition_lead_links link
        WHERE link.lead_id=fact.lead_id AND link.link_type='BUYER_CUSTOMER') THEN 1 ELSE 0 END),0) AS registered,
      COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM acquisition_lead_links link
        WHERE link.lead_id=fact.lead_id AND link.link_type='RESERVATION') THEN 1 ELSE 0 END),0) AS reserved,
      COALESCE(SUM(CASE WHEN fact.lead_type='SELLER' AND ${sellerCooperationSql('fact.lead_id')} THEN 1 ELSE 0 END),0) AS cooperation
      FROM acquisition_customer_intake_facts fact
      WHERE COALESCE((SELECT correction.new_channel_id FROM acquisition_lead_source_corrections correction
        WHERE correction.lead_id=fact.lead_id ORDER BY correction.corrected_at DESC,correction.id DESC LIMIT 1),fact.original_channel_id)=?
        AND fact.business_date BETWEEN ? AND ?`,
      )
      .bind(channel.channel_id, from, to)
      .first<{ total: number; registered: number; reserved: number; cooperation: number }>();
    const buyerOrders =
      channel.lead_type === 'SELLER'
        ? []
        : await ordersForChannel(database, 'BUYER', channel.channel_id, from, to);
    const sellerOrders =
      channel.lead_type === 'BUYER'
        ? []
        : await ordersForChannel(database, 'SELLER', channel.channel_id, from, to);
    const allOrderIds = new Set<string>(
      [...buyerOrders, ...sellerOrders].map((row) => row.formal_order_id),
    );
    const buyerProfit = channelProfitForActor(actor, buyerOrders),
      sellerProfit = channelProfitForActor(actor, sellerOrders);
    result.push({
      channel_id: channel.channel_id,
      channel_name: channel.display_name,
      platform_name: channel.platform_name,
      channel_status: meta.status,
      lead_type: channel.lead_type,
      marketplace_code: channel.marketplace_code,
      consultation_count: consultationComplete ? Number(consultation?.total ?? 0) : null,
      consultation_data_complete: consultationComplete,
      consultation_days_recorded: recorded,
      consultation_days_expected: expected,
      prospect_count: Number(prospect?.total ?? 0),
      codex_prospect_count: Number(prospect?.codex ?? 0),
      lead_count: Number(lead?.total ?? 0),
      registered_count: Number(lead?.registered ?? 0),
      reservation_submitted_count: Number(lead?.reserved ?? 0),
      cooperation_count: Number(lead?.cooperation ?? 0),
      formal_order_count: allOrderIds.size,
      buyer_formal_order_count: new Set(buyerOrders.map((row) => row.formal_order_id)).size,
      seller_formal_order_count: new Set(sellerOrders.map((row) => row.formal_order_id)).size,
      buyer_projected_gross_profit_cny_fen: buyerProfit.projected,
      buyer_completed_gross_profit_cny_fen: buyerProfit.completed,
      seller_projected_gross_profit_cny_fen: sellerProfit.projected,
      seller_completed_gross_profit_cny_fen: sellerProfit.completed,
    });
  }
  return Object.freeze(result);
}

async function ordersForChannel(
  database: SqlDatabase,
  type: 'BUYER' | 'SELLER',
  channelId: string,
  from: string,
  to: string,
): Promise<OrderFinanceRow[]> {
  const subjectType = type === 'BUYER' ? 'BUYER_CUSTOMER' : 'SELLER_ORGANIZATION';
  const foreignKey = type === 'BUYER' ? 'buyer_customer_id' : 'seller_organization_id';
  const rows = await database
    .prepare(
      `SELECT DISTINCT finance.formal_order_id,
      CAST(finance.projected_gross_profit_cny_fen AS TEXT) AS projected,
      CAST(finance.completed_gross_profit_cny_fen AS TEXT) AS completed
    FROM formal_orders formal_order
    JOIN acquisition_customer_attributions attribution
      ON attribution.subject_type=? AND attribution.subject_id=formal_order.${foreignKey}
    JOIN internal_order_finance_positions finance ON finance.formal_order_id=formal_order.id
    WHERE COALESCE((SELECT correction.new_channel_id FROM acquisition_lead_source_corrections correction
        WHERE correction.lead_id=attribution.lead_id ORDER BY correction.corrected_at DESC,correction.id DESC LIMIT 1),
        attribution.origin_channel_id)=?
      AND finance.confirmed_business_date BETWEEN ? AND ?`,
    )
    .bind(subjectType, channelId, from, to)
    .all<OrderFinanceRow>();
  return rows.results;
}
function sellerCooperationSql(leadExpression: string) {
  return `EXISTS(
  SELECT 1 FROM acquisition_lead_links seller_link
  WHERE seller_link.lead_id=${leadExpression} AND seller_link.link_type='SELLER_ORGANIZATION'
    AND (
      EXISTS(SELECT 1 FROM products product WHERE product.organization_id=seller_link.target_id)
      OR EXISTS(SELECT 1 FROM product_applications application WHERE application.organization_id=seller_link.target_id)
      OR EXISTS(SELECT 1 FROM demand_batches demand WHERE demand.organization_id=seller_link.target_id)
      OR EXISTS(SELECT 1 FROM formal_orders formal_order WHERE formal_order.seller_organization_id=seller_link.target_id)
    )
)`;
}
export function channelProfitForActor(
  actor: Pick<AssignmentStaffAuthorization, 'roles' | 'permissions'>,
  rows: readonly OrderFinanceRow[],
) {
  if (!actor.roles.has('owner') || !actor.permissions.has('FINANCIAL_VIEW'))
    return { projected: null, completed: null };
  let projected = 0n,
    completed = 0n,
    hasProjected = false,
    hasCompleted = false;
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.formal_order_id)) continue;
    seen.add(row.formal_order_id);
    if (row.projected !== null) {
      projected += BigInt(row.projected);
      hasProjected = true;
    }
    if (row.completed !== null) {
      completed += BigInt(row.completed);
      hasCompleted = true;
    }
  }
  return {
    projected: hasProjected ? projected.toString() : null,
    completed: hasCompleted ? completed.toString() : null,
  };
}
function expectedConsultationDays(
  from: string,
  to: string,
  createdAt: number,
  disabledAt: number | null,
) {
  const created = shanghaiDate(createdAt),
    disabled = disabledAt === null ? null : shanghaiDate(disabledAt);
  const start = created > from ? created : from;
  const end = disabled !== null && disabled < to ? disabled : to;
  if (start > end) return 0;
  return (
    Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
  );
}
function shanghaiDate(epoch: number) {
  return new Date(epoch + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
