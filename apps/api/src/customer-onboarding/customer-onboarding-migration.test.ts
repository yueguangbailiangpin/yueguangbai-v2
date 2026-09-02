import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, SqliteDatabase } from '@ygb/testkit';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('customer portal onboarding migrations 0049-0050',()=>{
  it('preserves the onboarding schema beneath the stage 3 clean baseline',async()=>{
    database=createMigratedTestDatabase();
    const state=await database.prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`)
      .first<{schema_version:number}>();
    expect(Number(state?.schema_version)).toBe(43);
  });

  it('creates seller invitation persistence',async()=>{
    database=createMigratedTestDatabase();
    const objects=await database.prepare(`SELECT type,name FROM sqlite_schema
      WHERE name IN (
        'customer_seller_invitations',
        'customer_seller_invitation_events'
      ) ORDER BY name`).all<{type:string;name:string}>();
    expect(objects.results.map((row)=>row.name)).toEqual([
      'customer_seller_invitation_events',
      'customer_seller_invitations',
    ]);
  });

  it('keeps the seller onboarding channel in seller_channels only',async()=>{
    database=createMigratedTestDatabase();
    const row=await database.prepare(`SELECT id,code,name,status FROM seller_channels
      WHERE id='seller-channel-portal-onboarding'`).first<{id:string;code:string;name:string;status:string}>();
    expect(row).toEqual({
      id:'seller-channel-portal-onboarding',
      code:'portal-onboarding',
      name:'新系统卖家账号开通',
      status:'ACTIVE',
    });
    // D-056: acquisition_channels is retired; separation holds by absence.
  });
});
