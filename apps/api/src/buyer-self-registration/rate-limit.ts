import type { SqlDatabase } from '@ygb/contracts';
import { normalizeWechatId } from '@ygb/domain';
import { normalizeNetworkSource } from '../http-auth/rate-limit';
import { registrationPrivacyHash } from './privacy-hash';

const WINDOW_MS = 15 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface BuyerRegistrationRateLimitResult {
  wechatIdHash: string;
  networkSourceHash: string;
  deviceHash: string;
  limited: boolean;
  retryAfterSeconds: number;
}

export async function consumeBuyerRegistrationRateLimit(
  database: SqlDatabase,
  input: {
    wechatId: string;
    networkSource: string | null;
    deviceId: string | null;
    secret: string;
    now: number;
  },
): Promise<BuyerRegistrationRateLimitResult> {
  const normalizedWechat = normalizeWechatForLimit(input.wechatId);
  const network = normalizeNetworkSource(input.networkSource);
  const device = normalizeDevice(input.deviceId);
  const hashes = {
    wechatIdHash: await registrationPrivacyHash(
      input.secret,
      'WECHAT_ID',
      normalizedWechat,
    ),
    networkSourceHash: await registrationPrivacyHash(
      input.secret,
      'NETWORK_SOURCE',
      network,
    ),
    deviceHash: await registrationPrivacyHash(
      input.secret,
      'DEVICE',
      device,
    ),
  };
  const windowStartedAt = Math.floor(input.now / WINDOW_MS) * WINDOW_MS;
  const windowExpiresAt = windowStartedAt + WINDOW_MS;

  await database.batch([
    upsert(database, 'WECHAT_ID', hashes.wechatIdHash, 5,
      windowStartedAt, windowExpiresAt, input.now),
    upsert(database, 'NETWORK_SOURCE', hashes.networkSourceHash, 30,
      windowStartedAt, windowExpiresAt, input.now),
    upsert(database, 'DEVICE', hashes.deviceHash,
      device === 'unknown' ? 300 : 15,
      windowStartedAt, windowExpiresAt, input.now),
    database.prepare(`
      DELETE FROM buyer_registration_rate_limits
      WHERE window_expires_at < ?
    `).bind(input.now - RETENTION_MS),
  ]);

  const rows = await database.prepare(`
    SELECT blocked_until
    FROM buyer_registration_rate_limits
    WHERE window_started_at=?
      AND (
        (scope_type='WECHAT_ID' AND scope_hash=?)
        OR (scope_type='NETWORK_SOURCE' AND scope_hash=?)
        OR (scope_type='DEVICE' AND scope_hash=?)
      )
  `).bind(
    windowStartedAt,
    hashes.wechatIdHash,
    hashes.networkSourceHash,
    hashes.deviceHash,
  ).all<{ blocked_until: number | null }>();
  const blockedUntil = rows.results.reduce(
    (maximum, row) => Math.max(maximum, Number(row.blocked_until ?? 0)),
    0,
  );
  return {
    ...hashes,
    limited: blockedUntil > input.now,
    retryAfterSeconds: blockedUntil > input.now
      ? Math.max(1, Math.ceil((blockedUntil - input.now) / 1000))
      : 0,
  };
}

function upsert(
  database: SqlDatabase,
  scopeType: 'WECHAT_ID' | 'NETWORK_SOURCE' | 'DEVICE',
  scopeHash: string,
  limit: number,
  windowStartedAt: number,
  windowExpiresAt: number,
  now: number,
) {
  return database.prepare(`
    INSERT INTO buyer_registration_rate_limits (
      scope_type, scope_hash, window_started_at, window_expires_at,
      attempt_count, blocked_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, NULL, ?, ?)
    ON CONFLICT (scope_type, scope_hash, window_started_at)
    DO UPDATE SET
      attempt_count=buyer_registration_rate_limits.attempt_count+1,
      blocked_until=CASE
        WHEN buyer_registration_rate_limits.attempt_count+1 > ?
          THEN MAX(
            COALESCE(buyer_registration_rate_limits.blocked_until, 0),
            excluded.window_expires_at
          )
        ELSE buyer_registration_rate_limits.blocked_until
      END,
      updated_at=excluded.updated_at
  `).bind(
    scopeType,
    scopeHash,
    windowStartedAt,
    windowExpiresAt,
    now,
    now,
    limit,
  );
}

function normalizeWechatForLimit(value: string): string {
  try {
    return normalizeWechatId(value).normalized;
  } catch {
    return String(value)
      .normalize('NFKC')
      .trim()
      .toLocaleLowerCase('en-US')
      .slice(0, 160) || 'invalid';
  }
}

function normalizeDevice(value: string | null): string {
  if (value === null) return 'unknown';
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (normalized.length < 8
    || normalized.length > 160
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return 'unknown';
  }
  return normalized;
}
