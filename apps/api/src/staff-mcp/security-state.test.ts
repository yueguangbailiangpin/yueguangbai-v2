import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import {
  D1StaffMcpControlStore,
  D1StaffMcpCleanup,
  D1StaffMcpIdentityStore,
  D1StaffMcpRateLimiter,
  D1StaffMcpReplayStore,
  keyedHash,
} from './security-state';
import {
  ANONYMOUS_HASH_SECRET,
  ANONYMOUS_OAUTH_CONFIG,
  seedAnonymousBinding,
} from './test-helpers';

describe('Staff MCP durable security state', () => {
  let database: SqliteDatabase;
  beforeEach(() => { database = createMigratedTestDatabase(); });
  afterEach(() => database.close());

  it('maps one hashed subject to one current ACTIVE Staff and closes on revocation', async () => {
    await seedAnonymousBinding(database);
    const identities = new D1StaffMcpIdentityStore(database, ANONYMOUS_HASH_SECRET);
    const input = {
      issuer: ANONYMOUS_OAUTH_CONFIG.issuer,
      subject: 'anonymous-subject',
      jti: 'anonymous-jti',
      tokenExpiresAt: 2_000_000,
      now: 1_000_000,
    };
    await expect(identities.resolveActiveStaff(input))
      .resolves.toBe('zz-phase3h-test-owner');
    const issuerHash = await keyedHash(
      ANONYMOUS_HASH_SECRET,
      'issuer',
      input.issuer,
    );
    const jtiHash = await keyedHash(
      ANONYMOUS_HASH_SECRET,
      'jti',
      `${input.issuer}\u0000${input.jti}`,
    );
    await database.prepare(`
      INSERT INTO staff_mcp_token_revocations (
        issuer_hash,token_jti_hash,reason_code,revoked_at,expires_at
      ) VALUES (?, ?, 'LOCAL_TEST_REVOKED', ?, ?)
    `).bind(issuerHash, jtiHash, input.now, input.tokenExpiresAt).run();
    await expect(identities.resolveActiveStaff(input)).resolves.toBeNull();

    await database.prepare(`
      UPDATE staff_users SET status='DISABLED',disabled_at=2,updated_at=2
      WHERE id='zz-phase3h-test-owner'
    `).run();
    await database.prepare(`
      DELETE FROM staff_mcp_token_revocations
      WHERE issuer_hash=? AND token_jti_hash=?
    `).bind(issuerHash, jtiHash).run();
    await expect(identities.resolveActiveStaff(input)).resolves.toBeNull();
  });

  it('composes default-off GLOBAL and optional TOOL controls', async () => {
    const controls = new D1StaffMcpControlStore(database);
    await expect(controls.isGloballyEnabled()).resolves.toBe(false);
    await database.prepare(`
      UPDATE staff_mcp_runtime_controls
      SET enabled=1,version=version+1,reason_code='LOCAL_TEST',updated_at=updated_at+1
      WHERE control_type='GLOBAL' AND control_name='staff-mcp'
    `).run();
    await expect(controls.isEnabled('get_order_summary_v1')).resolves.toBe(true);
    await database.prepare(`
      INSERT INTO staff_mcp_runtime_controls (
        control_type,control_name,enabled,version,reason_code,created_at,updated_at
      ) VALUES ('TOOL','get_order_summary_v1',0,1,'LOCAL_TEST',
        CAST(unixepoch('now') AS INTEGER)*1000,
        CAST(unixepoch('now') AS INTEGER)*1000)
    `).run();
    await expect(controls.isEnabled('get_order_summary_v1')).resolves.toBe(false);
    await expect(controls.isEnabled('get_review_summary_v1')).resolves.toBe(true);
  });

  it('enforces rate and replay across independent adapter instances', async () => {
    const limiterA = new D1StaffMcpRateLimiter(database, ANONYMOUS_HASH_SECRET);
    const limiterB = new D1StaffMcpRateLimiter(database, ANONYMOUS_HASH_SECRET);
    await expect(limiterA.take('anonymous-rate', 1_000, 2, 60_000))
      .resolves.toBe(true);
    await expect(limiterB.take('anonymous-rate', 1_001, 2, 60_000))
      .resolves.toBe(true);
    await expect(limiterA.take('anonymous-rate', 1_002, 2, 60_000))
      .resolves.toBe(false);
    await expect(limiterB.take('anonymous-rate', 61_000, 2, 60_000))
      .resolves.toBe(true);

    const replayA = new D1StaffMcpReplayStore(
      database,
      ANONYMOUS_HASH_SECRET,
      () => 'anonymous-lease-a',
    );
    const replayB = new D1StaffMcpReplayStore(
      database,
      ANONYMOUS_HASH_SECRET,
      () => 'anonymous-lease-b',
    );
    const context = { toolName: 'get_order_summary_v1', now: 1_000 };
    await expect(replayA.acquire('anonymous-replay', 'a'.repeat(64), context))
      .resolves.toEqual({ kind: 'NEW' });
    await expect(replayB.acquire('anonymous-replay', 'a'.repeat(64), context))
      .resolves.toEqual({ kind: 'IN_PROGRESS' });
    const result = {
      content: [{ type: 'text' as const, text: '{"kind":"FACT"}' }],
      isError: true,
    };
    await replayA.complete('anonymous-replay', 'a'.repeat(64), result, 1_001);
    await expect(replayB.acquire(
      'anonymous-replay',
      'a'.repeat(64),
      { ...context, now: 1_002 },
    )).resolves.toEqual({ kind: 'REPLAY', result });
    await expect(replayB.acquire(
      'anonymous-replay',
      'b'.repeat(64),
      { ...context, now: 1_002 },
    )).resolves.toEqual({ kind: 'CONFLICT' });
  });

  it('stores screenshot replay as metadata only and rejects binary or oversized replay', async () => {
    const replay = new D1StaffMcpReplayStore(
      database,
      ANONYMOUS_HASH_SECRET,
      () => 'anonymous-screenshot-lease',
    );
    const context = { toolName: 'read_task_screenshot_v1', now: 1_000 };
    await expect(replay.acquire('screenshot-key', 'c'.repeat(64), context))
      .resolves.toEqual({ kind: 'NEW' });
    await replay.complete('screenshot-key', 'c'.repeat(64), null, 1_001);
    expect(await database.prepare(`
      SELECT status,response_json FROM staff_mcp_replay_records
      WHERE tool_name='read_task_screenshot_v1'
    `).first()).toEqual({ status: 'COMPLETED_NO_RESPONSE', response_json: null });
    await expect(replay.acquire(
      'screenshot-key', 'c'.repeat(64), { ...context, now: 1_002 },
    )).resolves.toEqual({ kind: 'REPLAY_NOT_AVAILABLE' });

    const binary = new D1StaffMcpReplayStore(
      database,
      ANONYMOUS_HASH_SECRET,
      () => 'anonymous-binary-lease',
    );
    await binary.acquire('binary-key', 'd'.repeat(64), context);
    await expect(binary.complete('binary-key', 'd'.repeat(64), {
      content: [{
        type: 'image', data: 'cHJpdmF0ZS1ieXRlcw==', mimeType: 'image/png',
        annotations: { audience: ['user', 'assistant'] },
      }],
      isError: false,
    }, 1_001)).rejects.toThrow('staff_mcp_replay_binary_forbidden');
    await binary.fail('binary-key', 'd'.repeat(64));

    const oversized = new D1StaffMcpReplayStore(
      database,
      ANONYMOUS_HASH_SECRET,
      () => 'anonymous-oversized-lease',
    );
    await oversized.acquire('oversized-key', 'e'.repeat(64), context);
    await expect(oversized.complete('oversized-key', 'e'.repeat(64), {
      content: [{ type: 'text', text: 'x'.repeat(256 * 1024) }],
      isError: true,
    }, 1_001)).rejects.toThrow('staff_mcp_replay_result_unsafe');
  });

  it('deletes only a bounded set of expired replay/rate/revocation rows', async () => {
    await seedAnonymousBinding(database);
    const replay = new D1StaffMcpReplayStore(database, ANONYMOUS_HASH_SECRET);
    const safe = { content: [{ type: 'text' as const, text: '{}' }], isError: true };
    for (const suffix of ['a', 'b']) {
      await replay.acquire(`expired-${suffix}`, suffix.repeat(64), {
        toolName: 'get_order_summary_v1', now: 1,
      });
      await replay.complete(`expired-${suffix}`, suffix.repeat(64), safe, 2);
    }
    await replay.acquire('current-replay', 'c'.repeat(64), {
      toolName: 'get_order_summary_v1', now: 100_000_000,
    });
    const limiter = new D1StaffMcpRateLimiter(database, ANONYMOUS_HASH_SECRET);
    await limiter.take('expired-rate-a', 1, 10, 60_000);
    await limiter.take('expired-rate-b', 2, 10, 60_000);
    await limiter.take('current-rate', 100_000_000, 10, 60_000);
    await database.prepare(`
      INSERT INTO staff_mcp_token_revocations (
        issuer_hash,token_jti_hash,reason_code,revoked_at,expires_at
      ) VALUES
        (?,?,'LOCAL_EXPIRED',1,2),
        (?,?,'LOCAL_EXPIRED',1,3),
        (?,?,'LOCAL_CURRENT',1,200000000)
    `).bind(
      '1'.repeat(64), '2'.repeat(64),
      '1'.repeat(64), '3'.repeat(64),
      '1'.repeat(64), '4'.repeat(64),
    ).run();
    const protectedBefore = await protectedCounts();
    await expect(new D1StaffMcpCleanup(database).run(100_000_000, 1))
      .resolves.toEqual({ replayDeleted: 1, rateDeleted: 1, revocationDeleted: 1 });
    expect(await database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM staff_mcp_replay_records WHERE expires_at<=100000000)
          AS expired_replay,
        (SELECT COUNT(*) FROM staff_mcp_rate_limits WHERE window_ends_at<=100000000)
          AS expired_rate,
        (SELECT COUNT(*) FROM staff_mcp_token_revocations WHERE expires_at<=100000000)
          AS expired_revocation
    `).first()).toEqual({ expired_replay: 1, expired_rate: 1, expired_revocation: 1 });
    expect(await protectedCounts()).toEqual(protectedBefore);

    async function protectedCounts() {
      return database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM staff_mcp_subject_bindings) AS bindings,
          (SELECT COUNT(*) FROM staff_mcp_runtime_controls) AS controls,
          (SELECT COUNT(*) FROM audit_events) AS audits
      `).first();
    }
  });
});
