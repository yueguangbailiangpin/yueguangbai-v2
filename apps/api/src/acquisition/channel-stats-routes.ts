import { apiFailure, apiSuccess } from '@ygb/contracts';
import type { Hono } from 'hono';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { readAcquisitionChannelStats } from './channel-stats';
import { AcquisitionError, validation } from './errors';

export function registerAcquisitionChannelStatsRoutes(app:Hono<any>):void{
  app.get('/api/staff/acquisition/channel-stats',async(context)=>{
    const requestId=String(context.get('requestId')??crypto.randomUUID());
    try{
      const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
      if(!actor)throw new AcquisitionError('UNAUTHENTICATED',401);
      const params=new URL(context.req.url).searchParams;
      if([...params.keys()].some((key)=>key!=='from_date'&&key!=='to_date'))validation();
      const from=context.req.query('from_date'),to=context.req.query('to_date');
      if(!from||!to)validation();
      return context.json(apiSuccess({channels:await readAcquisitionChannelStats(context.env.DB,actor,{fromDate:from,toDate:to})},requestId));
    }catch(error){
      const normalized=error instanceof AcquisitionError?error:new AcquisitionError('DEPENDENCY_UNAVAILABLE',503);
      return context.json(apiFailure(normalized.code,normalized.code==='FORBIDDEN'?'当前岗位没有渠道统计权限':normalized.code==='VALIDATION_ERROR'?'统计日期不正确':'渠道统计暂时不可用',requestId),normalized.status);
    }
  });
}
