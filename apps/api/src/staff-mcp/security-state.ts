import type {
  SqlDatabase,
  StaffMcpToolName,
  StaffMcpToolResult,
} from '@ygb/contracts';
import type { StaffMcpControlStore } from './server-adapter';
import type {
  StaffMcpReplayAcquire,
  StaffMcpReplayStore,
} from './replay';
import type { StaffMcpRateLimiter } from './rate-limit';

const REPLAY_LEASE_MS = 30_000;
const REPLAY_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_REPLAY_RESPONSE_BYTES = 256 * 1024;

export interface StaffMcpIdentityStore {
  resolveActiveStaff(input: {
    issuer: string;
    subject: string;
    jti: string;
    tokenExpiresAt: number;
    now: number;
  }): Promise<string | null>;
}

export class D1StaffMcpIdentityStore implements StaffMcpIdentityStore {
  constructor(
    private readonly database: SqlDatabase,
    private readonly hashSecret: string,
  ) {}

  async resolveActiveStaff(input: {
    issuer: string;
    subject: string;
    jti: string;
    tokenExpiresAt: number;
    now: number;
  }): Promise<string | null> {
    const [issuerHash, subjectHash, jtiHash] = await Promise.all([
      keyedHash(this.hashSecret, 'issuer', input.issuer),
      keyedHash(this.hashSecret, 'subject', `${input.issuer}\u0000${input.subject}`),
      keyedHash(this.hashSecret, 'jti', `${input.issuer}\u0000${input.jti}`),
    ]);
    const revoked = await this.database.prepare(`
      SELECT 1 AS revoked
      FROM staff_mcp_token_revocations
      WHERE issuer_hash=? AND token_jti_hash=? AND expires_at>?
    `).bind(issuerHash, jtiHash, input.now).first<{ revoked: number }>();
    if (revoked) return null;

    const rows = await this.database.prepare(`
      SELECT binding.staff_id
      FROM staff_mcp_subject_bindings binding
      JOIN staff_users staff ON staff.id=binding.staff_id
      WHERE binding.issuer_hash=? AND binding.subject_hash=?
        AND binding.status='ACTIVE' AND staff.status='ACTIVE'
      LIMIT 2
    `).bind(issuerHash, subjectHash).all<{ staff_id: string }>();
    if (rows.results.length !== 1) return null;
    return rows.results[0]!.staff_id;
  }
}

export class D1StaffMcpControlStore implements StaffMcpControlStore {
  constructor(private readonly database: SqlDatabase) {}

  async isGloballyEnabled(): Promise<boolean> {
    const row = await this.database.prepare(`
      SELECT enabled FROM staff_mcp_runtime_controls
      WHERE control_type='GLOBAL' AND control_name='staff-mcp'
    `).first<{ enabled: number }>();
    return row?.enabled === 1;
  }

  async isEnabled(toolName: StaffMcpToolName): Promise<boolean> {
    const rows = await this.database.prepare(`
      SELECT control_type,enabled FROM staff_mcp_runtime_controls
      WHERE (control_type='GLOBAL' AND control_name='staff-mcp')
        OR (control_type='TOOL' AND control_name=?)
    `).bind(toolName).all<{ control_type: 'GLOBAL' | 'TOOL'; enabled: number }>();
    const global = rows.results.filter((row) => row.control_type === 'GLOBAL');
    const tool = rows.results.filter((row) => row.control_type === 'TOOL');
    return global.length === 1
      && global[0]!.enabled === 1
      && tool.length <= 1
      && (tool.length === 0 || tool[0]!.enabled === 1);
  }
}

export interface StaffMcpCleanupResult {
  replayDeleted: number;
  rateDeleted: number;
  revocationDeleted: number;
}

export class D1StaffMcpCleanup {
  constructor(private readonly database: SqlDatabase) {}

  async run(now: number, limit: number): Promise<StaffMcpCleanupResult> {
    if (!Number.isSafeInteger(now) || now < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('staff_mcp_cleanup_input_invalid');
    }
    const results = await this.database.batch([
      this.database.prepare(`
        DELETE FROM staff_mcp_replay_records
        WHERE replay_key_hash IN (
          SELECT replay_key_hash FROM staff_mcp_replay_records
          WHERE expires_at<=? ORDER BY expires_at,replay_key_hash LIMIT ?
        )
      `).bind(now, limit),
      this.database.prepare(`
        DELETE FROM staff_mcp_rate_limits
        WHERE (scope_hash,window_started_at) IN (
          SELECT scope_hash,window_started_at FROM staff_mcp_rate_limits
          WHERE window_ends_at<=?
          ORDER BY window_ends_at,scope_hash,window_started_at LIMIT ?
        )
      `).bind(now, limit),
      this.database.prepare(`
        DELETE FROM staff_mcp_token_revocations
        WHERE (issuer_hash,token_jti_hash) IN (
          SELECT issuer_hash,token_jti_hash FROM staff_mcp_token_revocations
          WHERE expires_at<=?
          ORDER BY expires_at,issuer_hash,token_jti_hash LIMIT ?
        )
      `).bind(now, limit),
    ]);
    if (results.length !== 3) throw new Error('staff_mcp_cleanup_unavailable');
    return {
      replayDeleted: Number(results[0]!.meta.changes),
      rateDeleted: Number(results[1]!.meta.changes),
      revocationDeleted: Number(results[2]!.meta.changes),
    };
  }
}

export class D1StaffMcpRateLimiter implements StaffMcpRateLimiter {
  constructor(
    private readonly database: SqlDatabase,
    private readonly hashSecret: string,
  ) {}

  async take(
    key: string,
    now: number,
    limit: number,
    windowMs: number,
  ): Promise<boolean> {
    const scopeHash = await keyedHash(this.hashSecret, 'rate', key);
    const windowStartedAt = Math.floor(now / windowMs) * windowMs;
    const windowEndsAt = windowStartedAt + windowMs;
    const row = await this.database.prepare(`
      INSERT INTO staff_mcp_rate_limits (
        scope_hash,window_started_at,window_ends_at,attempt_count,
        created_at,updated_at
      ) VALUES (?,?,?,1,?,?)
      ON CONFLICT(scope_hash,window_started_at) DO UPDATE SET
        attempt_count=staff_mcp_rate_limits.attempt_count+1,
        updated_at=MAX(excluded.updated_at,staff_mcp_rate_limits.updated_at+1)
      RETURNING attempt_count
    `).bind(
      scopeHash,
      windowStartedAt,
      windowEndsAt,
      now,
      now,
    ).first<{ attempt_count: number }>();
    if (!row || !Number.isSafeInteger(row.attempt_count)) {
      throw new Error('staff_mcp_rate_state_unavailable');
    }
    return row.attempt_count <= limit;
  }
}

export class D1StaffMcpReplayStore implements StaffMcpReplayStore {
  private readonly leases = new Map<string, string>();

  constructor(
    private readonly database: SqlDatabase,
    private readonly hashSecret: string,
    private readonly idFactory: () => string = () => crypto.randomUUID(),
  ) {}

  async acquire(
    key: string,
    requestHash: string,
    context?: { toolName: string; now: number },
  ): Promise<StaffMcpReplayAcquire> {
    if (!context) throw new Error('staff_mcp_replay_context_required');
    const replayKeyHash = await keyedHash(this.hashSecret, 'replay', key);
    const leaseToken = this.idFactory();
    const leaseTokenHash = await keyedHash(this.hashSecret, 'lease', leaseToken);
    const leaseExpiresAt = context.now + REPLAY_LEASE_MS;
    const expiresAt = context.now + REPLAY_RETENTION_MS;
    const claimed = await this.database.prepare(`
      INSERT INTO staff_mcp_replay_records (
        replay_key_hash,request_hash,tool_name,status,lease_token_hash,
        lease_expires_at,response_json,expires_at,created_at,updated_at,completed_at
      ) VALUES (?, ?, ?, 'PROCESSING', ?, ?, NULL, ?, ?, ?, NULL)
      ON CONFLICT(replay_key_hash) DO UPDATE SET
        request_hash=excluded.request_hash,
        tool_name=excluded.tool_name,
        status='PROCESSING',
        lease_token_hash=excluded.lease_token_hash,
        lease_expires_at=excluded.lease_expires_at,
        response_json=NULL,
        expires_at=excluded.expires_at,
        created_at=excluded.created_at,
        updated_at=excluded.updated_at,
        completed_at=NULL
      WHERE staff_mcp_replay_records.expires_at<=?
        OR (staff_mcp_replay_records.status='PROCESSING'
          AND staff_mcp_replay_records.lease_expires_at<=?)
      RETURNING replay_key_hash
    `).bind(
      replayKeyHash,
      requestHash,
      context.toolName,
      leaseTokenHash,
      leaseExpiresAt,
      expiresAt,
      context.now,
      context.now,
      context.now,
      context.now,
    ).first<{ replay_key_hash: string }>();
    if (claimed) {
      this.leases.set(replayKeyHash, leaseTokenHash);
      return { kind: 'NEW' };
    }
    const current = await this.database.prepare(`
      SELECT request_hash,status,response_json,expires_at,lease_expires_at
      FROM staff_mcp_replay_records WHERE replay_key_hash=?
    `).bind(replayKeyHash).first<{
      request_hash: string;
      status: 'PROCESSING' | 'COMPLETED' | 'COMPLETED_NO_RESPONSE';
      response_json: string | null;
      expires_at: number;
      lease_expires_at: number | null;
    }>();
    if (!current) throw new Error('staff_mcp_replay_state_unavailable');
    if (current.request_hash !== requestHash) return { kind: 'CONFLICT' };
    if (current.status === 'PROCESSING') return { kind: 'IN_PROGRESS' };
    if (current.status === 'COMPLETED_NO_RESPONSE') {
      return { kind: 'REPLAY_NOT_AVAILABLE' };
    }
    if (!current.response_json || current.expires_at <= context.now) {
      throw new Error('staff_mcp_replay_state_invalid');
    }
    return { kind: 'REPLAY', result: parseStoredResult(current.response_json) };
  }

  async complete(
    key: string,
    requestHash: string,
    result: StaffMcpToolResult | null,
    now = Date.now(),
  ): Promise<void> {
    const replayKeyHash = await keyedHash(this.hashSecret, 'replay', key);
    const leaseTokenHash = this.leases.get(replayKeyHash);
    if (!leaseTokenHash) throw new Error('staff_mcp_replay_lease_missing');
    const responseJson = result === null ? null : serializeReplayResult(result);
    const status = result === null ? 'COMPLETED_NO_RESPONSE' : 'COMPLETED';
    const updated = await this.database.prepare(`
      UPDATE staff_mcp_replay_records SET
        status=?,lease_token_hash=NULL,lease_expires_at=NULL,
        response_json=?,updated_at=MAX(?,updated_at),completed_at=?
      WHERE replay_key_hash=? AND request_hash=? AND status='PROCESSING'
        AND lease_token_hash=? AND lease_expires_at>?
    `).bind(
      status,
      responseJson,
      now,
      now,
      replayKeyHash,
      requestHash,
      leaseTokenHash,
      now,
    ).run();
    this.leases.delete(replayKeyHash);
    if (Number(updated.meta.changes) !== 1) {
      throw new Error('staff_mcp_replay_completion_conflict');
    }
  }

  async fail(key: string, requestHash: string): Promise<void> {
    const replayKeyHash = await keyedHash(this.hashSecret, 'replay', key);
    const leaseTokenHash = this.leases.get(replayKeyHash);
    if (!leaseTokenHash) return;
    await this.database.prepare(`
      DELETE FROM staff_mcp_replay_records
      WHERE replay_key_hash=? AND request_hash=? AND status='PROCESSING'
        AND lease_token_hash=?
    `).bind(replayKeyHash, requestHash, leaseTokenHash).run();
    this.leases.delete(replayKeyHash);
  }
}

export async function keyedHash(
  secret: string,
  purpose: string,
  value: string,
): Promise<string> {
  if (secret.length < 32 || value.length === 0 || value.length > 4096) {
    throw new Error('staff_mcp_hash_input_invalid');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`staff-mcp:${purpose}\u0000${value}`),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseStoredResult(value: string): StaffMcpToolResult {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('staff_mcp_replay_result_invalid');
  }
  const result = parsed as Record<string, unknown>;
  if (typeof result['isError'] !== 'boolean'
    || !Array.isArray(result['content'])
    || result['content'].length < 1
    || result['content'].length > 2) {
    throw new Error('staff_mcp_replay_result_invalid');
  }
  return parsed as StaffMcpToolResult;
}

function serializeReplayResult(result: StaffMcpToolResult): string {
  if (result.content.some((item) => item.type !== 'text')) {
    throw new Error('staff_mcp_replay_binary_forbidden');
  }
  const serialized = JSON.stringify(result);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPLAY_RESPONSE_BYTES
    || /"(?:access_token|refresh_token|provider(?:_file)?_id|object_key|drive_file_id|secret)"\s*:/iu
      .test(serialized)) {
    throw new Error('staff_mcp_replay_result_unsafe');
  }
  return serialized;
}
