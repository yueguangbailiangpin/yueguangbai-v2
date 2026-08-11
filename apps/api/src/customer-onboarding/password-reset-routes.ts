import { apiFailure, apiSuccess } from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { CustomerSecurityError, normalizeCustomerSecurityError } from '../customer-security/errors';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { issueCustomerPasswordResetForSubject } from './password-reset';

const BODY_LIMIT=8*1024;

export function registerScopedCustomerPasswordResetRoutes(app:Hono<any>):void{
  app.post('/api/staff/customer-onboarding/:customerType/:subjectId/password-reset',customerAuthOriginGuard(),async(context)=>{
    const requestId=requestIdFromContext(context);
    try{
      const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
      if(!actor||actor.staffStatus!=='ACTIVE')throw new CustomerSecurityError('UNAUTHENTICATED',401);
      const type=context.req.param('customerType');
      if(type!=='BUYER'&&type!=='SELLER')throw new CustomerSecurityError('VALIDATION_ERROR',400);
      const body=await readBoundedJson(context.req.raw,BODY_LIMIT);
      if(!body||typeof body!=='object'||Array.isArray(body))throw new CustomerSecurityError('VALIDATION_ERROR',400);
      const record=body as Record<string,unknown>;
      if(Object.keys(record).length!==1||typeof record['verification_note']!=='string')throw new CustomerSecurityError('VALIDATION_ERROR',400);
      let idempotencyKey:string|null=null;try{idempotencyKey=parseIdempotencyKey(context.req.header('Idempotency-Key'));}catch{throw new CustomerSecurityError('VALIDATION_ERROR',400);}
      if(!idempotencyKey)throw new CustomerSecurityError('VALIDATION_ERROR',400);
      const secret=String(context.env.CUSTOMER_SECURITY_TOKEN_SECRET??'');
      if(new TextEncoder().encode(secret).byteLength<32)throw new CustomerSecurityError('DEPENDENCY_UNAVAILABLE',503);
      const result=await issueCustomerPasswordResetForSubject(context.env.DB,actor,{
        customerType:type,subjectId:context.req.param('subjectId')??'',verificationNote:record['verification_note'],
      },{idempotencyKey,requestId,tokenSecret:secret});
      return context.json(apiSuccess({password_reset:{...result,reset_path:`/customer/reset-password?token=${encodeURIComponent(result.reset_token)}`}},requestId),201);
    }catch(error){
      const normalized=normalizeCustomerSecurityError(error);const message=normalized.code==='FORBIDDEN'?'当前岗位不能为这个客户发起密码恢复':normalized.code==='NOT_FOUND'?'没有找到已开通的网站账号':normalized.code==='CONFLICT'?'账号身份关系存在冲突，请交由总管理员处理':normalized.code==='VALIDATION_ERROR'?'请填写完整的人工核验记录':'操作未完成，请稍后重试';
      return context.json(apiFailure(normalized.code,message,requestId),normalized.status);
    }
  });
}
