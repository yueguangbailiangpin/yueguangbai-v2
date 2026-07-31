import type {
  SqlDatabase,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  CustomerNumberError,
  normalizeWechatId,
  type NormalizedWechatId,
} from '@ygb/domain';

export interface CustomerMasterActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
}


export function normalizeWechatForMasterData(
  value: string,
): NormalizedWechatId {
  try {
    return normalizeWechatId(value);
  } catch {
    throw new CustomerMasterDataError('VALIDATION_ERROR', 400);
  }
}

export interface ActiveWechatConflictRow {
  claim_id: string;
  identity_subject_id: string;
  status: 'ACTIVE' | 'RESERVED';
}

export function requirePermission(
  actor: CustomerMasterActor,
  permission: StaffPermissionCode,
): void {
  if (!actor.permissions.has(permission)) {
    throw new CustomerMasterDataError('FORBIDDEN', 403);
  }
}

export async function assertWechatAvailable(
  database: SqlDatabase,
  normalizedWechat: string,
): Promise<void> {
  const existing = await database.prepare(`
    SELECT
      id AS claim_id,
      identity_subject_id,
      status
    FROM wechat_identity_claims
    WHERE normalized_wechat=?
      AND status IN ('ACTIVE', 'RESERVED')
    LIMIT 1
  `).bind(normalizedWechat).first<ActiveWechatConflictRow>();

  if (existing) {
    throw new CustomerMasterDataError('WECHAT_ID_CONFLICT', 409);
  }
}

export function createIdentityClaimStatements(
  database: SqlDatabase,
  input: {
    subjectId: string;
    subjectType: 'BUYER_CUSTOMER' | 'SELLER_ORG_MEMBER';
    claimId: string;
    displayWechat: string;
    normalizedWechat: string;
    actor: CustomerMasterActor;
    idempotencyKey: string;
    now: number;
  },
): readonly SqlStatement[] {
  return [
    database.prepare(`
      INSERT INTO customer_identity_subjects (
        id,
        subject_type,
        created_at
      ) VALUES (?, ?, ?)
    `).bind(
      input.subjectId,
      input.subjectType,
      input.now,
    ),
    database.prepare(`
      INSERT INTO wechat_identity_claims (
        id,
        identity_subject_id,
        display_wechat,
        normalized_wechat,
        status,
        version,
        acquired_at,
        reserved_at,
        released_at,
        created_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, 'ACTIVE', 1, ?,
        NULL, NULL, ?, ?
      )
    `).bind(
      input.claimId,
      input.subjectId,
      input.displayWechat,
      input.normalizedWechat,
      input.now,
      input.now,
      input.now,
    ),
    database.prepare(`
      INSERT INTO customer_identity_claim_events (
        id,
        claim_id,
        identity_subject_id,
        event_type,
        previous_status,
        next_status,
        actor_type,
        actor_id,
        reason,
        idempotency_key,
        created_at
      ) VALUES (
        ?, ?, ?, 'CLAIMED', NULL, 'ACTIVE',
        'STAFF', ?, NULL, ?, ?
      )
    `).bind(
      crypto.randomUUID(),
      input.claimId,
      input.subjectId,
      input.actor.staffId,
      input.idempotencyKey,
      input.now,
    ),
  ] as const;
}

export class CustomerMasterDataError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'CHANNEL_NOT_FOUND'
      | 'CUSTOMER_NOT_FOUND'
      | 'CUSTOMER_NOT_ACTIVE'
      | 'WECHAT_ID_CONFLICT'
      | 'SEQUENCE_CONFLICT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'CustomerMasterDataError';
  }
}

export function cleanRequiredText(
  value: string,
  maximum: number,
): string {
  if (typeof value !== 'string') {
    throw new CustomerMasterDataError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new CustomerMasterDataError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function normalizeFoundationError(
  error: unknown,
): CustomerMasterDataError {
  if (error instanceof CustomerMasterDataError) return error;

  const record = error as {
    code?: unknown;
    status?: unknown;
  };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new CustomerMasterDataError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new CustomerMasterDataError('REQUEST_IN_PROGRESS', 409);
  }

  if (error instanceof CustomerNumberError) {
    return error.reason === 'invalid_business_date'
      ? new CustomerMasterDataError('VALIDATION_ERROR', 400)
      : new CustomerMasterDataError('DEPENDENCY_UNAVAILABLE', 503);
  }

  const message = String(error);
  if (message.includes('uq_wechat_claim_active_or_reserved')
    || message.includes('wechat_identity_claims.normalized_wechat')) {
    return new CustomerMasterDataError('WECHAT_ID_CONFLICT', 409);
  }
  if (message.includes('transaction_assertion_failed')
    || message.includes('UNIQUE constraint failed')) {
    return new CustomerMasterDataError('SEQUENCE_CONFLICT', 409);
  }
  return new CustomerMasterDataError('DEPENDENCY_UNAVAILABLE', 503);
}
