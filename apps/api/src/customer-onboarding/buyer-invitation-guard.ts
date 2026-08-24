import { apiFailure } from '@ygb/contracts';
import type { Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';

export function registerBuyerInvitationDutyGuard(app:Hono<any>):void{
  const guard=async(context:any,next:any)=>{
    const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
    // D1：签发权限开放 pre_sales 与 acquisition（获客岗位在其数据范围内签发）。
    if(!actor||actor.staffStatus!=='ACTIVE'||(!actor.roles.has('owner')&&!actor.roles.has('pre_sales')&&!actor.roles.has('acquisition'))){
      return context.json(apiFailure('FORBIDDEN','只有售前、获客或总管理员可以处理买家注册链接',requestIdFromContext(context)),403);
    }
    if(context.req.method==='POST'&&context.req.path==='/api/staff/customer-security/buyer-invitations'&&!actor.roles.has('owner')){
      try{
        const body=await context.req.raw.clone().json() as Record<string,unknown>;
        const market=body['marketplace_code'];
        if(typeof market==='string'){
          const allowed=await resolveStaffMarketplaceCodes(context.env.DB,actor);
          if(!allowed.includes(market))return context.json(apiFailure('FORBIDDEN','当前员工不能为该站点生成买家注册链接',requestIdFromContext(context)),403);
        }
      }catch{/* canonical route owns request validation */}
    }
    return next();
  };
  app.use('/api/staff/customer-security/buyer-invitations',guard);
  app.use('/api/staff/customer-security/buyer-invitations/*',guard);
}
