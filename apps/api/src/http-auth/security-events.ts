import type { SqlDatabase } from '@ygb/contracts';

export type CustomerAuthSecurityEventType =
  | 'LOGIN_SUCCEEDED'
  | 'LOGIN_FAILED'
  | 'LOGIN_RATE_LIMITED'
  | 'SESSION_REJECTED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_CHANGE_RATE_LIMITED'
  | 'LOGOUT';

export async function recordCustomerAuthSecurityEvent(
  database: SqlDatabase,
  input: {
    eventType: CustomerAuthSecurityEventType;
    outcome: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
    accountId?: string | null;
    loginIdentifierHash?: string | null;
    networkSourceHash?: string | null;
    requestId: string;
    createdAt: number;
  },
): Promise<void> {
  await database.prepare(`
    INSERT INTO customer_auth_security_events (
      id,
      event_type,
      outcome,
      account_id,
      login_identifier_hash,
      network_source_hash,
      request_id,
      metadata_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)
  `).bind(
    crypto.randomUUID(),
    input.eventType,
    input.outcome,
    input.accountId ?? null,
    input.loginIdentifierHash ?? null,
    input.networkSourceHash ?? null,
    input.requestId,
    input.createdAt,
  ).run();
}
