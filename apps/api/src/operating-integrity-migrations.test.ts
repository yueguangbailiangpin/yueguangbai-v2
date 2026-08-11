import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('frozen operating integrity migrations 0051-0053',()=>{
  it('reaches schema 53 with immutable facts reporting and identity resolution objects',async()=>{
    database=createMigratedTestDatabase();
    const state=await database.prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`).first<{schema_version:number}>();
    expect(Number(state?.schema_version)).toBe(53);
    const names=await database.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE name IN (
      'acquisition_customer_intake_facts','acquisition_reporting_config','acquisition_historical_source_exemptions',
      'acquisition_lead_source_corrections','seller_customer_groups','seller_customer_group_marketplaces',
      'customer_identity_manual_bindings','customer_identity_resolution_cases','customer_identity_resolution_events',
      'uq_staff_marketplace_role_primary','uq_acquisition_lead_active_identity_market',
      'trg_staff_reactivated_restore_primary_scope','trg_acquisition_reporting_precision_immutable',
      'trg_acquisition_source_correction_guard','trg_acquisition_intake_facts_no_update'
    )`).all<{type:string;name:string;sql:string}>();
    const found=new Set(names.results.map((row)=>row.name));
    for(const required of [
      'acquisition_customer_intake_facts','acquisition_reporting_config','acquisition_historical_source_exemptions',
      'acquisition_lead_source_corrections','seller_customer_groups','seller_customer_group_marketplaces',
      'customer_identity_manual_bindings','customer_identity_resolution_cases','customer_identity_resolution_events',
      'uq_staff_marketplace_role_primary','uq_acquisition_lead_active_identity_market',
      'trg_staff_reactivated_restore_primary_scope','trg_acquisition_reporting_precision_immutable',
      'trg_acquisition_source_correction_guard','trg_acquisition_intake_facts_no_update',
    ])expect(found.has(required),required).toBe(true);
    const legacy=await database.prepare(`SELECT name FROM sqlite_schema WHERE type='index' AND name='uq_acquisition_lead_active_identity'`).first();
    expect(legacy).toBeNull();
    const column=await database.prepare(`SELECT name,type,"notnull",dflt_value FROM pragma_table_info('staff_marketplace_scopes') WHERE name='scope_kind'`).first<any>();
    expect(column).toMatchObject({name:'scope_kind',type:'TEXT',notnull:1,dflt_value:"'PRIMARY'"});
  });

  it('allows support coverage while keeping exactly one active primary per role and marketplace',async()=>{
    database=createMigratedTestDatabase();
    database.exec(`
      INSERT INTO staff_users(id,display_name,status,authorization_version,session_version,version,created_at,updated_at,disabled_at)
      VALUES
        ('integrity-staff-primary','主负责人','ACTIVE',1,1,1,1,1,NULL),
        ('integrity-staff-support','协助一','ACTIVE',1,1,1,1,1,NULL),
        ('integrity-staff-support2','协助二','ACTIVE',1,1,1,1,1,NULL);
      INSERT INTO staff_marketplace_scopes(
        id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
      ) VALUES
        ('integrity-scope-primary','integrity-staff-primary','pre_sales','AMAZON_JP','ACTIVE','integrity-staff-primary',1,NULL,'TEST',1,1,'PRIMARY'),
        ('integrity-scope-support','integrity-staff-support','pre_sales','AMAZON_JP','ACTIVE','integrity-staff-primary',1,NULL,'TEST',1,1,'SUPPORT'),
        ('integrity-scope-support2','integrity-staff-support2','pre_sales','AMAZON_JP','ACTIVE','integrity-staff-primary',1,NULL,'TEST',1,1,'SUPPORT');
    `);
    await expect(database.prepare(`INSERT INTO staff_marketplace_scopes(
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES('integrity-second-primary','integrity-staff-support','pre_sales','AMAZON_JP','ACTIVE','integrity-staff-primary',2,NULL,'TEST',2,2,'PRIMARY')`).run()).rejects.toThrow();
  });

  it('restores a re-enabled employee as primary only when no other active primary exists',async()=>{
    database=createMigratedTestDatabase();
    database.exec(`
      INSERT INTO staff_users(id,display_name,status,authorization_version,session_version,version,created_at,updated_at,disabled_at)
      VALUES('integrity-reactivate-staff','重新启用','DISABLED',1,1,1,1,1,1);
      INSERT INTO staff_marketplace_scopes(
        id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
      ) VALUES('integrity-reactivate-scope','integrity-reactivate-staff','seller_ops','AMAZON_JP','ACTIVE','integrity-reactivate-staff',1,NULL,'TEST',1,1,'SUPPORT');
      UPDATE staff_users SET status='ACTIVE',disabled_at=NULL,updated_at=2 WHERE id='integrity-reactivate-staff';
    `);
    const scope=await database.prepare(`SELECT scope_kind FROM staff_marketplace_scopes WHERE id='integrity-reactivate-scope'`).first<{scope_kind:string}>();
    expect(scope?.scope_kind).toBe('PRIMARY');
  });
});
