import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, SqliteDatabase } from '@ygb/testkit';
import {
  bootstrapStagingFirstOwner,
  type StagingFirstOwnerInput,
} from './first-owner';
import { resolveOwnerFallback } from '../staff-assignment/candidate-resolver';

const DATABASE_ID = '11111111-1111-4111-8111-111111111111';
const LONG_RUNNING_TEST_TIMEOUT_MS = 30_000;
const INPUT: StagingFirstOwnerInput = {
  environment: 'staging',
  databaseName: 'yueguangbai-v2-staging',
  databaseId: DATABASE_ID,
  displayName: 'Staging Owner',
  email: 'OWNER@EXAMPLE.TEST',
  idempotencyKey: 'staging:first-owner:v1',
};
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('staging first owner bootstrap', () => {
  it('atomically creates exactly one owner authority and replays safely', async () => {
    database = migratedEmptyDatabase();
    const first = await bootstrapStagingFirstOwner(database, INPUT, 1000);
    const replay = await bootstrapStagingFirstOwner(database, INPUT, 1100);
    expect(replay).toEqual(first);
    expect(database.raw.prepare(`SELECT
      (SELECT COUNT(*) FROM staff_users) AS staff,
      (SELECT COUNT(*) FROM staff_role_assignments WHERE status='ACTIVE') AS roles,
      (SELECT COUNT(*) FROM staff_email_identities WHERE status='ACTIVE') AS emails,
      (SELECT COUNT(*) FROM staff_marketplace_scopes) AS scopes,
      (SELECT COUNT(*) FROM staff_assignment_fallbacks
        WHERE marketplace_code='AMAZON_JP') AS assignment_fallbacks,
      (SELECT COUNT(*) FROM staff_sessions) AS sessions,
      (SELECT COUNT(*) FROM buyer_channels
        WHERE id='staging-buyer-channel' AND code='STG' AND status='ACTIVE') AS buyer_channels,
      (SELECT COUNT(*) FROM staff_authorization_events) AS authorization_events,
      (SELECT COUNT(*) FROM audit_events
        WHERE event_type='STAGING_FIRST_OWNER_BOOTSTRAPPED') AS audits
    `).get()).toEqual({
      staff: 1,
      roles: 1,
      emails: 1,
      scopes: 0,
      assignment_fallbacks: 1,
      sessions: 0,
      buyer_channels: 1,
      authorization_events: 1,
      audits: 1,
    });
    expect(database.raw.prepare(`SELECT normalized_email
      FROM staff_email_identities`).get()).toEqual({
      normalized_email: 'owner@example.test',
    });
    expect(database.raw.prepare(`SELECT fallback.staff_id
      FROM staff_assignment_fallbacks fallback
      JOIN staff_role_assignments role ON role.staff_id=fallback.staff_id
      WHERE fallback.marketplace_code='AMAZON_JP'
        AND role.role_code='owner' AND role.status='ACTIVE'`).get()).toEqual({
      staff_id: first.staff_id,
    });
    expect((await resolveOwnerFallback(database, {
      marketplaceCode: 'AMAZON_JP',
      dutyCode: 'SELLER_ACCOUNT_MANAGER',
      workType: 'PRODUCT_APPLICATION_REVIEW',
    })).staffId).toBe(first.staff_id);
    const command = database.raw.prepare(`SELECT response_json
      FROM command_idempotency_records
      WHERE action='BOOTSTRAP_STAGING_FIRST_OWNER'`).get() as {response_json:string};
    expect(command.response_json).not.toContain('owner@example.test');
    expect(JSON.stringify(first)).not.toContain('owner@example.test');
  });

  it('rejects production-like targets before writing any command fact', async () => {
    for (const override of [
      { environment: 'production' },
      { databaseName: 'yueguangbai-v2-production' },
      { databaseName: 'default' },
      { databaseId: 'not-a-database-id' },
    ]) {
      database?.close();
      database = migratedEmptyDatabase();
      await expect(bootstrapStagingFirstOwner(database, {
        ...INPUT,
        ...override,
      }, 1000)).rejects.toMatchObject({ code: 'INVALID_STAGING_TARGET' });
      expect(database.raw.prepare(`SELECT COUNT(*) AS total
        FROM command_idempotency_records`).get()).toEqual({ total: 0 });
    }
  }, LONG_RUNNING_TEST_TIMEOUT_MS);

  it('fails closed for partial or pre-existing Staff authority', async () => {
    database = migratedEmptyDatabase();
    database.raw.prepare(`INSERT INTO staff_users(
      id,display_name,status,authorization_version,version,
      created_at,updated_at,disabled_at,session_version
    ) VALUES('existing-owner','Existing','ACTIVE',1,1,1,1,NULL,1)`).run();
    await expect(bootstrapStagingFirstOwner(database, INPUT, 1000))
      .rejects.toMatchObject({ code: 'STAFF_AUTHORITY_NOT_EMPTY' });
    expect(database.raw.prepare('SELECT COUNT(*) AS total FROM staff_users').get())
      .toEqual({ total: 1 });
    expect(database.raw.prepare('SELECT COUNT(*) AS total FROM staff_role_assignments').get())
      .toEqual({ total: 0 });
  });

  it('rejects orphaned legacy or Access authority facts even without a Staff user',async()=>{
    database=migratedEmptyDatabase();
    database.raw.exec('PRAGMA foreign_keys=OFF');
    database.raw.prepare(`INSERT INTO staff_email_identities(
      id,staff_id,normalized_email,status,verified_at,last_login_at,
      created_at,updated_at,revoked_at
    ) VALUES('orphan-email-identity','missing-staff','orphan@example.test',
      'ACTIVE',NULL,NULL,1,1,NULL)`).run();
    database.raw.exec('PRAGMA foreign_keys=ON');
    await expect(bootstrapStagingFirstOwner(database,INPUT,1000))
      .rejects.toMatchObject({code:'STAFF_AUTHORITY_NOT_EMPTY'});
    expect(database.raw.prepare('SELECT COUNT(*) AS total FROM staff_users').get())
      .toEqual({total:0});
  });

  it('fails closed when the staging synthetic Buyer foundation already exists',async()=>{
    database=migratedEmptyDatabase();
    database.raw.prepare(`INSERT INTO buyer_channels(
      id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at
    ) VALUES('unexpected-channel','OLD','Unexpected','ACTIVE',1,1,1,1,NULL)`).run();
    await expect(bootstrapStagingFirstOwner(database,INPUT,1000))
      .rejects.toMatchObject({code:'STAGING_FOUNDATION_NOT_EMPTY'});
    expect(database.raw.prepare('SELECT COUNT(*) AS total FROM staff_users').get())
      .toEqual({total:0});
    expect(database.raw.prepare('SELECT COUNT(*) AS total FROM buyer_channels').get())
      .toEqual({total:1});
  });

  it.each([
    ['Customer',`INSERT INTO customer_identity_subjects(id,subject_type,created_at)
      VALUES('dirty-customer','BUYER_CUSTOMER',1)`],
    ['Seller',`INSERT INTO seller_organizations(
      id,marketplace_code,seller_code,origin_channel_id,current_channel_id,
      seller_sequence,organization_name,status,version,created_at,updated_at
    ) VALUES('dirty-seller','AMAZON_JP','S01','dirty-origin','dirty-current',1,
      'Dirty seller','DISABLED',1,1,1)`],
    ['Product',`INSERT INTO products(
      id,organization_id,store_id,marketplace_code,asin_display,
      asin_normalized,status,current_version_no,version,created_at,updated_at
    ) VALUES('dirty-product','missing-seller','missing-store','AMAZON_JP','B000000001',
      'B000000001','ACTIVE',1,1,1,1)`],
    ['Order',`INSERT INTO integration_outbox(
      id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,
      payload_hash,status,available_at,attempt_count,created_at,updated_at
    ) VALUES('dirty-outbox','dirty-dedup-key-123456','ORDER_EVENT','ORDER','o','{}',
      '${'a'.repeat(64)}','PENDING',1,0,1,1)`],
  ])('fails closed for pre-existing %s business stock',async(_label,insertSql)=>{
    database=migratedEmptyDatabase();database.raw.exec('PRAGMA foreign_keys=OFF');
    database.raw.exec(insertSql);database.raw.exec('PRAGMA foreign_keys=ON');
    await expect(bootstrapStagingFirstOwner(database,INPUT,1000))
      .rejects.toMatchObject({code:'STAGING_FOUNDATION_NOT_EMPTY'});
    expect(database.raw.prepare('SELECT COUNT(*) AS total FROM staff_users').get())
      .toEqual({total:0});
  });

  it('rejects a different identity under the same bootstrap key', async () => {
    database = migratedEmptyDatabase();
    await bootstrapStagingFirstOwner(database, INPUT, 1000);
    await expect(bootstrapStagingFirstOwner(database, {
      ...INPUT,
      email: 'different@example.test',
    }, 1100)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(database.raw.prepare('SELECT COUNT(*) AS total FROM staff_users').get())
      .toEqual({ total: 1 });
  });

  it('rolls back every authority and audit fact when the command batch fails', async () => {
    database = migratedEmptyDatabase();
    database.exec(`CREATE TRIGGER reject_staging_owner_audit
      BEFORE INSERT ON audit_events
      WHEN NEW.event_type='STAGING_FIRST_OWNER_BOOTSTRAPPED'
      BEGIN SELECT RAISE(ABORT,'simulated_audit_failure'); END;`);
    await expect(bootstrapStagingFirstOwner(database, INPUT, 1000))
      .rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(database.raw.prepare(`SELECT
      (SELECT COUNT(*) FROM staff_users) AS staff,
      (SELECT COUNT(*) FROM staff_role_assignments) AS roles,
      (SELECT COUNT(*) FROM staff_email_identities) AS emails,
      (SELECT COUNT(*) FROM staff_assignment_fallbacks) AS assignment_fallbacks,
      (SELECT COUNT(*) FROM buyer_channels) AS buyer_channels,
      (SELECT COUNT(*) FROM staff_authorization_events) AS authorization_events,
      (SELECT COUNT(*) FROM audit_events) AS audits
    `).get()).toEqual({
      staff: 0,
      roles: 0,
      emails: 0,
      assignment_fallbacks: 0,
      buyer_channels: 0,
      authorization_events: 0,
      audits: 0,
    });
    expect(database.raw.prepare(`SELECT status,error_code,response_json
      FROM command_idempotency_records`).get()).toEqual({
      status: 'FAILED',
      error_code: 'STAGING_FIRST_OWNER_BOOTSTRAP_FAILED',
      response_json: null,
    });
  });
});

function migratedEmptyDatabase(): SqliteDatabase {
  const value = new SqliteDatabase();
  applyMigrations(value);
  return value;
}
