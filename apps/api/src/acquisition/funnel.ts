import type { AcquisitionFunnelDto, SqlDatabase } from '@ygb/contracts';
import { parseChinaBusinessDate } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { visibleLeadTypes } from './authorization';
import { validation } from './errors';

interface CountRow {
  added: number; registered: number; reserved: number;
  no_participation: number; formal_orders: number; cooperation: number;
}

export async function readAcquisitionFunnel(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  input: { fromDate: string; toDate: string },
): Promise<AcquisitionFunnelDto> {
  let from: string; let to: string;
  try { from = parseChinaBusinessDate(input.fromDate); to = parseChinaBusinessDate(input.toDate); }
  catch { validation(); }
  if (from > to) validation();
  const types = visibleLeadTypes(actor);
  const buyer = types.includes('BUYER')
    ? await counts(database, actor, 'BUYER', from, to) : null;
  const seller = types.includes('SELLER')
    ? await counts(database, actor, 'SELLER', from, to) : null;
  const buyerConsultationCount = types.includes('BUYER')
    ? await consultations(database, actor, 'BUYER', from, to) : 0;
  const sellerConsultationCount = types.includes('SELLER')
    ? await consultations(database, actor, 'SELLER', from, to) : 0;
  let projected: string|null = null;
  let completed: string|null = null;
  if (buyer && actor.roles.has('owner')
    && actor.permissions.has('FINANCIAL_VIEW')) {
    const profit = await buyerProfit(database, from, to);
    projected = profit.projected;
    completed = profit.completed;
  }
  return {
    from_date: from, to_date: to, data_as_of: Date.now(),
    buyer: buyer ? {
      consultation_count: buyerConsultationCount,
      wechat_added_count: buyer.added,
      registered_count: buyer.registered,
      reservation_submitted_count: buyer.reserved,
      no_participation_count: buyer.no_participation,
      formal_order_count: buyer.formal_orders,
      projected_gross_profit_cny_fen: projected,
      completed_gross_profit_cny_fen: completed,
    } : null,
    seller: seller ? {
      consultation_count: sellerConsultationCount,
      wechat_added_count: seller.added,
      cooperation_count: seller.cooperation,
    } : null,
  };
}

async function counts(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  type: 'BUYER'|'SELLER',
  from: string,
  to: string,
): Promise<CountRow> {
  const scope = scopeSql(actor, 'lead');
  const row = await database.prepare(`SELECT
    COUNT(*) AS added,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM acquisition_lead_links link
      WHERE link.lead_id=lead.id AND link.link_type='BUYER_CUSTOMER')
      THEN 1 ELSE 0 END) AS registered,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM acquisition_lead_links link
      WHERE link.lead_id=lead.id AND link.link_type='RESERVATION')
      THEN 1 ELSE 0 END) AS reserved,
    SUM(CASE WHEN lead.lead_type='BUYER' AND NOT EXISTS (
      SELECT 1 FROM acquisition_lead_links link
      WHERE link.lead_id=lead.id AND link.link_type='RESERVATION'
    ) THEN 1 ELSE 0 END) AS no_participation,
    SUM((SELECT COUNT(*) FROM acquisition_lead_links link
      WHERE link.lead_id=lead.id AND link.link_type='FORMAL_ORDER')) AS formal_orders,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM acquisition_lead_links link
      WHERE link.lead_id=lead.id AND link.link_type='SELLER_ORGANIZATION')
      THEN 1 ELSE 0 END) AS cooperation
    FROM acquisition_leads lead
    WHERE lead.status='ACTIVE' AND lead.lead_type=?
      AND lead.created_business_date BETWEEN ? AND ? AND ${scope.sql}`)
    .bind(type, from, to, ...scope.bindings).first<CountRow>();
  return {
    added: Number(row?.added ?? 0), registered: Number(row?.registered ?? 0),
    reserved: Number(row?.reserved ?? 0),
    no_participation: Number(row?.no_participation ?? 0),
    formal_orders: Number(row?.formal_orders ?? 0),
    cooperation: Number(row?.cooperation ?? 0),
  };
}

async function consultations(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  leadType: 'BUYER'|'SELLER',
  from: string,
  to: string,
): Promise<number> {
  if (actor.roles.has('owner')) {
    const row = await database.prepare(`SELECT COALESCE(SUM(person_count),0) AS count
      FROM acquisition_daily_consultations
      WHERE lead_type=? AND business_date BETWEEN ? AND ?`)
      .bind(leadType,from,to).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }
  const row = await database.prepare(`SELECT COALESCE(SUM(consultation.person_count),0) AS count
    FROM acquisition_daily_consultations consultation
    WHERE consultation.business_date BETWEEN ? AND ?
      AND consultation.lead_type=?
      AND EXISTS (
        SELECT 1 FROM acquisition_staff_channel_assignments assignment
        WHERE assignment.channel_id=consultation.channel_id
          AND assignment.staff_id=? AND assignment.status='ACTIVE'
          AND assignment.lead_type=consultation.lead_type
      )`).bind(from,to,leadType,actor.staffId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function buyerProfit(
  database: SqlDatabase,
  from: string,
  to: string,
): Promise<{ projected: string; completed: string }> {
  const rows = await database.prepare(`SELECT DISTINCT
    finance.formal_order_id,finance.projected_gross_profit_cny_fen,
    finance.completed_gross_profit_cny_fen
    FROM acquisition_leads lead
    JOIN acquisition_lead_links link ON link.lead_id=lead.id
      AND link.link_type='FORMAL_ORDER'
    JOIN internal_order_finance_positions finance
      ON finance.formal_order_id=link.target_id
    WHERE lead.status='ACTIVE' AND lead.lead_type='BUYER'
      AND lead.created_business_date BETWEEN ? AND ?`).bind(from,to).all<{
        projected_gross_profit_cny_fen: string|null;
        completed_gross_profit_cny_fen: string|null;
      }>();
  let projected = 0n; let completed = 0n;
  for (const row of rows.results) {
    if (row.projected_gross_profit_cny_fen !== null) {
      projected += BigInt(row.projected_gross_profit_cny_fen);
    }
    if (row.completed_gross_profit_cny_fen !== null) {
      completed += BigInt(row.completed_gross_profit_cny_fen);
    }
  }
  return { projected: projected.toString(), completed: completed.toString() };
}

function scopeSql(actor: AssignmentStaffAuthorization, alias: string) {
  if (actor.roles.has('owner')) return { sql: '1=1', bindings: [] as unknown[] };
  const teamIds = actor.permissions.has('TASK_VIEW_TEAM') ? actor.leaderTeamIds : [];
  const placeholders = teamIds.length ? teamIds.map(() => '?').join(',') : "''";
  return {
    sql: `(${alias}.origin_staff_id=? OR ${alias}.current_owner_staff_id=?
      OR EXISTS (SELECT 1 FROM staff_team_memberships membership
        WHERE membership.staff_id IN (${alias}.origin_staff_id,${alias}.current_owner_staff_id)
          AND membership.status='ACTIVE' AND membership.team_id IN (${placeholders})))`,
    bindings: [actor.staffId, actor.staffId, ...teamIds] as unknown[],
  };
}
