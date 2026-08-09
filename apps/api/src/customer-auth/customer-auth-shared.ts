import type {
  SqlDatabase,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  canonicalJson,
  CUSTOMER_PASSWORD_DEFAULT_ITERATIONS,
  hashCustomerPassword,
  normalizeWechatId,
  type PasswordCredential,
} from '@ygb/domain';

export interface CustomerAccessActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
}

export class CustomerAuthError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'CUSTOMER_NOT_FOUND'
      | 'CUSTOMER_ALREADY_ACTIVE'
      | 'CUSTOMER_NOT_ACTIVE'
      | 'IDENTITY_REVIEW_REQUIRED'
      | 'INVALID_CREDENTIALS'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 401 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'CustomerAuthError';
  }
}

export interface PreparedTemporaryCredential {
  temporaryPassword: string;
  credential: PasswordCredential;
}

export async function prepareTemporaryCredential(
  generateTemporaryPassword: () => string,
  iterations = CUSTOMER_PASSWORD_DEFAULT_ITERATIONS,
): Promise<PreparedTemporaryCredential> {
  const temporaryPassword = generateTemporaryPassword();
  const credential = await hashCustomerPassword(
    temporaryPassword,
    { iterations },
  );
  return {
    temporaryPassword,
    credential,
  };
}

export function requireStaffPermission(
  actor: CustomerAccessActor,
  permission: StaffPermissionCode,
): void {
  if (!actor.permissions.has(permission)) {
    throw new CustomerAuthError('FORBIDDEN', 403);
  }
}

export function normalizeLoginIdentifier(
  value: string,
): {
  display: string;
  normalized: string;
} {
  try {
    return normalizeWechatId(value);
  } catch {
    throw new CustomerAuthError('VALIDATION_ERROR', 400);
  }
}

export function insertCredentialStatement(
  database: SqlDatabase,
  input: {
    accountId: string;
    credential: PasswordCredential;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO customer_password_credentials (
      account_id,
      algorithm,
      iterations,
      salt_base64url,
      hash_base64url,
      password_version,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).bind(
    input.accountId,
    input.credential.algorithm,
    input.credential.iterations,
    input.credential.saltBase64Url,
    input.credential.hashBase64Url,
    input.now,
    input.now,
  );
}

export function insertAccessEventStatement(
  database: SqlDatabase,
  input: {
    accountId: string;
    identitySubjectId: string;
    eventType:
      | 'ACCOUNT_ACTIVATED'
      | 'PASSWORD_CHANGED'
      | 'SESSIONS_REVOKED'
      | 'ACCOUNT_DISABLED';
    actorType: 'STAFF' | 'CUSTOMER_ACCOUNT';
    actorId: string;
    previousState: unknown | null;
    nextState: unknown;
    requestId?: string | null;
    idempotencyKey?: string | null;
    createdAt: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO customer_access_events (
      id,
      account_id,
      identity_subject_id,
      event_type,
      actor_type,
      actor_id,
      previous_state_json,
      next_state_json,
      request_id,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.accountId,
    input.identitySubjectId,
    input.eventType,
    input.actorType,
    input.actorId,
    input.previousState === null
      ? null
      : canonicalJson(input.previousState),
    canonicalJson(input.nextState),
    input.requestId ?? null,
    input.idempotencyKey ?? null,
    input.createdAt,
  );
}

export function normalizeCustomerAuthError(
  error: unknown,
): CustomerAuthError {
  if (error instanceof CustomerAuthError) return error;

  const record = error as {
    code?: unknown;
  };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new CustomerAuthError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new CustomerAuthError('REQUEST_IN_PROGRESS', 409);
  }

  const message = String(error);
  if (message.includes('invalid_customer_password')
    || message.includes('invalid_password_iterations')
    || message.includes('invalid_password_salt')) {
    return new CustomerAuthError('VALIDATION_ERROR', 400);
  }
  if (message.includes('customer_login_accounts.identity_subject_id')
    || message.includes('customer_login_accounts.login_identifier_normalized')) {
    return new CustomerAuthError('CUSTOMER_ALREADY_ACTIVE', 409);
  }
  if (message.includes('transaction_assertion_failed')) {
    return new CustomerAuthError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return new CustomerAuthError('DEPENDENCY_UNAVAILABLE', 503);
}
