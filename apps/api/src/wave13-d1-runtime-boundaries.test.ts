import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  SqliteDatabase,
} from '@ygb/testkit';
import {
  consumeStaffLoginState,
  createInternalStaffSession,
  findStaffSessionByToken,
  issueStaffLoginState,
  revokeStaffSession,
} from './staff-auth/repository';
import { generateStaffOpaqueToken } from './staff-auth/crypto';
import type { StaffAuthRuntimeConfig } from './staff-auth/provider';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

const root = path.resolve(process.cwd());
const migrations = readdirSync(path.join(root, 'migrations'))
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();

function applyPrefix(target: SqliteDatabase, count: number): void {
  for (const name of migrations.slice(0, count)) {
    runMigration(target, name);
  }
}

function applyFrom(target: SqliteDatabase, start: number): void {
  for (const name of migrations.slice(start)) {
    runMigration(target, name);
  }
}

function runMigration(target: SqliteDatabase, name: string): void {
  target.exec('BEGIN IMMEDIATE;');
  try {
    target.exec(readFileSync(path.join(root, 'migrations', name), 'utf8'));
    target.exec('COMMIT;');
  } catch (error) {
    try { target.exec('ROLLBACK;'); } catch { /* no open transaction */ }
    throw error;
  }
}

function config(): StaffAuthRuntimeConfig {
  return {
    provider: 'FEISHU',
    authorizationEndpoint:
      'https://open.feishu.cn/open-apis/authen/v1/authorize',
    tokenEndpoint: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    identityEndpoint: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
    appId: 'cli_wave13_d1',
    appSecret: 'test-only-secret',
    scope: 'contact:user.base:readonly',
    tenantKey: 'wave13-d1-tenant',
    redirectUri: 'https://api.example.test/api/staff-auth/feishu/callback',
    allowedOrigins: new Set(['https://staff.example.test']),
    allowedReturnTo: new Set(['/staff']),
    hashSecret: 'wave13-d1-hash-secret-at-least-thirty-two-characters',
  };
}

describe('Wave 13 D1 runtime boundaries', () => {
  it('applies 0001-0027 to an empty database with integrity and FK checks', () => {
    database = new SqliteDatabase();
    applyPrefix(database, migrations.length);
    expect(migrations.at(-1)).toBe('0027_staff_auth_sessions.sql');
    expect(database.raw.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get()).toEqual({ schema_version: 27 });
    expect(database.raw.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
    expect(database.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('upgrades schema 26 to 27 without rewriting Customer Auth tables', () => {
    database = new SqliteDatabase();
    applyPrefix(database, 26);
    database.exec(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version, version,
        created_at, updated_at, disabled_at
      ) VALUES ('wave13-upgrade-staff','Upgrade Staff','ACTIVE',1,1,1,1,NULL);
    `);
    const customerSchemaBefore = customerAuthSchema(database);
    const customerCountsBefore = customerAuthCounts(database);

    applyFrom(database, 26);

    expect(database.raw.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get()).toEqual({ schema_version: 27 });
    expect(database.raw.prepare(`
      SELECT session_version FROM staff_users WHERE id='wave13-upgrade-staff'
    `).get()).toEqual({ session_version: 1 });
    expect(customerAuthSchema(database)).toEqual(customerSchemaBefore);
    expect(customerAuthCounts(database)).toEqual(customerCountsBefore);
    expect(database.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('consumes one hashed login state once under concurrent callers', async () => {
    database = createMigratedTestDatabase();
    const stateHash = 'b'.repeat(64);
    await issueStaffLoginState(database, {
      stateHash,
      returnTo: '/staff',
      origin: 'https://staff.example.test',
      networkSource: '127.0.0.1',
      requestId: 'wave13-state-concurrency',
      config: config(),
      now: 1_000,
      expiresAt: 601_000,
    });
    const results = await Promise.allSettled([
      consumeStaffLoginState(database, {
        stateHash,
        expectedTenantKey: 'wave13-d1-tenant',
        now: 2_000,
      }),
      consumeStaffLoginState(database, {
        stateHash,
        expectedTenantKey: 'wave13-d1-tenant',
        now: 2_000,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(database.raw.prepare(`
      SELECT status, COUNT(*) AS count FROM staff_login_states
      WHERE state_hash=? GROUP BY status
    `).get(stateHash)).toEqual({ status: 'CONSUMED', count: 1 });
  });

  it('revokes opaque Sessions and preserves absolute version authority', async () => {
    database = createMigratedTestDatabase();
    const token = generateStaffOpaqueToken();
    const created = await createInternalStaffSession(database, {
      token,
      identity: {
        staffId: 'zz-phase3h-test-owner',
        displayName: 'Phase 3H Test Owner',
        staffStatus: 'ACTIVE',
        authorizationVersion: 1,
        sessionVersion: 1,
      },
      requestId: 'wave13-session-create',
      now: 10_000,
      expiresAt: 10_000 + 12 * 60 * 60 * 1000,
    });
    const found = await findStaffSessionByToken(database, token);
    expect(found?.id).toBe(created.id);
    expect(found?.issued_session_version).toBe(1);
    await revokeStaffSession(database, {
      session: found!,
      reason: 'LOGOUT',
      requestId: 'wave13-session-revoke',
      now: 11_000,
    });
    expect((await findStaffSessionByToken(database, token))?.status).toBe('REVOKED');
    expect(database.raw.prepare(`
      SELECT session_version FROM staff_users WHERE id='zz-phase3h-test-owner'
    `).get()).toEqual({ session_version: 1 });
  });

  it('rolls back approval and Refund command namespaces on assertion failure', async () => {
    database = createMigratedTestDatabase();
    for (const command of [
      {
        action: 'APPROVE_ORDER_EVIDENCE',
        targetType: 'ORDER_EVIDENCE_SUBMISSION',
        targetId: 'runtime-evidence',
        key: 'wave13-approval-rollback',
      },
      {
        action: 'RECORD_BUYER_REFUND_PAYMENT',
        targetType: 'BUYER_REFUND_OBLIGATION',
        targetId: 'runtime-refund',
        key: 'wave13-refund-payment-rollback',
      },
      {
        action: 'REVERSE_BUYER_REFUND_PAYMENT',
        targetType: 'BUYER_REFUND_OBLIGATION',
        targetId: 'runtime-refund',
        key: 'wave13-refund-reversal-rollback',
      },
    ]) {
      await expect(database.batch([
        processingCommand(database, command),
        database.prepare(`
          INSERT INTO audit_events (
            id, aggregate_type, aggregate_id, event_type,
            actor_type, actor_id, actor_roles_json,
            request_id, idempotency_key, previous_state_json,
            next_state_json, reason, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, 'STAFF', 'zz-phase3h-test-owner',
            '["owner"]', ?, ?, NULL, '{}', NULL, '{}', 20000)
        `).bind(
          `audit-${command.key}`,
          command.targetType,
          command.targetId,
          command.action,
          `request-${command.key}`,
          command.key,
        ),
        database.prepare(`
          INSERT INTO transaction_assertions (assertion_value) VALUES (0)
        `),
      ])).rejects.toThrow();
      expect(database.raw.prepare(`
        SELECT COUNT(*) AS count FROM command_idempotency_records
        WHERE action=? AND idempotency_key=?
      `).get(command.action, command.key)).toEqual({ count: 0 });
      expect(database.raw.prepare(`
        SELECT COUNT(*) AS count FROM audit_events WHERE id=?
      `).get(`audit-${command.key}`)).toEqual({ count: 0 });
    }
  });

  it('enforces STRICT types, FK, immutable triggers and transaction assertions', async () => {
    database = createMigratedTestDatabase();
    expect(() => database!.raw.prepare(`
      INSERT INTO staff_sessions (
        id, token_hash, staff_id, issued_session_version,
        issued_authorization_version, status, expires_at,
        revoked_at, revoked_reason, created_at, updated_at
      ) VALUES ('bad-session', ?, 'missing-staff', 1, 1, 'ACTIVE',
        1000, NULL, NULL, 1, 1)
    `).run('c'.repeat(64))).toThrow();
    await database.prepare(`
      INSERT INTO staff_auth_security_events (
        id, event_type, outcome, staff_id, session_id,
        provider, tenant_hash, subject_hash, network_source_hash,
        request_id, metadata_json, created_at
      ) VALUES (
        'wave13-security-event','LOGIN_FAILED','FAILURE',NULL,NULL,
        NULL,NULL,NULL,NULL,'request','{}',1
      )
    `).run();
    await expect(database.prepare(`
      UPDATE staff_auth_security_events SET outcome='BLOCKED'
      WHERE id='wave13-security-event'
    `).run()).rejects.toThrow();
    await expect(database.batch([
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value) VALUES (0)
      `),
    ])).rejects.toThrow();
    expect(database.raw.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
    expect(database.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

function customerAuthSchema(target: SqliteDatabase) {
  return target.raw.prepare(`
    SELECT type, name, sql
    FROM sqlite_schema
    WHERE name IN (
      'customer_login_rate_limits',
      'customer_auth_security_events'
    )
    ORDER BY type, name
  `).all();
}

function customerAuthCounts(target: SqliteDatabase) {
  return {
    loginRateLimits: Number(target.raw.prepare(`
      SELECT COUNT(*) AS count FROM customer_login_rate_limits
    `).get()?.count),
    securityEvents: Number(target.raw.prepare(`
      SELECT COUNT(*) AS count FROM customer_auth_security_events
    `).get()?.count),
  };
}

function processingCommand(
  target: SqliteDatabase,
  input: {
    action: string;
    targetType: string;
    targetId: string;
    key: string;
  },
) {
  return target.prepare(`
    INSERT INTO command_idempotency_records (
      actor_type, actor_id, idempotency_key, action,
      target_type, target_id, request_hash, status,
      lease_token, lease_expires_at, attempt_count,
      response_json, result_references_json, error_code,
      created_at, updated_at, completed_at
    ) VALUES (
      'STAFF','zz-phase3h-test-owner',?,?,?,?,'${'d'.repeat(64)}',
      'PROCESSING',?,30000,1,NULL,NULL,NULL,20000,20000,NULL
    )
  `).bind(
    input.key,
    input.action,
    input.targetType,
    input.targetId,
    `lease-${input.key}`,
  );
}
