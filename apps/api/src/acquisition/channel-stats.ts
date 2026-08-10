import type { SqlDatabase } from '@ygb/contracts';
import { chinaBusinessDateStartEpoch, parseChinaBusinessDate } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { listAcquisitionChannels } from './admin';
import { requireAcquisitionOperator } from './authorization';
import { validation } from './errors';

export interface AcquisitionChannelStatsDto {
  channel_id:string;
  channel_name:string;
  platform_name:string;
  lead_type:'BUYER'|'SELLER'|'BOTH';
  marketplace_code:string;
  consultation_count:number;
  prospect_count:number;
  codex_prospect_count:number;
  lead_count:number;
  registered_count:number;
  reservation_submitted_count:number;
  cooperation_count:number;
  formal_order_count:number;
  projected_gross_profit_cny_fen:string|null;
  completed_gross_profit_cny_fen:string|null;
}

export async function readAcquisitionChannelStats(
  database:SqlDatabase,
  actor:AssignmentStaffAuthorization,
  input:{fromDate:string;toDate:string},
):Promise<readonly AcquisitionChannelStatsDto[]>{
  requireAcquisitionOperator(actor);
  let from:string,to:string;
  try{from=parseChinaBusinessDate(input.fromDate);to=parseChinaBusinessDate(input.toDate);}catch{validation();}
  if(from>to)validation();
  const fromEpoch=chinaBusinessDateStartEpoch(from);
  const toExclusive=chinaBusinessDateStartEpoch(to)+24*60*60*1000;
  const channels=(await listAcquisitionChannels(database,actor)).filter((channel)=>channel.status==='ACTIVE');
  const result:AcquisitionChannelStatsDto[]=[];
  for(const channel of channels){
    const consultation=await database.prepare(`SELECT COALESCE(SUM(person_count),0) AS total
      FROM acquisition_daily_consultations WHERE channel_id=? AND business_date BETWEEN ? AND ?`)
      .bind(channel.channel_id,from,to).first<{total:number}>();
    const prospect=await database.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN origin_mode='CODEX' THEN 1 ELSE 0 END),0) AS codex
      FROM acquisition_prospects WHERE origin_channel_id=? AND discovered_at>=? AND discovered_at<?`)
      .bind(channel.channel_id,fromEpoch,toExclusive).first<{total:number;codex:number}>();
    const lead=await database.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM acquisition_lead_links link
        WHERE link.lead_id=lead.id AND link.link_type='BUYER_CUSTOMER') THEN 1 ELSE 0 END),0) AS registered,
      COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM acquisition_lead_links link
        WHERE link.lead_id=lead.id AND link.link_type='RESERVATION') THEN 1 ELSE 0 END),0) AS reserved,
      COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM acquisition_lead_links link
        WHERE link.lead_id=lead.id AND link.link_type='SELLER_ORGANIZATION') THEN 1 ELSE 0 END),0) AS cooperation
      FROM acquisition_leads lead
      WHERE lead.origin_channel_id=? AND lead.status='ACTIVE'
        AND lead.created_business_date BETWEEN ? AND ?`)
      .bind(channel.channel_id,from,to).first<{total:number;registered:number;reserved:number;cooperation:number}>();
    const buyerOrders=channel.lead_type==='SELLER'?[]:await database.prepare(`SELECT DISTINCT finance.formal_order_id,
      CAST(finance.projected_gross_profit_cny_fen AS TEXT) AS projected,
      CAST(finance.completed_gross_profit_cny_fen AS TEXT) AS completed
      FROM acquisition_leads lead
      JOIN acquisition_lead_links link ON link.lead_id=lead.id AND link.link_type='FORMAL_ORDER'
      JOIN internal_order_finance_positions finance ON finance.formal_order_id=link.target_id
      WHERE lead.origin_channel_id=? AND lead.status='ACTIVE'
        AND finance.confirmed_business_date BETWEEN ? AND ?`)
      .bind(channel.channel_id,from,to).all<{formal_order_id:string;projected:string|null;completed:string|null}>();
    const sellerOrders=channel.lead_type==='BUYER'?[]:await database.prepare(`SELECT DISTINCT finance.formal_order_id,
      CAST(finance.projected_gross_profit_cny_fen AS TEXT) AS projected,
      CAST(finance.completed_gross_profit_cny_fen AS TEXT) AS completed
      FROM acquisition_leads lead
      JOIN acquisition_lead_links link ON link.lead_id=lead.id AND link.link_type='SELLER_ORGANIZATION'
      JOIN internal_order_finance_positions finance ON finance.seller_organization_id=link.target_id
      WHERE lead.origin_channel_id=? AND lead.status='ACTIVE'
        AND finance.confirmed_business_date BETWEEN ? AND ?`)
      .bind(channel.channel_id,from,to).all<{formal_order_id:string;projected:string|null;completed:string|null}>();
    const orderMap=new Map<string,{projected:string|null;completed:string|null}>();
    for(const row of [...('results' in buyerOrders?buyerOrders.results:[]),...('results' in sellerOrders?sellerOrders.results:[])]){
      if(!orderMap.has(row.formal_order_id))orderMap.set(row.formal_order_id,{projected:row.projected,completed:row.completed});
    }
    let projected=0n,completed=0n,hasProjected=false,hasCompleted=false;
    for(const row of orderMap.values()){
      if(row.projected!==null){projected+=BigInt(row.projected);hasProjected=true;}
      if(row.completed!==null){completed+=BigInt(row.completed);hasCompleted=true;}
    }
    result.push({
      channel_id:channel.channel_id,channel_name:channel.display_name,platform_name:channel.platform_name,
      lead_type:channel.lead_type,marketplace_code:channel.marketplace_code,
      consultation_count:Number(consultation?.total??0),prospect_count:Number(prospect?.total??0),
      codex_prospect_count:Number(prospect?.codex??0),lead_count:Number(lead?.total??0),
      registered_count:Number(lead?.registered??0),reservation_submitted_count:Number(lead?.reserved??0),
      cooperation_count:Number(lead?.cooperation??0),formal_order_count:orderMap.size,
      projected_gross_profit_cny_fen:hasProjected?projected.toString():null,
      completed_gross_profit_cny_fen:hasCompleted?completed.toString():null,
    });
  }
  return Object.freeze(result);
}
