import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp } from '../app';
import { registerOperationalReadinessRoutes } from './routes';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('operational alert production readiness',()=>{
  it('fails production closed until the local sink is enabled and explicitly verified',async()=>{
    database=createMigratedTestDatabase();
    for(const [mode,verified,expected] of [
      ['disabled','true','failed'],
      ['local','false','failed'],
      ['local','true','ok'],
    ] as const){
      const response=await ready({APP_ENVIRONMENT:'production',OPERATIONAL_ALERT_MODE:mode,OPERATIONAL_ALERT_SINK_VERIFIED:verified});
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({data:{status:'not_ready',checks:{operational_alerts:expected}}});
    }
  });

  it('allows an explicit disabled policy only outside production',async()=>{
    database=createMigratedTestDatabase();
    for(const environment of ['local','staging'] as const){
      const response=await ready({APP_ENVIRONMENT:environment,OPERATIONAL_ALERT_MODE:'disabled',OPERATIONAL_ALERT_SINK_VERIFIED:'false'});
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({data:{checks:{operational_alerts:'ok'}}});
    }
  });
});

async function ready(bindings:Record<string,unknown>):Promise<Response>{
  const app=createApp();registerOperationalReadinessRoutes(app);
  return await app.request('https://app.example.test/ready',{}, {DB:database!,...bindings});
}
