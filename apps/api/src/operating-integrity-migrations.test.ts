import { MARKETPLACE_RUNTIME_DEFINITIONS } from '@ygb/contracts';
import { afterEach,describe,expect,it } from 'vitest';
import { createMigratedTestDatabase,type SqliteDatabase } from '@ygb/testkit';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('frozen operating integrity migrations 0051-0064',()=>{
  it('reaches schema 68 with advance cash and local-date guards installed',async()=>{
    database=createMigratedTestDatabase();
    const state=await database.prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`).first<{schema_version:number}>();expect(Number(state?.schema_version)).toBe(68);
    const required=[
      'acquisition_customer_intake_facts','acquisition_reporting_config','acquisition_historical_source_exemptions','acquisition_lead_source_corrections','seller_customer_groups','seller_customer_group_marketplaces','customer_identity_manual_bindings','customer_identity_resolution_cases','customer_identity_resolution_events',
      'marketplace_runtime_config','formal_order_operational_events','formal_order_financial_adjustments','review_visibility_observations','buyer_advance_principal_entries','buyer_advance_principal_settlements','buyer_advance_principal_entry_files','buyer_advance_principal_overpayments',
      'customer_login_identifier_change_events','seller_member_invitations','seller_member_invitation_events','acquisition_machine_credentials','acquisition_machine_marketplaces','acquisition_machine_channels','acquisition_machine_rate_buckets','production_recovery_attestations','seller_member_portal_store_grants','formal_order_effective_dates','uq_staff_marketplace_role_primary','uq_acquisition_lead_active_identity_market',
      'trg_staff_reactivated_restore_primary_scope','trg_acquisition_reporting_precision_immutable','trg_acquisition_source_correction_guard','trg_acquisition_intake_facts_no_update','trg_staff_permission_override_deny_only_insert','trg_acquisition_channel_no_new_both','trg_acquisition_channel_staff_label_immutable','trg_review_visibility_requires_approved_review','trg_advance_principal_payment_before_obligation','trg_formal_order_financial_adjustment_event_guard','trg_seller_member_portal_grant_scope_guard','trg_acquisition_machine_channel_scope_guard',
      'trg_customer_persona_privilege_session_bump','trg_formal_order_financial_adjustment_profit_only','trg_review_approval_requires_normal_order','trg_buyer_refund_obligation_requires_normal_order','trg_review_service_fee_requires_normal_order','trg_buyer_advance_principal_entry_files_guard','trg_advance_principal_reversal_total_guard','trg_marketplace_runtime_config_no_update',
    ];
    const rows=await database.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE name IN (${required.map(()=>'?').join(',')})`).bind(...required).all<{type:string;name:string;sql:string}>();const found=new Set(rows.results.map((row)=>row.name));for(const name of required)expect(found.has(name),name).toBe(true);
    expect(await database.prepare(`SELECT name FROM sqlite_schema WHERE type='index' AND name='uq_acquisition_active_identity_per_type'`).first()).toBeNull();
    const marketIndex=await database.prepare(`SELECT sql FROM sqlite_schema WHERE type='index' AND name='uq_acquisition_lead_active_identity_market'`).first<{sql:string}>();expect(marketIndex?.sql).toContain('lead_type,marketplace_code,identity_hash');
    const scope=await database.prepare(`SELECT name,type,"notnull",dflt_value FROM pragma_table_info('staff_marketplace_scopes') WHERE name='scope_kind'`).first<any>();expect(scope).toMatchObject({name:'scope_kind',type:'TEXT',notnull:1,dflt_value:"'PRIMARY'"});
    expect(await database.prepare(`SELECT name FROM pragma_table_info('formal_orders') WHERE name='canonical_marketplace_code'`).first()).not.toBeNull();expect(await database.prepare(`SELECT name FROM pragma_table_info('formal_orders') WHERE name='marketplace_business_date'`).first()).not.toBeNull();
  });

  it('keeps the migration-controlled Marketplace runtime mirror equal to the typed registry',async()=>{
    database=createMigratedTestDatabase();
    const rows=await database.prepare(`SELECT marketplace_code,legacy_order_code,business_timezone,reporting_timezone,currency_code,currency_exponent FROM marketplace_runtime_config ORDER BY marketplace_code`).all<any>();
    const actual=rows.results.map((row)=>({marketplace_code:String(row.marketplace_code),legacy_order_code:String(row.legacy_order_code),business_timezone:String(row.business_timezone),reporting_timezone:String(row.reporting_timezone),currency_code:String(row.currency_code),currency_exponent:Number(row.currency_exponent)}));
    const expected=Object.values(MARKETPLACE_RUNTIME_DEFINITIONS).map((row)=>({marketplace_code:row.marketplace_code,legacy_order_code:row.legacy_order_code,business_timezone:row.business_timezone,reporting_timezone:row.reporting_timezone,currency_code:row.currency_code,currency_exponent:row.currency_exponent})).sort((left,right)=>left.marketplace_code.localeCompare(right.marketplace_code));
    expect(actual).toEqual(expected);
  });

  it('allows support coverage while keeping exactly one active primary per role and marketplace',async()=>{
    database=createMigratedTestDatabase();database.exec(`
      INSERT INTO staff_users(id,display_name,status,authorization_version,session_version,version,created_at,updated_at,disabled_at) VALUES
        ('integrity-staff-primary','主负责人','ACTIVE',1,1,1,1,1,NULL),('integrity-staff-support','协助一','ACTIVE',1,1,1,1,1,NULL),('integrity-staff-support2','协助二','ACTIVE',1,1,1,1,1,NULL),('integrity-staff-primary2','第二主候选','ACTIVE',1,1,1,1,1,NULL);
      INSERT INTO staff_marketplace_scopes(id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,revoked_at,reason,created_at,updated_at,scope_kind) VALUES
        ('integrity-scope-primary','integrity-staff-primary','pre_sales','AMAZON_JP','ACTIVE','integrity-staff-primary',1,NULL,'TEST',1,1,'PRIMARY'),
        ('integrity-scope-support','integrity-staff-support','pre_sales','AMAZON_JP','ACTIVE','integrity-staff-primary',1,NULL,'TEST',1,1,'SUPPORT'),
        ('integrity-scope-support2','integrity-staff-support2','pre_sales','AMAZON_JP','ACTIVE','integrity-staff-primary',1,NULL,'TEST',1,1,'SUPPORT');`);
    const supportCount=await database.prepare(`SELECT COUNT(*) AS count FROM staff_marketplace_scopes WHERE role_code='pre_sales' AND marketplace_code='AMAZON_JP' AND status='ACTIVE' AND scope_kind='SUPPORT'`).first<{count:number}>();expect(Number(supportCount?.count)).toBe(2);
    await expect(database.prepare(`INSERT INTO staff_marketplace_scopes(id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,revoked_at,reason,created_at,updated_at,scope_kind) VALUES('integrity-second-primary','integrity-staff-primary2','pre_sales','AMAZON_JP','ACTIVE','integrity-staff-primary',2,NULL,'TEST',2,2,'PRIMARY')`).run()).rejects.toThrow();
  });

  it('restores a re-enabled employee as primary only when no other active primary exists',async()=>{
    database=createMigratedTestDatabase();database.exec(`
      INSERT INTO staff_users(id,display_name,status,authorization_version,session_version,version,created_at,updated_at,disabled_at) VALUES('integrity-reactivate-staff','重新启用','DISABLED',1,1,1,1,1,1);
      INSERT INTO staff_marketplace_scopes(id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,revoked_at,reason,created_at,updated_at,scope_kind) VALUES('integrity-reactivate-scope','integrity-reactivate-staff','seller_ops','AMAZON_JP','ACTIVE','integrity-reactivate-staff',1,NULL,'TEST',1,1,'SUPPORT');
      UPDATE staff_users SET status='ACTIVE',disabled_at=NULL,updated_at=2 WHERE id='integrity-reactivate-staff';`);
    const scope=await database.prepare(`SELECT scope_kind FROM staff_marketplace_scopes WHERE id='integrity-reactivate-scope'`).first<{scope_kind:string}>();expect(scope?.scope_kind).toBe('PRIMARY');
  });

  it('keeps operational channel audience and staff-label safeguards in the database',async()=>{
    database=createMigratedTestDatabase();const activeGrant=await database.prepare(`SELECT COUNT(*) AS count FROM staff_permission_overrides WHERE status='ACTIVE' AND effect='GRANT'`).first<{count:number}>();expect(Number(activeGrant?.count)).toBe(0);
    const channelTrigger=await database.prepare(`SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='trg_acquisition_channel_no_new_both'`).first<{sql:string}>(),labelTrigger=await database.prepare(`SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='trg_acquisition_channel_staff_label_immutable'`).first<{sql:string}>();expect(channelTrigger?.sql).toContain("NEW.lead_type='BOTH'");expect(labelTrigger?.sql).toContain('staff_label');
  });
});
