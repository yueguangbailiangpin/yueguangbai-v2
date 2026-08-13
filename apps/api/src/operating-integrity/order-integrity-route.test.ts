import { describe,expect,it } from 'vitest';
import type { SqlAllResult,SqlDatabase,SqlRunResult,SqlStatement,StaffPermissionCode,StaffRoleCode } from '@ygb/contracts';
import { createApp } from '../app';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { canViewOrderFinancialAdjustments,registerOperatingIntegrityRoutes } from './routes';

describe('order integrity financial projection',()=>{
  it('recognizes only owner plus FINANCIAL_VIEW as financial authority',()=>{
    expect(canViewOrderFinancialAdjustments(actor('owner',['FINANCIAL_VIEW']))).toBe(true);
    expect(canViewOrderFinancialAdjustments(actor('owner',[]))).toBe(false);
    expect(canViewOrderFinancialAdjustments(actor('pre_sales',[]))).toBe(false);
    expect(canViewOrderFinancialAdjustments(actor('seller_ops',[]))).toBe(false);
  });

  it('returns financial adjustments only to an owner with FINANCIAL_VIEW',async()=>{
    const visible=await request(actor('owner',['FINANCIAL_VIEW']));
    expect(visible.status).toBe(200);
    expect(await visible.json()).toMatchObject({data:{order_integrity:{adjustments:[{
      adjustment_id:'adjustment-1',amount_cny_fen:'5000',
    }]}}});

    const denied=await request(actor('owner',[]));
    expect(denied.status).toBe(200);
    const deniedBody=await denied.json() as {data:{order_integrity:{adjustments:unknown[]}}};
    expect(deniedBody.data.order_integrity.adjustments).toEqual([]);
    expect(JSON.stringify(deniedBody)).not.toContain('5000');
  });
});

async function request(actorValue:AssignmentStaffAuthorization):Promise<Response>{
  const app=createApp();
  app.use('/api/staff/*',async(context,next)=>{context.set('staffAuthorization',actorValue);await next();});
  registerOperatingIntegrityRoutes(app);
  return app.request('https://api.example.test/api/staff/order-integrity/order-1',{}, {DB:new IntegrityDatabase()});
}

function actor(role:StaffRoleCode,permissions:readonly StaffPermissionCode[]):AssignmentStaffAuthorization{return{
  staffId:'integrity-owner',displayName:'Owner',staffStatus:'ACTIVE',authorizationVersion:1,
  roles:new Set([role]),permissions:new Set(permissions),memberTeamIds:[],leaderTeamIds:[],
};}

class IntegrityDatabase implements SqlDatabase{
  prepare(sql:string):SqlStatement{return new IntegrityStatement(sql);}
  batch(_statements:readonly SqlStatement[]):Promise<SqlRunResult[]>{throw new Error('unexpected_batch');}
  exec():Promise<void>{throw new Error('unexpected_exec');}
}

class IntegrityStatement implements SqlStatement{
  constructor(private readonly sql:string){}
  bind():SqlStatement{return this;}
  first<T>():Promise<T|null>{
    if(this.sql.includes('FROM formal_orders'))return Promise.resolve({id:'order-1',buyer_customer_id:'buyer-1',market:'AMAZON_JP'} as T);
    if(this.sql.includes('formal_order_effective_operational_state'))return Promise.resolve({operational_state:'NORMAL'} as T);
    throw new Error(`unexpected_first:${this.sql}`);
  }
  all<T>():Promise<SqlAllResult<T>>{
    if(this.sql.includes('formal_order_operational_events'))return Promise.resolve({results:[]} as SqlAllResult<T>);
    if(this.sql.includes('formal_order_financial_adjustments'))return Promise.resolve({results:[{adjustment_id:'adjustment-1',formal_order_id:'order-1',source_operational_event_id:null,adjustment_scope:'PROJECTED_GROSS_PROFIT',amount_cny_fen:'5000',reason:'修正',actor_staff_id:'integrity-owner',created_at:1}]} as SqlAllResult<T>);
    throw new Error(`unexpected_all:${this.sql}`);
  }
  run():Promise<SqlRunResult>{throw new Error('unexpected_run');}
}
