import { apiFailure } from '@ygb/contracts';
import type { Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

/**
 * The old WeChat-only reset endpoint cannot express Buyer/Seller persona or
 * Marketplace scope. Keep it only as an Owner emergency recovery tool.
 * Ordinary pre-sales/seller-ops must use the subject-scoped onboarding route.
 */
export function registerLegacyPasswordResetOwnerGuard(app:Hono<any>):void{
  app.use('/api/staff/customer-security/password-resets',async(context,next)=>{
    const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
    if(!actor||actor.staffStatus!=='ACTIVE'||!actor.roles.has('owner')){
      return context.json(apiFailure(
        'FORBIDDEN',
        '普通员工必须从对应买家/卖家客户记录发起账号恢复',
        requestIdFromContext(context),
      ),403);
    }
    return next();
  });
}
