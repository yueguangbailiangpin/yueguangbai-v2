import type { SqlDatabase } from '@ygb/contracts';
import { normalizeWechatId } from '@ygb/domain';

const WINDOW_MS = 15 * 60 * 1000;
const IDENTIFIER_ATTEMPT_LIMIT = 10;
const NETWORK_ATTEMPT_LIMIT = 60;
const RETENTION_MS = 24 * 60 * 60 * 1000;

interface RateLimitRow {
  scope_type: 'LOGIN_IDENTIFIER' | 'NETWORK_SOURCE';
  attempt_count: number;
  blocked_until: number | null;
}

export interface CustomerLoginRateLimitResult {
  identifierHash: string;
  networkSourceHash: string;
  limited: boolean;
  retryAfterSeconds: number;
}

export async function consumeCustomerLoginRateLimit(
  database: SqlDatabase,
  input: {
    loginIdentifier: string;
    networkSource: string | null;
    secret: string;
    now: number;
  },
): Promise<CustomerLoginRateLimitResult> {
  const windowStartedAt = Math.floor(input.now / WINDOW_MS) * WINDOW_MS;
  const windowExpiresAt = windowStartedAt + WINDOW_MS;
  const identifierHash = await hashRateLimitDimension(
    input.secret,
    'LOGIN_IDENTIFIER',
    normalizeLoginIdentifierForRateLimit(input.loginIdentifier),
  );
  const networkSourceHash = await hashRateLimitDimension(
    input.secret,
    'NETWORK_SOURCE',
    normalizeNetworkSource(input.networkSource),
  );

  await database.batch([
    rateLimitUpsertStatement(database, {
      scopeType: 'LOGIN_IDENTIFIER',
      scopeHash: identifierHash,
      limit: IDENTIFIER_ATTEMPT_LIMIT,
      windowStartedAt,
      windowExpiresAt,
      now: input.now,
    }),
    rateLimitUpsertStatement(database, {
      scopeType: 'NETWORK_SOURCE',
      scopeHash: networkSourceHash,
      limit: NETWORK_ATTEMPT_LIMIT,
      windowStartedAt,
      windowExpiresAt,
      now: input.now,
    }),
    database.prepare(`
      DELETE FROM customer_login_rate_limits
      WHERE window_expires_at < ?
    `).bind(input.now - RETENTION_MS),
  ]);

  const rows = await database.prepare(`
    SELECT scope_type, attempt_count, blocked_until
    FROM customer_login_rate_limits
    WHERE window_started_at=?
      AND (
        (scope_type='LOGIN_IDENTIFIER' AND scope_hash=?)
        OR
        (scope_type='NETWORK_SOURCE' AND scope_hash=?)
      )
  `).bind(
    windowStartedAt,
    identifierHash,
    networkSourceHash,
  ).all<RateLimitRow>();

  const blockedUntil = rows.results.reduce(
    (maximum, row) => Math.max(
      maximum,
      Number(row.blocked_until ?? 0),
    ),
    0,
  );
  const limited = blockedUntil > input.now;
  return {
    identifierHash,
    networkSourceHash,
    limited,
    retryAfterSeconds: limited
      ? Math.max(1, Math.ceil((blockedUntil - input.now) / 1000))
      : 0,
  };
}

function rateLimitUpsertStatement(
  database: SqlDatabase,
  input: {
    scopeType: 'LOGIN_IDENTIFIER' | 'NETWORK_SOURCE';
    scopeHash: string;
    limit: number;
    windowStartedAt: number;
    windowExpiresAt: number;
    now: number;
  },
) {
  return database.prepare(`
    INSERT INTO customer_login_rate_limits (
      scope_type,
      scope_hash,
      window_started_at,
      window_expires_at,
      attempt_count,
      blocked_until,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 1, NULL, ?, ?)
    ON CONFLICT (
      scope_type,
      scope_hash,
      window_started_at
    ) DO UPDATE SET
      attempt_count=customer_login_rate_limits.attempt_count+1,
      blocked_until=CASE
        WHEN customer_login_rate_limits.attempt_count+1 > ?
          THEN MAX(
            COALESCE(customer_login_rate_limits.blocked_until, 0),
            excluded.window_expires_at
          )
        ELSE customer_login_rate_limits.blocked_until
      END,
      updated_at=excluded.updated_at
  `).bind(
    input.scopeType,
    input.scopeHash,
    input.windowStartedAt,
    input.windowExpiresAt,
    input.now,
    input.now,
    input.limit,
  );
}

export function normalizeNetworkSource(
  value: string | null,
): string {
  if (value === null) return 'unknown';
  const candidate = value.trim().toLowerCase();
  if (candidate.length === 0 || candidate.length > 80) {
    return 'unknown';
  }

  const ipv4 = candidate.split('.');
  if (ipv4.length === 4
    && ipv4.every((part) => /^(0|[1-9][0-9]{0,2})$/u.test(part))
    && ipv4.every((part) => Number(part) <= 255)) {
    return `${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.0/24`;
  }

  if (/^[0-9a-f:]+$/u.test(candidate)
    && candidate.includes(':')) {
    const expanded = expandIpv6(candidate);
    return expanded === null
      ? 'unknown'
      : `${expanded.slice(0, 4).join(':')}::/64`;
  }
  return 'unknown';
}

function normalizeLoginIdentifierForRateLimit(
  value: string,
): string {
  try {
    return normalizeWechatId(value).normalized;
  } catch {
    return value
      .normalize('NFKC')
      .trim()
      .toLocaleLowerCase('en-US')
      .slice(0, 160) || 'invalid';
  }
}

async function hashRateLimitDimension(
  secret: string,
  scope: 'LOGIN_IDENTIFIER' | 'NETWORK_SOURCE',
  value: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(
      `customer-auth-rate-limit:v1:${scope}:${value}`,
    ),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function expandIpv6(value: string): string[] | null {
  if ((value.match(/::/gu) ?? []).length > 1) return null;
  const halves = value.split('::');
  const left = halves[0]?.length
    ? halves[0].split(':')
    : [];
  const right = halves[1]?.length
    ? halves[1].split(':')
    : [];
  if ([...left, ...right].some(
    (part) => !/^[0-9a-f]{1,4}$/u.test(part),
  )) {
    return null;
  }
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 1) return null;
  return [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ].map((part) => part.padStart(4, '0'));
}
