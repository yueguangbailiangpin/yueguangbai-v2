import { apiFailure,apiSuccess } from '@ygb/contracts';
import { normalizeAmazonOrderNumber } from '@ygb/domain';
import type { Context,Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';

export function registerAdvancePrincipalLookupRoute(app:Hono<any>):void{
  app.get('/api/staff/buyer-advance-principal-lookup',async(context)=>{
    const requestId=requestIdFromContext(context);
    try{
      const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
      if(!actor||actor.staffStatus!=='ACTIVE'||(!actor.roles.has('owner')&&!actor.roles.has('buyer_refund')))return context.json(apiFailure('FORBIDDEN','当前岗位不能处理提前返本金',requestId),403);
      const url=new URL(context.req.url);if([...url.searchParams.keys()].some((key)=>key!=='amazon_order_number'))return context.json(apiFailure('VALIDATION_ERROR','查询参数不正确',requestId),400);
      const orderNumber=normalizeAmazonOrderNumber(url.searchParams.get('amazon_order_number')??'');
      const row=await context.env.DB.prepare(`SELECT formal_order.id AS formal_order_id,formal_order.amazon_order_number_normalized,
          formal_order.buyer_customer_id,formal_order.canonical_marketplace_code,formal_order.product_name_snapshot,
          EXISTS(SELECT 1 FROM buyer_refund_obligations obligation WHERE obligation.formal_order_id=formal_order.id) AS has_refund_obligation,
          COALESCE((SELECT SUM(CASE advance.entry_type WHEN 'PAYMENT' THEN advance.amount_cny_fen ELSE -advance.amount_cny_fen END)
            FROM buyer_advance_principal_entries advance WHERE advance.formal_order_id=formal_order.id),0) AS advance_net_cny_fen
        FROM formal_orders formal_order WHERE formal_order.amazon_order_number_normalized=? LIMIT 2`).bind(orderNumber).all<any>();
      if(row.results.length!==1)return context.json(apiFailure('NOT_FOUND','没有找到唯一的正式订单',requestId),404);
      const value=row.results[0];if(!actor.roles.has('owner')){const markets=await resolveStaffMarketplaceCodes(context.env.DB,actor);if(!markets.includes(String(value.canonical_marketplace_code)))return context.json(apiFailure('NOT_FOUND','没有找到唯一的正式订单',requestId),404);}
      context.header('Cache-Control','no-store');return context.json(apiSuccess({order:{formal_order_id:String(value.formal_order_id),amazon_order_number:String(value.amazon_order_number_normalized),buyer_customer_id:String(value.buyer_customer_id),marketplace_code:String(value.canonical_marketplace_code),product_name:String(value.product_name_snapshot),has_refund_obligation:Number(value.has_refund_obligation)===1,advance_net_cny_fen:String(value.advance_net_cny_fen)}},requestId));
    }catch{return context.json(apiFailure('VALIDATION_ERROR','Amazon 订单号格式不正确',requestId),400);}
  });
}
