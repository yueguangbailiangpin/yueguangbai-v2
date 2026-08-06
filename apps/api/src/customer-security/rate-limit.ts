import type { SqlDatabase } from '@ygb/contracts';
import { registrationPrivacyHash } from '../buyer-self-registration/privacy-hash';
import { normalizeNetworkSource } from '../http-auth/rate-limit';

const WINDOW_MS = 15 * 60 * 1000;

export async function consumeCustomerSecurityRateLimit(
  database: SqlDatabase,
  input: {
    operation: 'INVITATION' | 'PASSWORD_RESET';
    token: string;
    primaryScopeType?: 'TOKEN' | 'WECHAT_ID';
    networkSource: string | null;
    deviceId: string | null;
    secret: string;
    now: number;
  },
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const windowStartedAt = Math.floor(input.now / WINDOW_MS) * WINDOW_MS;
  const windowExpiresAt = windowStartedAt + WINDOW_MS;
  const scopes = await Promise.all([
    scope(input.secret, input.primaryScopeType ?? 'TOKEN',
      input.token.slice(0, 160), 8),
    scope(input.secret, 'NETWORK_SOURCE',
      normalizeNetworkSource(input.networkSource), 40),
    scope(input.secret, 'DEVICE', normalizeDevice(input.deviceId), 20),
  ]);
  await database.batch([
    ...scopes.map((item) => database.prepare(`
      INSERT INTO customer_security_rate_limits (
        operation, scope_type, scope_hash, window_started_at,
        window_expires_at, attempt_count, blocked_until,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?)
      ON CONFLICT (operation, scope_type, scope_hash, window_started_at)
      DO UPDATE SET
        attempt_count=customer_security_rate_limits.attempt_count+1,
        blocked_until=CASE
          WHEN customer_security_rate_limits.attempt_count+1>?
            THEN excluded.window_expires_at
          ELSE customer_security_rate_limits.blocked_until
        END,
        updated_at=excluded.updated_at
    `).bind(input.operation, item.type, item.hash, windowStartedAt,
      windowExpiresAt, input.now, input.now, item.limit)),
    database.prepare(`
      DELETE FROM customer_security_rate_limits
      WHERE window_expires_at<?
    `).bind(input.now - 24 * 60 * 60 * 1000),
  ]);
  const row = await database.prepare(`
    SELECT MAX(COALESCE(blocked_until, 0)) AS blocked_until
    FROM customer_security_rate_limits
    WHERE operation=? AND window_started_at=?
      AND scope_hash IN (?, ?, ?)
  `).bind(input.operation, windowStartedAt,
    scopes[0].hash, scopes[1].hash, scopes[2].hash)
    .first<{ blocked_until: number | null }>();
  const blockedUntil = Number(row?.blocked_until ?? 0);
  return {
    limited: blockedUntil > input.now,
    retryAfterSeconds: blockedUntil > input.now
      ? Math.max(1, Math.ceil((blockedUntil - input.now) / 1000))
      : 0,
  };
}

async function scope(
  secret: string,
  type: 'TOKEN' | 'WECHAT_ID' | 'NETWORK_SOURCE' | 'DEVICE',
  value: string,
  limit: number,
) {
  return {
    type,
    hash: await registrationPrivacyHash(secret, type, value),
    limit,
  };
}

function normalizeDevice(value: string | null): string {
  const normalized = value?.normalize('NFKC').trim().toLowerCase() ?? '';
  return normalized.length >= 8 && normalized.length <= 160
    && !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : 'unknown';
}
