import { apiFailure } from '@ygb/contracts';
import type { Context,Hono,Next } from 'hono';
import type { AppEnv } from './app';
import { requestIdFromContext } from './http-auth/errors';
import {
  FormalOrderPolicyError,
  requireFormalOrderAction,
  type FormalOrderGatedAction,
} from './formal-order-policy';

export function registerFormalOrderPolicyGuards(app:Hono<AppEnv>):void{
  app.use('/api/staff/buyer-advance-principal/:formalOrderId/payments',guardAdvancePrincipal);
  app.use('/api/staff/reviews/:id/approve',guardReviewApproval);
}

async function guardAdvancePrincipal(context:Context<AppEnv>,next:Next):Promise<Response|void>{
  return guard(context,context.req.param('formalOrderId')??'','RECORD_ADVANCE_PRINCIPAL',next);
}

async function guardReviewApproval(context:Context<AppEnv>,next:Next):Promise<Response|void>{
  const reviewCaseId=(context.req.param('id')??'').normalize('NFKC').trim();
  if(reviewCaseId.length<1||reviewCaseId.length>200)return blocked(context,'VALIDATION_ERROR',400,'评论记录不正确');
  const row=await context.env.DB.prepare(`SELECT formal_order_id FROM review_cases WHERE id=? LIMIT 1`).bind(reviewCaseId).first<{formal_order_id:string}>();
  if(!row)return blocked(context,'NOT_FOUND',404,'没有找到对应评论');
  return guard(context,row.formal_order_id,'APPROVE_REVIEW',next);
}

async function guard(
  context:Context<AppEnv>,
  formalOrderId:string,
  action:FormalOrderGatedAction,
  next:Next,
):Promise<Response|void>{
  try{
    await requireFormalOrderAction(context.env.DB,formalOrderId,action);
    await next();
    return undefined;
  }catch(error){
    if(error instanceof FormalOrderPolicyError){
      if(error.code==='FORMAL_ORDER_NOT_FOUND')return blocked(context,'NOT_FOUND',404,'没有找到对应正式订单');
      return blocked(context,'CONFLICT',409,policyMessage(error.state));
    }
    throw error;
  }
}

function policyMessage(state:FormalOrderPolicyError['state']):string{
  if(state==='PLATFORM_CANCELLED')return'订单已被平台取消，处理恢复前不能继续该业务动作';
  if(state==='RETURN_REFUND')return'订单处于退货/退款状态，处理恢复前不能继续该业务动作';
  if(state==='BUSINESS_VOID')return'订单已业务作废，处理恢复前不能继续该业务动作';
  if(state==='MANUAL_INVESTIGATION')return'订单正在人工调查，处理恢复前不能继续该业务动作';
  return'当前订单状态不允许该业务动作';
}

function blocked(context:Context<AppEnv>,code:'VALIDATION_ERROR'|'NOT_FOUND'|'CONFLICT',status:400|404|409,message:string):Response{
  context.header('Cache-Control','no-store');
  return context.json(apiFailure(code,message,requestIdFromContext(context)),status);
}
