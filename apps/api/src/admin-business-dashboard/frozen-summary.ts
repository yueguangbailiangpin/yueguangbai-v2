import type { AdminBusinessDashboardSummaryDto, DashboardFunnelStageDto, SqlDatabase } from '@ygb/contracts';
import { readAdminBusinessDashboardSummary } from './read-model';

interface CohortRow{
  lead_type:'BUYER'|'SELLER';registered:number;reserved:number;ordered:number;completed:number;cooperation:number;
}

export async function readFrozenAdminBusinessDashboardSummary(
  database:SqlDatabase,key:Parameters<typeof readAdminBusinessDashboardSummary>[1],now=Date.now(),
):Promise<AdminBusinessDashboardSummaryDto>{
  const base=await readAdminBusinessDashboardSummary(database,key,now);
  const rows=await database.prepare(`SELECT fact.lead_type,
      EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=fact.lead_id AND link.link_type='BUYER_CUSTOMER' AND link.linked_at<=?) AS registered,
      EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=fact.lead_id AND link.link_type='RESERVATION' AND link.linked_at<=?) AS reserved,
      EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=fact.lead_id AND link.link_type='FORMAL_ORDER' AND link.linked_at<=?) AS ordered,
      EXISTS(SELECT 1 FROM acquisition_lead_links link JOIN order_archive_closures closure ON closure.formal_order_id=link.target_id
        WHERE link.lead_id=fact.lead_id AND link.link_type='FORMAL_ORDER' AND closure.status='CLOSED' AND closure.business_closed_at<=?) AS completed,
      EXISTS(SELECT 1 FROM acquisition_lead_links link WHERE link.lead_id=fact.lead_id AND link.link_type='SELLER_ORGANIZATION' AND link.linked_at<=?) AS cooperation
    FROM acquisition_customer_intake_facts fact
    WHERE fact.business_date BETWEEN ? AND ? AND fact.recorded_at<=?`)
    .bind(now,now,now,now,now,base.window.from_date,base.window.to_date,now).all<CohortRow>();
  const buyer=rows.results.filter((row)=>row.lead_type==='BUYER'),seller=rows.results.filter((row)=>row.lead_type==='SELLER');
  const buyerConsultation=stageCount(base.buyer_funnel.stages,'CONSULTATION'),sellerConsultation=stageCount(base.seller_funnel.stages,'CONSULTATION');
  const buyerStages=funnel([
    ['CONSULTATION','咨询',buyerConsultation],['WECHAT_ADDED','加微信',buyer.length],
    ['REGISTERED','注册',buyer.filter((row)=>Number(row.registered)===1).length],
    ['RESERVATION_SUBMITTED','预约',buyer.filter((row)=>Number(row.reserved)===1).length],
    ['FORMAL_ORDER','正式订单',buyer.filter((row)=>Number(row.ordered)===1).length],
    ['BUSINESS_COMPLETED','业务完成',buyer.filter((row)=>Number(row.completed)===1).length],
  ]);
  const sellerStages=funnel([
    ['CONSULTATION','咨询',sellerConsultation],['WECHAT_ADDED','加微信',seller.length],
    ['COOPERATION','确认合作',seller.filter((row)=>Number(row.cooperation)===1).length],
  ]);
  return Object.freeze({...base,
    buyer_funnel:Object.freeze({stages:Object.freeze(buyerStages),no_participation_count:Math.max(0,buyer.length-buyer.filter((row)=>Number(row.reserved)===1).length)}),
    seller_funnel:Object.freeze({stages:Object.freeze(sellerStages)}),
  });
}
function stageCount(stages:readonly DashboardFunnelStageDto[],code:string){return stages.find((stage)=>stage.code===code)?.count??0;}
function funnel(input:readonly [string,string,number][]):DashboardFunnelStageDto[]{return input.map(([code,label,count],index)=>Object.freeze({code,label,count,conversion_rate_bps:index===0?null:rate(count,input[index-1]![2])}));}
function rate(numerator:number,denominator:number){return denominator===0?null:Math.min(10_000,Math.round(numerator*10_000/denominator));}
