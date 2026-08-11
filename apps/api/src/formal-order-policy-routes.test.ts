import { afterEach,describe,expect,it } from 'vitest';
import { Hono } from 'hono';
import { SqliteDatabase } from '@ygb/testkit';
import { registerFormalOrderPolicyGuards } from './formal-order-policy-routes';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('formal order policy HTTP guard',()=>{
  it('returns 409 while an order is abnormal and allows the same route after RESOLVED',async()=>{
    database=new SqliteDatabase(':memory:');
    database.exec(`
      CREATE TABLE formal_orders(id TEXT PRIMARY KEY);
      CREATE TABLE formal_order_operational_events(id TEXT PRIMARY KEY,formal_order_id TEXT,event_type TEXT,created_at INTEGER);
      CREATE VIEW formal_order_effective_operational_state AS
      SELECT formal_order.id AS formal_order_id,
        COALESCE((SELECT CASE event.event_type WHEN 'RESOLVED' THEN 'NORMAL' ELSE event.event_type END
          FROM formal_order_operational_events event WHERE event.formal_order_id=formal_order.id
          ORDER BY event.created_at DESC,event.id DESC LIMIT 1),'NORMAL') AS operational_state
      FROM formal_orders formal_order;
      INSERT INTO formal_orders VALUES('formal-order-http-1');
      INSERT INTO formal_order_operational_events VALUES('event-http-cancel','formal-order-http-1','BUSINESS_VOID',100);
    `);
    const app=new Hono<any>();
    app.use('*',async(context,next)=>{context.set('requestId','wave15-request');await next();});
    registerFormalOrderPolicyGuards(app);
    app.post('/api/staff/buyer-advance-principal/:formalOrderId/payments',(context)=>context.json({accepted:true}));

    const blocked=await app.request('https://test.local/api/staff/buyer-advance-principal/formal-order-http-1/payments',{method:'POST'},{DB:database});
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({error:{code:'CONFLICT'}});

    database.exec(`INSERT INTO formal_order_operational_events VALUES('event-http-resolved','formal-order-http-1','RESOLVED',200);`);
    const allowed=await app.request('https://test.local/api/staff/buyer-advance-principal/formal-order-http-1/payments',{method:'POST'},{DB:database});
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({accepted:true});
  });
});
