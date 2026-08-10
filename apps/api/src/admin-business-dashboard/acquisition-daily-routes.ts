import { apiFailure, apiSuccess, type SqlDatabase } from '@ygb/contracts';
import { parseChinaBusinessDate } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

interface ChannelMetaRow {
  channel_id:string; channel_name:string; platform_name:string;
  lead_type:'BUYER'|'SELLER'|'BOTH'; marketplace_code:string;
  staff_label:string|null;
}
interface CustomerRow {
  business_date:string; channel_id:string; lead_type:'BUYER'|'SELLER'; count:number;
}
interface OrderRow {
  business_date:string; channel_id:string; lead_type:'BUYER'|'SELLER'; count:number;
}
interface DailyCountRow { business_date:string; count:number }

export function registerAdminAcquisitionDailyRoutes(app:Hono<any>):void{
  app.get('/api/staff/admin-business-dashboard/acquisition-daily',async(context)=>{
    const requestId=String(context.get('requestId')??crypto.randomUUID());
    try{
      const actor=requireOwner(context);
      if(!actor.permissions.has('FINANCIAL_VIEW'))return forbidden(context,requestId);
      const url=new URL(context.req.url);
      if([...url.searchParams.keys()].some((key)=>!['from_date','to_date'].includes(key)))throw new Error('INVALID_QUERY');
      const from=parseDate(url.searchParams.get('from_date'));
      const to=parseDate(url.searchParams.get('to_date'));
      if(from>to||dayDistance(from,to)>366)throw new Error('INVALID_RANGE');
      const data=await readDaily(context.env.DB,from,to);
      context.header('Cache-Control','no-store');
      return context.json(apiSuccess(data,requestId));
    }catch(error){
      if(error instanceof Error&&error.message==='FORBIDDEN')return forbidden(context,requestId);
      if(error instanceof Error&&['INVALID_QUERY','INVALID_RANGE'].includes(error.message)){
        return context.json(apiFailure('VALIDATION_ERROR','日期范围不正确',requestId),400);
      }
      return context.json(apiFailure('DEPENDENCY_UNAVAILABLE','经营数据暂时无法加载',requestId),503);
    }
  });
}

async function readDaily(database:SqlDatabase,from:string,to:string){
  const [channelRows,customerRows,buyerOrderRows,sellerOrderRows,buyerRegistrations,formalOrders]=await Promise.all([
    database.prepare(`SELECT channel.id AS channel_id,channel.display_name AS channel_name,
      channel.platform_name,channel.lead_type,channel.marketplace_code,privacy.staff_label
      FROM acquisition_channels channel
      LEFT JOIN acquisition_channel_privacy_profiles privacy ON privacy.channel_id=channel.id
      WHERE channel.status='ACTIVE'
      ORDER BY channel.marketplace_code,channel.lead_type,channel.display_name,channel.id`).all<ChannelMetaRow>(),
    database.prepare(`SELECT lead.created_business_date AS business_date,lead.origin_channel_id AS channel_id,
      lead.lead_type,COUNT(*) AS count
      FROM acquisition_leads lead
      WHERE lead.status='ACTIVE' AND lead.created_business_date BETWEEN ? AND ?
      GROUP BY lead.created_business_date,lead.origin_channel_id,lead.lead_type`)
      .bind(from,to).all<CustomerRow>(),
    database.prepare(`SELECT formal_order.confirmed_business_date AS business_date,
      attribution.origin_channel_id AS channel_id,'BUYER' AS lead_type,COUNT(DISTINCT formal_order.id) AS count
      FROM formal_orders formal_order
      JOIN acquisition_customer_attributions attribution
        ON attribution.subject_type='BUYER_CUSTOMER'
        AND attribution.subject_id=formal_order.buyer_customer_id
      WHERE formal_order.confirmed_business_date BETWEEN ? AND ?
      GROUP BY formal_order.confirmed_business_date,attribution.origin_channel_id`)
      .bind(from,to).all<OrderRow>(),
    database.prepare(`SELECT formal_order.confirmed_business_date AS business_date,
      attribution.origin_channel_id AS channel_id,'SELLER' AS lead_type,COUNT(DISTINCT formal_order.id) AS count
      FROM formal_orders formal_order
      JOIN acquisition_customer_attributions attribution
        ON attribution.subject_type='SELLER_ORGANIZATION'
        AND attribution.subject_id=formal_order.seller_organization_id
      WHERE formal_order.confirmed_business_date BETWEEN ? AND ?
      GROUP BY formal_order.confirmed_business_date,attribution.origin_channel_id`)
      .bind(from,to).all<OrderRow>(),
    database.prepare(`SELECT date(activated_at/1000,'unixepoch','+8 hours') AS business_date,COUNT(*) AS count
      FROM buyer_customers
      WHERE date(activated_at/1000,'unixepoch','+8 hours') BETWEEN ? AND ?
      GROUP BY date(activated_at/1000,'unixepoch','+8 hours')`).bind(from,to).all<DailyCountRow>(),
    database.prepare(`SELECT confirmed_business_date AS business_date,COUNT(*) AS count
      FROM formal_orders WHERE confirmed_business_date BETWEEN ? AND ?
      GROUP BY confirmed_business_date`).bind(from,to).all<DailyCountRow>(),
  ]);
  const meta=new Map<string,ChannelMetaRow>(channelRows.results.map((row)=>[row.channel_id,row]));
  const customerMap=new Map<string,number>();
  for(const row of customerRows.results)customerMap.set(key(row.business_date,row.channel_id,row.lead_type),Number(row.count));
  const orderMap=new Map<string,number>();
  for(const row of [...buyerOrderRows.results,...sellerOrderRows.results])orderMap.set(key(row.business_date,row.channel_id,row.lead_type),Number(row.count));
  const registrationMap=new Map<string,number>(buyerRegistrations.results.map((row)=>[row.business_date,Number(row.count)]));
  const formalOrderMap=new Map<string,number>(formalOrders.results.map((row)=>[row.business_date,Number(row.count)]));
  const days=dateList(from,to);
  const daily=days.map((business_date)=>({
    business_date,
    new_buyer_customers:sumCustomers(customerRows.results,business_date,'BUYER'),
    new_seller_customers:sumCustomers(customerRows.results,business_date,'SELLER'),
    buyer_portal_registrations:registrationMap.get(business_date)??0,
    formal_orders:formalOrderMap.get(business_date)??0,
  }));
  const channelDaily:{
    business_date:string;channel_id:string;channel_name:string;channel_label:string;platform_name:string;
    lead_type:'BUYER'|'SELLER';marketplace_code:string;new_customer_count:number;formal_order_count:number;
  }[]=[];
  for(const business_date of days){
    for(const channel of meta.values()){
      const leadTypes:readonly ('BUYER'|'SELLER')[]=channel.lead_type==='BOTH'?['BUYER','SELLER']:[channel.lead_type];
      for(const leadType of leadTypes){
        const newCustomerCount=customerMap.get(key(business_date,channel.channel_id,leadType))??0;
        const formalOrderCount=orderMap.get(key(business_date,channel.channel_id,leadType))??0;
        if(newCustomerCount===0&&formalOrderCount===0)continue;
        channelDaily.push({
          business_date,channel_id:channel.channel_id,channel_name:channel.channel_name,
          channel_label:channel.staff_label??'未配置',platform_name:channel.platform_name,
          lead_type:leadType,marketplace_code:channel.marketplace_code,
          new_customer_count:newCustomerCount,formal_order_count:formalOrderCount,
        });
      }
    }
  }
  return Object.freeze({
    from_date:from,to_date:to,timezone:'Asia/Shanghai' as const,data_as_of:Date.now(),
    totals:Object.freeze({
      new_buyer_customers:daily.reduce((sum,row)=>sum+row.new_buyer_customers,0),
      new_seller_customers:daily.reduce((sum,row)=>sum+row.new_seller_customers,0),
      buyer_portal_registrations:daily.reduce((sum,row)=>sum+row.buyer_portal_registrations,0),
      formal_orders:daily.reduce((sum,row)=>sum+row.formal_orders,0),
    }),
    daily:Object.freeze(daily),channel_daily:Object.freeze(channelDaily),
  });
}

function requireOwner(context:Context<any>):AssignmentStaffAuthorization{
  const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
  if(!actor||!actor.roles.has('owner'))throw new Error('FORBIDDEN');
  return actor;
}
function forbidden(context:Context<any>,requestId:string){return context.json(apiFailure('FORBIDDEN','只有总管理员可以查看该经营数据',requestId),403);}
function parseDate(value:string|null):string{
  if(!value)throw new Error('INVALID_QUERY');
  try{return parseChinaBusinessDate(value);}catch{throw new Error('INVALID_QUERY');}
}
function key(date:string,channel:string,type:string){return `${date}:${channel}:${type}`;}
function sumCustomers(rows:readonly CustomerRow[],date:string,type:'BUYER'|'SELLER'){
  return rows.filter((row)=>row.business_date===date&&row.lead_type===type).reduce((sum,row)=>sum+Number(row.count),0);
}
function dateList(from:string,to:string):string[]{
  const result:string[]=[];let current=new Date(`${from}T00:00:00Z`);const end=new Date(`${to}T00:00:00Z`);
  while(current<=end){result.push(current.toISOString().slice(0,10));current=new Date(current.getTime()+86_400_000);}
  return result;
}
function dayDistance(from:string,to:string){return Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86_400_000);}
