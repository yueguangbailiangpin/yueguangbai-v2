import {
  apiFailure,apiSuccess,FORMAL_ORDER_ADJUSTMENT_SCOPES,FORMAL_ORDER_OPERATIONAL_EVENT_TYPES,
  REVIEW_VISIBILITY_STATUSES,type FormalOrderAdjustmentScope,type FormalOrderOperationalEventType,
  type ReviewVisibilityStatus,type SqlDatabase,
} from '@ygb/contracts';
import { chinaBusinessDate } from '@ygb/domain';
import type { Context,Hono } from 'hono';
import { createAuditEventStatement } from '../foundation/audit';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';

class IntegrityError extends Error{constructor(public code:'VALIDATION_ERROR'|'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'DEPENDENCY_UNAVAILABLE',public status:400|403|404|409|503){super(code)}}

export function registerOperatingIntegrityRoutes(app:Hono<any>):void{
  app.get('/api/staff/order-integrity/:id',wrap(readOrderIntegrity));
  app.post('/api/staff/order-integrity/:id/events',customerAuthOriginGuard(),wrap(recordOrderEvent));
  app.post('/api/staff/order-integrity/:id/financial-adjustments',customerAuthOriginGuard(),wrap(recordFinancialAdjustment));
  app.get('/api/staff/reviews/:id/visibility',wrap(readReviewVisibility));
  app.post('/api/staff/reviews/:id/visibility',customerAuthOriginGuard(),wrap(recordReviewVisibility));
  app.get('/api/staff/buyer-advance-principal/:formalOrderId',wrap(readAdvancePrincipal));
  app.post('/api/staff/buyer-advance-principal/:formalOrderId/payments',customerAuthOriginGuard(),wrap(recordAdvancePayment));
  app.post('/api/staff/buyer-advance-principal/:formalOrderId/payments/:paymentId/reversals',customerAuthOriginGuard(),wrap(reverseAdvancePayment));
}

async function readOrderIntegrity(context:Context<any>){
  const actor=staff(context);const order=await orderRow(context.env.DB,id(context.req.param('id')));await market(context.env.DB,actor,order.market);
  const [events,adjustments,state]=await Promise.all([
    context.env.DB.prepare(`SELECT id AS event_id,formal_order_id,event_type,reason,actor_staff_id,created_at FROM formal_order_operational_events WHERE formal_order_id=? ORDER BY created_at,id`).bind(order.id).all<any>(),
    context.env.DB.prepare(`SELECT id AS adjustment_id,formal_order_id,source_operational_event_id,adjustment_scope,CAST(amount_cny_fen AS TEXT) AS amount_cny_fen,reason,actor_staff_id,created_at FROM formal_order_financial_adjustments WHERE formal_order_id=? ORDER BY created_at,id`).bind(order.id).all<any>(),
    context.env.DB.prepare(`SELECT operational_state FROM formal_order_effective_operational_state WHERE formal_order_id=?`).bind(order.id).first<{operational_state:string}>(),
  ]);
  return ok(context,{order_integrity:{formal_order_id:order.id,canonical_marketplace_code:order.market,operational_state:state?.operational_state??'NORMAL',events:events.results,adjustments:adjustments.results}});
}
async function recordOrderEvent(context:Context<any>){
  const actor=staff(context);if(!actor.roles.has('owner')&&!actor.roles.has('seller_ops'))forbidden();
  const order=await orderRow(context.env.DB,id(context.req.param('id')));await market(context.env.DB,actor,order.market);
  const body=await json(context,['event_type','reason']);const type=body['event_type'];
  if(typeof type!=='string'||!FORMAL_ORDER_OPERATIONAL_EVENT_TYPES.includes(type as FormalOrderOperationalEventType))validation();
  const reason=text(body['reason'],3,2000);const now=Date.now();const eventId=crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO formal_order_operational_events(id,formal_order_id,event_type,reason,actor_staff_id,created_at) VALUES(?,?,?,?,?,?)`).bind(eventId,order.id,type,reason,actor.staffId,now),
    createAuditEventStatement(context.env.DB,{id:crypto.randomUUID(),aggregateType:'FORMAL_ORDER',aggregateId:order.id,eventType:`FORMAL_ORDER_${type}`,actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:requestIdFromContext(context),nextState:{operational_event_id:eventId,event_type:type,reason},createdAt:now}),
  ]);
  return ok(context,{event:{event_id:eventId,formal_order_id:order.id,event_type:type,reason,actor_staff_id:actor.staffId,created_at:now}},201);
}
async function recordFinancialAdjustment(context:Context<any>){
  const actor=staff(context);if(!actor.roles.has('owner')||!actor.permissions.has('FINANCIAL_CORRECT'))forbidden();
  const order=await orderRow(context.env.DB,id(context.req.param('id')));
  const body=await json(context,['adjustment_scope','amount_cny_fen','reason','source_operational_event_id']);
  const scope=body['adjustment_scope'];if(typeof scope!=='string'||!FORMAL_ORDER_ADJUSTMENT_SCOPES.includes(scope as FormalOrderAdjustmentScope))validation();
  const amount=signedMoney(body['amount_cny_fen']);const reason=text(body['reason'],3,2000);
  const source=body['source_operational_event_id'];if(!(source===null||typeof source==='string'))validation();
  if(typeof source==='string'){
    const found=await context.env.DB.prepare(`SELECT 1 AS present FROM formal_order_operational_events WHERE id=? AND formal_order_id=?`).bind(source,order.id).first();if(!found)validation();
  }
  const now=Date.now(),adjustmentId=crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO formal_order_financial_adjustments(id,formal_order_id,source_operational_event_id,adjustment_scope,amount_cny_fen,reason,actor_staff_id,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(adjustmentId,order.id,source,scope,amount,reason,actor.staffId,now),
    createAuditEventStatement(context.env.DB,{id:crypto.randomUUID(),aggregateType:'FORMAL_ORDER_FINANCIAL_ADJUSTMENT',aggregateId:adjustmentId,eventType:'FORMAL_ORDER_FINANCIAL_ADJUSTMENT_RECORDED',actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:requestIdFromContext(context),nextState:{formal_order_id:order.id,adjustment_scope:scope,amount_cny_fen:String(amount),reason,source_operational_event_id:source},createdAt:now}),
  ]);
  return ok(context,{adjustment:{adjustment_id:adjustmentId,formal_order_id:order.id,source_operational_event_id:source,adjustment_scope:scope,amount_cny_fen:String(amount),reason,actor_staff_id:actor.staffId,created_at:now}},201);
}
async function readReviewVisibility(context:Context<any>){
  const actor=staff(context);const review=await reviewRow(context.env.DB,id(context.req.param('id')));await market(context.env.DB,actor,review.market);
  const rows=await context.env.DB.prepare(`SELECT id AS observation_id,review_case_id,formal_order_id,visibility_status,note,observed_at,actor_staff_id,created_at FROM review_visibility_observations WHERE review_case_id=? ORDER BY observed_at,id`).bind(review.id).all<any>();
  return ok(context,{observations:rows.results});
}
async function recordReviewVisibility(context:Context<any>){
  const actor=staff(context);if(!actor.roles.has('owner')&&!actor.roles.has('pre_sales'))forbidden();
  const review=await reviewRow(context.env.DB,id(context.req.param('id')));await market(context.env.DB,actor,review.market);
  const body=await json(context,['visibility_status','note','observed_at']);const status=body['visibility_status'];
  if(typeof status!=='string'||!REVIEW_VISIBILITY_STATUSES.includes(status as ReviewVisibilityStatus))validation();
  const note=optionalText(body['note'],2000);const observed=timestamp(body['observed_at']);const now=Date.now();const observationId=crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO review_visibility_observations(id,review_case_id,formal_order_id,visibility_status,note,observed_at,actor_staff_id,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(observationId,review.id,review.formalOrderId,status,note,observed,actor.staffId,now),
    createAuditEventStatement(context.env.DB,{id:crypto.randomUUID(),aggregateType:'REVIEW_CASE',aggregateId:review.id,eventType:'REVIEW_VISIBILITY_OBSERVED',actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:requestIdFromContext(context),nextState:{visibility_status:status,note,observed_at:observed},createdAt:now}),
  ]);
  return ok(context,{observation:{observation_id:observationId,review_case_id:review.id,formal_order_id:review.formalOrderId,visibility_status:status,note,observed_at:observed,actor_staff_id:actor.staffId,created_at:now}},201);
}
async function readAdvancePrincipal(context:Context<any>){
  const actor=staff(context);if(!actor.roles.has('owner')&&!actor.roles.has('buyer_refund'))forbidden();
  const order=await orderRow(context.env.DB,id(context.req.param('formalOrderId')));await market(context.env.DB,actor,order.market);
  const rows=await context.env.DB.prepare(`SELECT id AS entry_id,formal_order_id,buyer_customer_id,entry_type,original_payment_entry_id,CAST(amount_cny_fen AS TEXT) AS amount_cny_fen,paid_at,reversed_at,china_business_date,payment_channel,note,actor_staff_id,created_at FROM buyer_advance_principal_entries WHERE formal_order_id=? ORDER BY created_at,id`).bind(order.id).all<any>();
  return ok(context,{entries:rows.results});
}
async function recordAdvancePayment(context:Context<any>){
  const actor=staff(context);if(!actor.roles.has('owner')&&!actor.roles.has('buyer_refund'))forbidden();
  const order=await orderRow(context.env.DB,id(context.req.param('formalOrderId')));await market(context.env.DB,actor,order.market);
  const obligation=await context.env.DB.prepare(`SELECT 1 AS present FROM buyer_refund_obligations WHERE formal_order_id=? LIMIT 1`).bind(order.id).first();if(obligation)throw new IntegrityError('CONFLICT',409);
  const body=await json(context,['amount_cny_fen','paid_at','payment_channel','note']);const amount=positiveMoney(body['amount_cny_fen']);const paid=timestamp(body['paid_at']);const channel=paymentChannel(body['payment_channel']);const note=optionalText(body['note'],2000);const now=Date.now(),entryId=crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO buyer_advance_principal_entries(id,formal_order_id,buyer_customer_id,entry_type,original_payment_entry_id,amount_cny_fen,paid_at,reversed_at,china_business_date,payment_channel,note,actor_staff_id,created_at) VALUES(?,?,?,'PAYMENT',NULL,?,?,NULL,?,?,?,?,?)`).bind(entryId,order.id,order.buyerCustomerId,amount,paid,chinaBusinessDate(paid),channel,note,actor.staffId,now),
    createAuditEventStatement(context.env.DB,{id:crypto.randomUUID(),aggregateType:'BUYER_ADVANCE_PRINCIPAL',aggregateId:entryId,eventType:'BUYER_ADVANCE_PRINCIPAL_PAID',actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:requestIdFromContext(context),nextState:{formal_order_id:order.id,amount_cny_fen:String(amount),paid_at:paid,payment_channel:channel},createdAt:now}),
  ]);
  return ok(context,{entry:{entry_id:entryId,formal_order_id:order.id,buyer_customer_id:order.buyerCustomerId,entry_type:'PAYMENT',original_payment_entry_id:null,amount_cny_fen:String(amount),paid_at:paid,reversed_at:null,china_business_date:chinaBusinessDate(paid),payment_channel:channel,note,actor_staff_id:actor.staffId,created_at:now}},201);
}
async function reverseAdvancePayment(context:Context<any>){
  const actor=staff(context);if(!actor.roles.has('owner')&&!actor.roles.has('buyer_refund'))forbidden();
  const order=await orderRow(context.env.DB,id(context.req.param('formalOrderId')));await market(context.env.DB,actor,order.market);
  const paymentId=id(context.req.param('paymentId'));const original=await context.env.DB.prepare(`SELECT id,amount_cny_fen,payment_channel FROM buyer_advance_principal_entries WHERE id=? AND formal_order_id=? AND entry_type='PAYMENT'`).bind(paymentId,order.id).first<{id:string;amount_cny_fen:number;payment_channel:string}>();if(!original)throw new IntegrityError('NOT_FOUND',404);
  const settled=await context.env.DB.prepare(`SELECT 1 AS present FROM buyer_advance_principal_settlements WHERE advance_payment_entry_id=?`).bind(paymentId).first();if(settled)throw new IntegrityError('CONFLICT',409);
  const body=await json(context,['amount_cny_fen','reason']);const amount=positiveMoney(body['amount_cny_fen']);const prior=await context.env.DB.prepare(`SELECT COALESCE(SUM(amount_cny_fen),0) AS total FROM buyer_advance_principal_entries WHERE entry_type='REVERSAL' AND original_payment_entry_id=?`).bind(paymentId).first<{total:number}>();if(Number(prior?.total??0)+amount>Number(original.amount_cny_fen))throw new IntegrityError('CONFLICT',409);
  const reason=text(body['reason'],3,2000),now=Date.now(),entryId=crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO buyer_advance_principal_entries(id,formal_order_id,buyer_customer_id,entry_type,original_payment_entry_id,amount_cny_fen,paid_at,reversed_at,china_business_date,payment_channel,note,actor_staff_id,created_at) VALUES(?,?,?,'REVERSAL',?,?,NULL,?,?,?,?,?,?)`).bind(entryId,order.id,order.buyerCustomerId,paymentId,amount,now,chinaBusinessDate(now),original.payment_channel,reason,actor.staffId,now),
    createAuditEventStatement(context.env.DB,{id:crypto.randomUUID(),aggregateType:'BUYER_ADVANCE_PRINCIPAL',aggregateId:entryId,eventType:'BUYER_ADVANCE_PRINCIPAL_REVERSED',actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:requestIdFromContext(context),nextState:{original_payment_entry_id:paymentId,amount_cny_fen:String(amount),reason},createdAt:now}),
  ]);
  return ok(context,{reversal:{entry_id:entryId,original_payment_entry_id:paymentId,amount_cny_fen:String(amount),reversed_at:now,reason}},201);
}

async function orderRow(database:SqlDatabase,orderId:string){const row=await database.prepare(`SELECT id,buyer_customer_id,canonical_marketplace_code AS market FROM formal_orders WHERE id=?`).bind(orderId).first<{id:string;buyer_customer_id:string;market:string}>();if(!row)throw new IntegrityError('NOT_FOUND',404);return{id:row.id,buyerCustomerId:row.buyer_customer_id,market:row.market};}
async function reviewRow(database:SqlDatabase,reviewId:string){const row=await database.prepare(`SELECT review_case.id,review_case.formal_order_id,formal_order.canonical_marketplace_code AS market FROM review_cases review_case JOIN formal_orders formal_order ON formal_order.id=review_case.formal_order_id WHERE review_case.id=?`).bind(reviewId).first<{id:string;formal_order_id:string;market:string}>();if(!row)throw new IntegrityError('NOT_FOUND',404);return{id:row.id,formalOrderId:row.formal_order_id,market:row.market};}
async function market(database:SqlDatabase,actor:AssignmentStaffAuthorization,code:string){if(actor.roles.has('owner'))return;const allowed=await resolveStaffMarketplaceCodes(database,actor);if(!allowed.includes(code))throw new IntegrityError('NOT_FOUND',404);}
function staff(context:Context<any>){const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;if(!actor||actor.staffStatus!=='ACTIVE')forbidden();return actor;}
async function json(context:Context<any>,keys:string[]){let body:unknown;try{body=await context.req.json();}catch{validation();}if(!body||typeof body!=='object'||Array.isArray(body))validation();const record=body as Record<string,unknown>;if(Object.keys(record).length!==keys.length||keys.some((key)=>!Object.hasOwn(record,key)))validation();return record;}
function id(value:string){const v=value.normalize('NFKC').trim();if(v.length<1||v.length>200||/[\u0000-\u001f\u007f]/u.test(v))validation();return v;}
function text(value:unknown,min:number,max:number){if(typeof value!=='string')validation();const v=value.normalize('NFKC').trim();if(v.length<min||v.length>max||/[\u0000-\u001f\u007f]/u.test(v))validation();return v;}
function optionalText(value:unknown,max:number){if(value===null)return null;if(typeof value!=='string')validation();const v=value.normalize('NFKC').trim();if(!v)return null;if(v.length>max)validation();return v;}
function timestamp(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)validation();return value;}
function signedMoney(value:unknown){const number=typeof value==='string'&&/^-?[1-9][0-9]*$/u.test(value)?Number(value):value;if(typeof number!=='number'||!Number.isSafeInteger(number)||number===0)validation();return number;}
function positiveMoney(value:unknown){const n=signedMoney(value);if(n<=0)validation();return n;}
function paymentChannel(value:unknown){if(typeof value!=='string'||!['WECHAT','ALIPAY','BANK_TRANSFER','OTHER_MANUAL'].includes(value))validation();return value;}
function validation():never{throw new IntegrityError('VALIDATION_ERROR',400)}function forbidden():never{throw new IntegrityError('FORBIDDEN',403)}
function ok(context:Context<any>,data:unknown,status=200){context.header('Cache-Control','no-store');return context.json(apiSuccess(data,requestIdFromContext(context)),status as 200|201);}
function wrap(handler:(context:Context<any>)=>Promise<Response>){return async(context:Context<any>)=>{try{return await handler(context);}catch(error){const e=error instanceof IntegrityError?error:new IntegrityError('DEPENDENCY_UNAVAILABLE',503);return context.json(apiFailure(e.code,e.code==='FORBIDDEN'?'当前岗位无权执行该操作':e.code==='NOT_FOUND'?'没有找到对应业务记录':e.code==='CONFLICT'?'当前业务状态不允许该操作':e.code==='VALIDATION_ERROR'?'提交内容不正确':'服务暂时不可用',requestIdFromContext(context)),e.status);}};}
