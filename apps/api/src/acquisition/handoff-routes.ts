import { apiFailure, apiSuccess, isAcquisitionLeadType } from '@ygb/contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../app';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { AcquisitionError } from './errors';
import { listAcquisitionHandoffs } from './handoffs';

export function registerAcquisitionHandoffRoutes(app:Hono<AppEnv>):void{
  app.get('/api/staff/acquisition/handoffs',async(context)=>{
    const requestId=String(context.get('requestId')??crypto.randomUUID());
    try{
      const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
      if(!actor)throw new AcquisitionError('UNAUTHENTICATED',401);
      const parameters=new URL(context.req.url).searchParams;
      if([...parameters.keys()].some((key)=>key!=='lead_type'))throw new AcquisitionError('VALIDATION_ERROR',400);
      const leadType=context.req.query('lead_type');if(!isAcquisitionLeadType(leadType))throw new AcquisitionError('VALIDATION_ERROR',400);
      return context.json(apiSuccess({items:await listAcquisitionHandoffs(context.env.DB,actor,leadType)},requestId));
    }catch(error){
      const normalized=error instanceof AcquisitionError?error:new AcquisitionError('DEPENDENCY_UNAVAILABLE',503);
      return context.json(apiFailure(normalized.code,normalized.code==='FORBIDDEN'?'当前岗位没有该交接队列权限':normalized.code==='NOT_FOUND'?'交接记录不存在':normalized.code==='VALIDATION_ERROR'?'请求参数不正确':'客户交接暂时不可用',requestId),normalized.status);
    }
  });
}
