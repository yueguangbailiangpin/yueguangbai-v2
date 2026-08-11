import { apiFailure } from '@ygb/contracts';
import { normalizeWechatId } from '@ygb/domain';
import type { Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';

export function registerExistingCustomerLeadGuard(app:Hono<any>):void{
  app.use('/api/staff/acquisition/leads',async(context,next)=>{
    if(context.req.method!=='POST')return next();
    try{
      const clone=context.req.raw.clone();const body=await clone.json() as Record<string,unknown>;
      const type=body['lead_type'];const raw=body['wechat_id'];const market=body['marketplace_code'];
      if((type!=='BUYER'&&type!=='SELLER')||typeof raw!=='string'||typeof market!=='string')return next();
      const wechat=normalizeWechatId(raw);
      const exists=type==='BUYER'
        ?await context.env.DB.prepare(`SELECT buyer.id FROM wechat_identity_claims claim
          JOIN buyer_customers buyer ON buyer.identity_subject_id=claim.identity_subject_id
          LEFT JOIN buyer_marketplace_assignments assignment ON assignment.buyer_customer_id=buyer.id
          WHERE claim.normalized_wechat=? AND claim.status='ACTIVE' AND buyer.access_status='ACTIVE'
            AND COALESCE(assignment.marketplace_code,'AMAZON_JP')=? LIMIT 1`)
          .bind(wechat.normalized,market).first()
        :await context.env.DB.prepare(`SELECT subject_id FROM (
          SELECT organization.id AS subject_id
          FROM wechat_identity_claims claim
          JOIN seller_organization_members member ON member.identity_subject_id=claim.identity_subject_id
          JOIN seller_organizations organization ON organization.id=member.organization_id
          WHERE claim.normalized_wechat=? AND claim.status='ACTIVE' AND member.status='ACTIVE' AND organization.status='ACTIVE'
            AND (CASE organization.marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE organization.marketplace_code END)=?
          UNION
          SELECT organization.id AS subject_id
          FROM seller_partner_import_source_records source
          JOIN seller_organizations organization ON organization.seller_code=source.source_seller_code
          WHERE source.seller_wechat_normalized=? AND source.status IN ('VALID','IMPORTED') AND organization.status='ACTIVE'
            AND (CASE organization.marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE organization.marketplace_code END)=?
        ) LIMIT 1`).bind(wechat.normalized,market,wechat.normalized,market).first();
      if(exists){context.header('Cache-Control','no-store');return context.json(apiFailure('CONFLICT','该微信在当前站点已经对应历史客户，请使用“历史客户开通账号”，不要重复新增',requestIdFromContext(context)),409);}
    }catch{/* Validation remains owned by the canonical acquisition route. */}
    return next();
  });
}
