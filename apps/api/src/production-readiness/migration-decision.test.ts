import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe,expect,it } from 'vitest';
import { createMigratedTestDatabase } from '@ygb/testkit';

describe('current production readiness migration decision',()=>{
  it('keeps evidence external while accepting the governed schema 69',async()=>{
    const root=path.resolve(import.meta.dirname,'../../../..');
    const migrations=readdirSync(path.join(root,'migrations')).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
    expect(migrations).toHaveLength(69);
    expect(migrations.at(-9)).toBe('0061_post_confirmation_integrity_guards.sql');
    expect(migrations.at(-8)).toBe('0062_runtime_authority_and_privilege_guards.sql');
    expect(migrations.at(-7)).toBe('0063_advance_principal_proof_and_overpayment.sql');
    expect(migrations.at(-6)).toBe('0064_marketplace_local_date_truth.sql');
    expect(migrations.at(-5)).toBe('0065_retire_feishu_artifacts.sql');
    expect(migrations.at(-4)).toBe('0066_advance_cash_integrity.sql');
    expect(migrations.at(-3)).toBe('0067_advance_v1_full_payment.sql');
    expect(migrations.at(-2)).toBe('0068_customer_security_deny_password_rate_limit.sql');
    expect(migrations.at(-1)).toBe('0069_retire_seller_agreement_rate_runtime.sql');
    expect(migrations.map((file)=>Number(file.slice(0,4)))).toEqual(Array.from({length:69},(_,index)=>index+1));
    const database=createMigratedTestDatabase();
    try{
      expect(await database.prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`).first()).toEqual({schema_version:69});
      const forbidden=await database.prepare(`SELECT name FROM sqlite_schema WHERE name LIKE '%backup%' OR name LIKE '%release_evidence%'`).all();
      expect(forbidden.results).toEqual([]);
    }finally{database.close();}
  });
});
