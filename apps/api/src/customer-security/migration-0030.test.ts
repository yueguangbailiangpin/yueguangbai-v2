import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '@ygb/testkit';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('Migration 0030 customer identity upgrade and rollback boundary', () => {
  it('upgrades populated 0029 Buyer and Seller accounts without changing credentials', () => {
    database = new SqliteDatabase();
    applyThrough(database, 29);
    seedLegacyAccounts(database);
    const before = database.raw.prepare(`
      SELECT id, identity_subject_id, account_type, session_version, version
      FROM customer_login_accounts ORDER BY id
    `).all();

    apply(database, '0030_customer_multipersona_invitation_recovery.sql');

    expect(database.raw.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get()).toEqual({ schema_version: 30 });
    expect(database.raw.prepare(`
      SELECT id, identity_subject_id, account_type, session_version, version
      FROM customer_login_accounts ORDER BY id
    `).all()).toEqual(before);
    expect(database.raw.prepare(`
      SELECT account_id, persona_type FROM customer_account_personas
      ORDER BY account_id
    `).all()).toEqual([
      { account_id: 'account-buyer-old', persona_type: 'BUYER' },
      { account_id: 'account-seller-old', persona_type: 'SELLER_MEMBER' },
    ]);
    expect(database.raw.prepare('PRAGMA integrity_check').get())
      .toEqual({ integrity_check: 'ok' });
    expect(database.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('marks dual-persona facts as forward-only and blocks the legacy rebind path', () => {
    database = new SqliteDatabase();
    applyThrough(database, 30);
    seedSellerForDual(database);
    database.exec(`
      INSERT INTO buyer_customers (
        id, identity_subject_id, marketplace_code, buyer_channel_id,
        buyer_customer_no, buyer_sequence, first_valid_order_business_date,
        display_name, access_status, identity_review_status,
        version, created_at, updated_at, activated_at, disabled_at
      ) VALUES ('buyer-dual', 'subject-dual', 'JP', 'buyer-channel-dual',
        NULL, NULL, NULL, '双身份', 'ACTIVE', 'CLEAR',
        1, 2000, 2000, 2000, NULL);
    `);
    expect(database.raw.prepare(`
      SELECT persona_type FROM customer_account_personas
      WHERE account_id='account-dual' ORDER BY persona_type
    `).all()).toEqual([
      { persona_type: 'BUYER' }, { persona_type: 'SELLER_MEMBER' },
    ]);
    expect(() => database!.exec(`
      UPDATE customer_login_accounts
      SET identity_subject_id='subject-other', version=version+1
      WHERE id='account-dual'
    `)).toThrow(/owner_conflict_workflow/iu);
  });

  it('uses the real 0030 persona trigger plus 0062 privilege trigger to revoke older sessions exactly once', () => {
    database = new SqliteDatabase();
    applyThrough(database, 30);
    seedSellerForDual(database);
    applyRange(database,31,62);

    expect(database.raw.prepare(`
      SELECT session_version,version FROM customer_login_accounts
      WHERE id='account-dual'
    `).get()).toEqual({session_version:1,version:1});
    expect(database.raw.prepare(`
      SELECT persona_type FROM customer_account_personas
      WHERE account_id='account-dual'
    `).all()).toEqual([{persona_type:'SELLER_MEMBER'}]);

    database.exec(`
      INSERT INTO buyer_customers (
        id, identity_subject_id, marketplace_code, buyer_channel_id,
        buyer_customer_no, buyer_sequence, first_valid_order_business_date,
        display_name, access_status, identity_review_status,
        version, created_at, updated_at, activated_at, disabled_at
      ) VALUES ('buyer-dual-current', 'subject-dual', 'JP', 'buyer-channel-dual',
        NULL, NULL, NULL, '双身份当前版', 'ACTIVE', 'CLEAR',
        1, 62000, 62000, 62000, NULL);
    `);

    expect(database.raw.prepare(`
      SELECT persona_type FROM customer_account_personas
      WHERE account_id='account-dual' ORDER BY persona_type
    `).all()).toEqual([
      {persona_type:'BUYER'},
      {persona_type:'SELLER_MEMBER'},
    ]);
    expect(database.raw.prepare(`
      SELECT session_version,version FROM customer_login_accounts
      WHERE id='account-dual'
    `).get()).toEqual({session_version:2,version:2});

    applyRange(database,63,64);
    expect(database.raw.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get()).toEqual({schema_version:64});
    expect(database.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

function migrations() {
  const directory = path.resolve(process.cwd(), 'migrations');
  return {
    directory,
    files: readdirSync(directory)
      .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name)).sort(),
  };
}

function applyThrough(db: SqliteDatabase, count: number): void {
  for (const name of migrations().files.slice(0, count)) apply(db, name);
}

function applyRange(db:SqliteDatabase,from:number,to:number):void{
  const {files}=migrations();
  for(let version=from;version<=to;version+=1){
    const name=files[version-1];
    if(!name||Number(name.slice(0,4))!==version)throw new Error(`missing_migration_${version}`);
    apply(db,name);
  }
}

function apply(db: SqliteDatabase, name: string): void {
  const { directory } = migrations();
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(readFileSync(path.join(directory, name), 'utf8'));
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch { /* already rolled back */ }
    throw error;
  }
}

function seedLegacyAccounts(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES ('buyer-channel-old', 'OLD', '旧买家', 'ACTIVE',
      1, 1, 1000, 1000, NULL);
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES ('subject-buyer-old', 'BUYER_CUSTOMER', 1000),
      ('subject-seller-old', 'SELLER_ORG_MEMBER', 1000);
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence, first_valid_order_business_date,
      display_name, access_status, identity_review_status,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES ('buyer-old', 'subject-buyer-old', 'JP', 'buyer-channel-old',
      NULL, NULL, NULL, '旧买家', 'ACTIVE', 'CLEAR',
      1, 1000, 1000, 1000, NULL);
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id,
      current_channel_id, seller_sequence, organization_name,
      status, version, created_at, updated_at, activated_at, disabled_at
    ) VALUES ('seller-org-old', 'JP', 'seller-old',
      'seller-channel-ido-mango', 'seller-channel-ido-mango', 1,
      '旧卖家', 'ACTIVE', 1, 1000, 1000, 1000, NULL);
    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id, member_number,
      username_fallback, display_name, role, primary_owner, status,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES ('member-old', 'subject-seller-old', 'seller-org-old', 1,
      'seller-old-1', '旧成员', 'OWNER', 1, 'ACTIVE',
      1, 1000, 1000, 1000, NULL);
    INSERT INTO customer_login_accounts (
      id, identity_subject_id, account_type, login_identifier_display,
      login_identifier_normalized, status, session_version,
      password_change_required, version, created_at, updated_at,
      activated_at, disabled_at, registration_source
    ) VALUES
      ('account-buyer-old', 'subject-buyer-old', 'BUYER', 'buyer_old',
        'buyer_old', 'ACTIVE', 3, 0, 4, 1000, 1000, 1000, NULL,
        'STAFF_ACTIVATION'),
      ('account-seller-old', 'subject-seller-old', 'SELLER_MEMBER', 'seller_old',
        'seller_old', 'ACTIVE', 2, 0, 5, 1000, 1000, 1000, NULL,
        'STAFF_ACTIVATION');
  `);
}

function seedSellerForDual(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES ('buyer-channel-dual', 'DUAL', '双身份', 'ACTIVE',
      1, 1, 1000, 1000, NULL);
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES ('subject-dual', 'SELLER_ORG_MEMBER', 1000),
      ('subject-other', 'BUYER_CUSTOMER', 1000);
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id,
      current_channel_id, seller_sequence, organization_name,
      status, version, created_at, updated_at, activated_at, disabled_at
    ) VALUES ('seller-org-dual', 'JP', 'seller-dual',
      'seller-channel-ido-mango', 'seller-channel-ido-mango', 1,
      '双身份卖家', 'ACTIVE', 1, 1000, 1000, 1000, NULL);
    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id, member_number,
      username_fallback, display_name, role, primary_owner, status,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES ('member-dual', 'subject-dual', 'seller-org-dual', 1,
      'seller-dual-1', '双身份成员', 'OWNER', 1, 'ACTIVE',
      1, 1000, 1000, 1000, NULL);
    INSERT INTO customer_login_accounts (
      id, identity_subject_id, account_type, login_identifier_display,
      login_identifier_normalized, status, session_version,
      password_change_required, version, created_at, updated_at,
      activated_at, disabled_at, registration_source
    ) VALUES ('account-dual', 'subject-dual', 'SELLER_MEMBER', 'dual_wx',
      'dual_wx', 'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL,
      'STAFF_ACTIVATION');
  `);
}
