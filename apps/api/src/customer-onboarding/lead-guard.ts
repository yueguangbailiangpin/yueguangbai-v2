import { apiFailure } from '@ygb/contracts';
import { normalizeWechatId } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';

export function registerExistingCustomerLeadGuard(app:Hono<any>):void{
  app.use('/api/staff/acquisition/leads',async(context,next)=>{
    if(context.req.method!=='POST')return next();
    try{
      const clone=context.req.raw.clone();const body=await clone.json() as Record<string,unknown>;
      const type=body['lead_type'];const raw=body['wechat_id'];
      if((type!=='BUYER'&&type!=='SELLER')||typeof raw!=='string')return next();
      const wechat=normalizeWechatId(raw);
      const exists=type==='BUYER'
        ?await context.env.DB.prepare(`SELECT buyer.id FROM wechat_identity_claims claim
          JOIN buyer_customers buyer ON buyer.identity_subject_id=claim.identity_subject_id
          WHERE claim.normalized_wechat=? AND claim.status='ACTIVE' AND buyer.access_status='ACTIVE' LIMIT 1`)
          .bind(wechat.normalized).first()
        :await context.env.DB.prepare(`SELECT organization.id FROM wechat_identity_claims claim
          JOIN seller_organization_members member ON member.identity_subject_id=claim.identity_subject_id
          JOIN seller_organizations organization ON organization.id=member.organization_id
          WHERE claim.normalized_wechat=? AND claim.status='ACTIVE' AND member.status='ACTIVE'
            AND organization.status='ACTIVE' LIMIT 1`).bind(wechat.normalized).first();
      if(exists){
        context.header('Cache-Control','no-store');
        return context.json(apiFailure('CONFLICT','该微信已经对应历史客户，请使用“历史客户开通账号”，不要重复新增',requestIdFromContext(context)),409);
      }
    }catch{/* Validation remains owned by the canonical acquisition route. */}
    return next();
  });
}
