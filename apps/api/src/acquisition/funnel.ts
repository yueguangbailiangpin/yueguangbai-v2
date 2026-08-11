import type { AcquisitionFunnelDto, AcquisitionLeadType, SqlDatabase } from '@ygb/contracts';
import { parseChinaBusinessDate } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import { validation } from './errors';

interface CountRow {added:number;registered:number;reserved:number;no_participation:number;formal_orders:number;cooperation:number}

export async function readAcquisitionFunnel(
  database:SqlDatabase,actor:AssignmentStaffAuthorization,input:{fromDate:string;toDate:string},
):Promise<AcquisitionFunnelDto>{
  let from:string,to:string;try{from=parseChinaBusinessDate(input.fromDate);to=parseChinaBusinessDate(input.toDate);}catch{validation();}
  if(from>to)validation();const types=visibleTypes(actor),markets=actor.roles.has('owner')?[]:await resolveStaffMarketplaceCodes(database,actor);
  const buyer=types.includes('BUYER')?await counts(database,'BUYER',from,to,markets):null;
  const seller=types.includes('SELLER')?await counts(database,'SELLER',from,to,markets):null;
  const buyerConsultationCount=types.includes('BUYER')?await consultations(database,'BUYER',from,to,markets):0;
  const sellerConsultationCount=types.includes('SELLER')?await consultations(database,'SELLER',from,to,markets):0;
  let projected:string|null=null,completed:string|null=null;
  if(buyer&&actor.roles.has('owner')&&actor.permissions.has('FINANCIAL_VIEW')){const profit=await buyerProfit(database,from,to);projected=profit.projected;completed=profit.completed;}
  return{from_date:from,to_date:to,data_as_of:Date.now(),buyer:buyer?{
    consultation_count:buyerConsultationCount,wechat_added_count:buyer.added,registered_count:buyer.registered,
    reservation_submitted_count:buyer.reserved,no_participation_count:buyer.no_participation,formal_order_count:buyer.formal_orders,
    projected_gross_profit_cny_fen:projected,completed_gross_profit_cny_fen:completed}:null,
    seller:seller?{consultation_count:sellerConsultationCount,wechat_added_count:seller.added,cooperation_count:seller.cooperation}:null};
}
function visibleTypes(actor:AssignmentStaffAuthorization):AcquisitionLeadType[]{if(actor.roles.has('owner')||actor.roles.has('acquisition'))return['BUYER','SELLER'];if(actor.roles.has('pre_sales'))return['BUYER'];if(actor.roles.has('seller_ops'))return['SELLER'];validation();}
async function counts(database:SqlDatabase,type:'BUYER'|'SELLER',from:string,to:string,markets:readonly string[]):Promise<CountRow>{
  const marketSql=markets.length?`AND fact.marketplace_code IN (${markets.map(()=>'?').join(',')})`:'';
  const row=await database.prepare(`SELECT COUNT(*) AS added,
    SUM(CASE WHEN EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=fact.lead_id AND link.link_type='BUYER_CUSTOMER') THEN 1 ELSE 0 END) AS registered,
    SUM(CASE WHEN EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=fact.lead_id AND link.link_type='RESERVATION') THEN 1 ELSE 0 END) AS reserved,
    SUM(CASE WHEN fact.lead_type='BUYER' AND NOT EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=fact.lead_id AND link.link_type='RESERVATION') THEN 1 ELSE 0 END) AS no_participation,
    SUM((SELECT COUNT(*) FROM acquisition_lead_links link WHERE link.lead_id=fact.lead_id AND link.link_type='FORMAL_ORDER')) AS formal_orders,
    SUM(CASE WHEN EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=fact.lead_id AND link.link_type='SELLER_ORGANIZATION') THEN 1 ELSE 0 END) AS cooperation
    FROM acquisition_customer_intake_facts fact
    WHERE fact.lead_type=? AND fact.business_date BETWEEN ? AND ? ${marketSql}`)
    .bind(type,from,to,...markets).first<CountRow>();
  return{added:Number(row?.added??0),registered:Number(row?.registered??0),reserved:Number(row?.reserved??0),no_participation:Number(row?.no_participation??0),formal_orders:Number(row?.formal_orders??0),cooperation:Number(row?.cooperation??0)};
}
async function consultations(database:SqlDatabase,type:'BUYER'|'SELLER',from:string,to:string,markets:readonly string[]):Promise<number>{
  const marketSql=markets.length?`AND channel.marketplace_code IN (${markets.map(()=>'?').join(',')})`:'';
  const row=await database.prepare(`SELECT COALESCE(SUM(consultation.person_count),0) AS count
    FROM acquisition_daily_consultations consultation JOIN acquisition_channels channel ON channel.id=consultation.channel_id
    WHERE consultation.lead_type=? AND consultation.business_date BETWEEN ? AND ? ${marketSql}`)
    .bind(type,from,to,...markets).first<{count:number}>();return Number(row?.count??0);
}
async function buyerProfit(database:SqlDatabase,from:string,to:string):Promise<{projected:string;completed:string}>{
  const rows=await database.prepare(`SELECT DISTINCT finance.formal_order_id,finance.projected_gross_profit_cny_fen,finance.completed_gross_profit_cny_fen
    FROM acquisition_customer_intake_facts fact
    JOIN acquisition_lead_links link ON link.lead_id=fact.lead_id AND link.link_type='FORMAL_ORDER'
    JOIN internal_order_finance_positions finance ON finance.formal_order_id=link.target_id
    WHERE fact.lead_type='BUYER' AND fact.business_date BETWEEN ? AND ?`).bind(from,to).all<{projected_gross_profit_cny_fen:string|null;completed_gross_profit_cny_fen:string|null}>();
  let projected=0n,completed=0n;for(const row of rows.results){if(row.projected_gross_profit_cny_fen!==null)projected+=BigInt(row.projected_gross_profit_cny_fen);if(row.completed_gross_profit_cny_fen!==null)completed+=BigInt(row.completed_gross_profit_cny_fen);}return{projected:projected.toString(),completed:completed.toString()};
}
