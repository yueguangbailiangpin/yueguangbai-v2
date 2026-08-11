import { apiFailure, apiSuccess, type SqlDatabase } from '@ygb/contracts';
import { normalizeWechatId } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';

interface BuyerRow{subject_id:string;display_name:string;marketplace_code:string|null;account_id:string|null;formal_order_count:number}
interface SellerRow{subject_id:string;display_name:string;marketplace_code:string;account_id:string|null;formal_order_count:number}

export function registerCustomerOnboardingRoutes(app:Hono<any>):void{
  app.get('/api/staff/customer-onboarding/lookup',async(context)=>{
    const requestId=requestIdFromContext(context);
    try{
      const actor=requireActor(context);const url=new URL(context.req.url);
      if([...url.searchParams.keys()].some((key)=>!['customer_type','wechat_id'].includes(key)))throw new Error('VALIDATION');
      const type=url.searchParams.get('customer_type');const raw=url.searchParams.get('wechat_id');
      if((type!=='BUYER'&&type!=='SELLER')||!raw)throw new Error('VALIDATION');
      if(type==='BUYER'&&!actor.roles.has('owner')&&!actor.roles.has('pre_sales'))throw new Error('FORBIDDEN');
      if(type==='SELLER'&&!actor.roles.has('owner')&&!actor.roles.has('seller_ops'))throw new Error('FORBIDDEN');
      const wechat=normalizeWechatId(raw);const markets=actor.roles.has('owner')?null:await resolveStaffMarketplaceCodes(context.env.DB,actor);
      const matches=type==='BUYER'?await buyerMatches(context.env.DB,wechat.normalized,markets):await sellerMatches(context.env.DB,wechat.normalized,markets);
      context.header('Cache-Control','no-store');return context.json(apiSuccess({matches},requestId));
    }catch(error){
      const message=error instanceof Error?error.message:'';
      if(message==='FORBIDDEN')return context.json(apiFailure('FORBIDDEN','当前岗位不能查询该类客户',requestId),403);
      if(message==='VALIDATION')return context.json(apiFailure('VALIDATION_ERROR','请输入正确的微信号',requestId),400);
      return context.json(apiFailure('DEPENDENCY_UNAVAILABLE','历史客户查询暂时不可用',requestId),503);
    }
  });
}

async function buyerMatches(database:SqlDatabase,wechat:string,markets:readonly string[]|null){
  const rows=await database.prepare(`SELECT buyer.id AS subject_id,buyer.display_name,
      assignment.marketplace_code,account.id AS account_id,
      (SELECT COUNT(*) FROM formal_orders formal_order WHERE formal_order.buyer_customer_id=buyer.id) AS formal_order_count
    FROM wechat_identity_claims claim
    JOIN buyer_customers buyer ON buyer.identity_subject_id=claim.identity_subject_id
    LEFT JOIN buyer_marketplace_assignments assignment ON assignment.buyer_customer_id=buyer.id
    LEFT JOIN customer_login_accounts account ON account.identity_subject_id=buyer.identity_subject_id AND account.status='ACTIVE'
    WHERE claim.normalized_wechat=? AND claim.status='ACTIVE' AND buyer.access_status='ACTIVE'
    ORDER BY buyer.activated_at,buyer.id`).bind(wechat).all<BuyerRow>();
  return rows.results.filter((row)=>markets===null||markets.includes(row.marketplace_code??'AMAZON_JP')).map((row)=>({
    customer_type:'BUYER' as const,subject_id:row.subject_id,display_name:row.display_name,
    marketplace_code:row.marketplace_code??'AMAZON_JP',has_portal_account:row.account_id!==null,
    historical_order_count:Number(row.formal_order_count),source_status:'HISTORICAL_UNKNOWN' as const,
  }));
}

async function sellerMatches(database:SqlDatabase,wechat:string,markets:readonly string[]|null){
  const identityRows=await database.prepare(`SELECT organization.id AS subject_id,organization.organization_name AS display_name,
      organization.marketplace_code,account.id AS account_id,
      (SELECT COUNT(*) FROM formal_orders formal_order WHERE formal_order.seller_organization_id=organization.id) AS formal_order_count
    FROM wechat_identity_claims claim
    JOIN seller_organization_members member ON member.identity_subject_id=claim.identity_subject_id
    JOIN seller_organizations organization ON organization.id=member.organization_id
    LEFT JOIN customer_login_accounts account ON account.identity_subject_id=member.identity_subject_id AND account.status='ACTIVE'
    WHERE claim.normalized_wechat=? AND claim.status='ACTIVE' AND member.status='ACTIVE' AND organization.status='ACTIVE'
    ORDER BY member.primary_owner DESC,organization.activated_at,organization.id`).bind(wechat).all<SellerRow>();
  const importedRows=await database.prepare(`SELECT organization.id AS subject_id,organization.organization_name AS display_name,
      organization.marketplace_code,NULL AS account_id,
      (SELECT COUNT(*) FROM formal_orders formal_order WHERE formal_order.seller_organization_id=organization.id) AS formal_order_count
    FROM seller_partner_import_source_records source
    JOIN seller_organizations organization ON organization.seller_code=source.source_seller_code
    WHERE source.seller_wechat_normalized=? AND source.status IN ('VALID','IMPORTED') AND organization.status='ACTIVE'
    GROUP BY organization.id,organization.organization_name,organization.marketplace_code
    ORDER BY organization.activated_at,organization.id`).bind(wechat).all<SellerRow>();
  const dedup=new Map<string,SellerRow>();
  for(const row of [...importedRows.results,...identityRows.results]){
    const current=dedup.get(row.subject_id);if(!current||row.account_id!==null)dedup.set(row.subject_id,row);
  }
  return [...dedup.values()].filter((row)=>{const canonical=row.marketplace_code==='JP'?'AMAZON_JP':row.marketplace_code;return markets===null||markets.includes(canonical);}).map((row)=>({
    customer_type:'SELLER' as const,subject_id:row.subject_id,display_name:row.display_name,
    marketplace_code:row.marketplace_code==='JP'?'AMAZON_JP':row.marketplace_code,has_portal_account:row.account_id!==null,
    historical_order_count:Number(row.formal_order_count),source_status:'HISTORICAL_UNKNOWN' as const,
  }));
}

function requireActor(context:Context<any>):AssignmentStaffAuthorization{
  const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
  if(!actor||actor.staffStatus!=='ACTIVE')throw new Error('FORBIDDEN');return actor;
}
