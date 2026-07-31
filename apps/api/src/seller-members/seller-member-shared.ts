import type {
  SellerMemberRole,
  SqlDatabase,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  isSellerMemberRole,
} from '@ygb/contracts';
import {
  canonicalJson,
} from '@ygb/domain';

export interface SellerMemberStaffActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
}

export class SellerMemberError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'WECHAT_ID_CONFLICT'
      | 'SELLER_MEMBER_NOT_FOUND'
      | 'SELLER_MEMBER_ALREADY_ACTIVE'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'SellerMemberError';
  }
}

export function requireSellerMemberPermission(
  actor: SellerMemberStaffActor,
): void {
  if (!actor.permissions.has('SELLER_MANAGE')) {
    throw new SellerMemberError('FORBIDDEN', 403);
  }
}

export function cleanSellerMemberIdentifier(
  value: string,
  maximum = 120,
): string {
  if (typeof value !== 'string') {
    throw new SellerMemberError('VALIDATION_ERROR', 400);
  }
  const cleaned = value.normalize('NFKC').trim();
  if (cleaned.length < 1
    || cleaned.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(cleaned)) {
    throw new SellerMemberError('VALIDATION_ERROR', 400);
  }
  return cleaned;
}

export function cleanSellerMemberDisplayName(
  value: string,
): string {
  return cleanSellerMemberIdentifier(value, 100);
}

export function parseSellerMemberRole(
  value: unknown,
): SellerMemberRole {
  if (!isSellerMemberRole(value)) {
    throw new SellerMemberError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function insertSellerMemberEventStatement(
  database: SqlDatabase,
  input: {
    memberId: string;
    organizationId: string;
    eventType:
      | 'SELLER_MEMBER_CREATED'
      | 'SELLER_MEMBER_ACTIVATED'
      | 'SELLER_MEMBER_ROLE_CHANGED'
      | 'SELLER_MEMBER_DISABLED';
    actorType: 'STAFF' | 'SELLER_MEMBER';
    actorId: string;
    previousState: unknown | null;
    nextState: unknown;
    requestId?: string | null;
    idempotencyKey: string;
    createdAt: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO seller_member_events (
      id,
      member_id,
      organization_id,
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
    input.memberId,
    input.organizationId,
    input.eventType,
    input.actorType,
    input.actorId,
    input.previousState === null
      ? null
      : canonicalJson(input.previousState),
    canonicalJson(input.nextState),
    input.requestId ?? null,
    input.idempotencyKey,
    input.createdAt,
  );
}

export function normalizeSellerMemberError(
  error: unknown,
): SellerMemberError {
  if (error instanceof SellerMemberError) return error;

  const record = error as {
    code?: unknown;
  };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new SellerMemberError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new SellerMemberError('REQUEST_IN_PROGRESS', 409);
  }
  if (record?.code === 'WECHAT_ID_CONFLICT') {
    return new SellerMemberError('WECHAT_ID_CONFLICT', 409);
  }

  const message = String(error);
  if (message.includes('uq_wechat_claim_active_or_reserved')
    || message.includes(
      'wechat_identity_claims.normalized_wechat',
    )
    || message.includes(
      'customer_login_accounts.login_identifier_normalized',
    )) {
    return new SellerMemberError('WECHAT_ID_CONFLICT', 409);
  }
  if (message.includes(
    'seller_organization_members.organization_id, '
      + 'seller_organization_members.member_number',
  )
    || message.includes(
      'seller_organization_members.username_fallback',
    )
    || message.includes('transaction_assertion_failed')) {
    return new SellerMemberError('VERSION_CONFLICT', 409);
  }
  return new SellerMemberError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}
