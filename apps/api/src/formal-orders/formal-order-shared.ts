import type {
  PricingReviewType,
  SqlDatabase,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import { isPricingReviewType } from '@ygb/contracts';

export interface FormalOrderStaffActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
}

export type FormalOrderErrorCode =
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'ORDER_EVIDENCE_NOT_FOUND'
  | 'ORDER_EVIDENCE_STATE_CONFLICT'
  | 'RESERVATION_NOT_FOUND'
  | 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND'
  | 'PRICING_RULE_NOT_FOUND'
  | 'CUSTOMER_NOT_ACTIVE'
  | 'FORMAL_ORDER_ALREADY_EXISTS'
  | 'FORMAL_ORDER_STATE_CONFLICT'
  | 'DEPENDENCY_UNAVAILABLE';

export class FormalOrderError extends Error {
  constructor(
    public readonly code: FormalOrderErrorCode,
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'FormalOrderError';
  }
}

export function requireFormalOrderConfirmationPermission(
  actor: FormalOrderStaffActor,
): void {
  validateActor(actor);
  const roleAllowed = actor.roles.includes('owner')
    || actor.roles.includes('pre_sales');
  if (!roleAllowed || !actor.permissions.has('ORDER_CONFIRM')) {
    throw new FormalOrderError('FORBIDDEN', 403);
  }
}

export function cleanFormalOrderIdentifier(
  raw: string,
  maximum = 120,
): string {
  if (typeof raw !== 'string') {
    throw new FormalOrderError('VALIDATION_ERROR', 400);
  }
  const normalized = raw.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new FormalOrderError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanFormalOrderExpectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new FormalOrderError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function cleanFormalOrderTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FormalOrderError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function requireFormalOrderReviewType(
  value: unknown,
): PricingReviewType {
  if (!isPricingReviewType(value)) {
    throw new FormalOrderError('FORMAL_ORDER_STATE_CONFLICT', 409);
  }
  return value;
}

export function assertPreviousStatementChangedOnce(
  database: SqlDatabase,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
  `);
}

export function normalizeFormalOrderError(
  error: unknown,
): FormalOrderError {
  if (error instanceof FormalOrderError) return error;

  const record = error as {
    code?: unknown;
    status?: unknown;
  };
  const code = typeof record?.code === 'string'
    ? record.code
    : null;

  if (code === 'IDEMPOTENCY_CONFLICT') {
    return new FormalOrderError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (code === 'REQUEST_IN_PROGRESS') {
    return new FormalOrderError('REQUEST_IN_PROGRESS', 409);
  }
  if (code === 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND') {
    return new FormalOrderError(
      'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND',
      404,
    );
  }
  if (code === 'PRICING_RULE_NOT_FOUND') {
    return new FormalOrderError('PRICING_RULE_NOT_FOUND', 404);
  }
  if (code === 'VALIDATION_ERROR') {
    return new FormalOrderError('VALIDATION_ERROR', 400);
  }

  const message = String(error);
  if (message.includes('UNIQUE constraint failed: formal_orders.')) {
    return new FormalOrderError('FORMAL_ORDER_ALREADY_EXISTS', 409);
  }
  if (message.includes('formal_order_source_mismatch')
    || message.includes('formal_order_event_identity_mismatch')
    || message.includes('formal_order_financial_snapshot_source_mismatch')
    || message.includes('FOREIGN KEY constraint failed')) {
    return new FormalOrderError('FORMAL_ORDER_STATE_CONFLICT', 409);
  }
  if (message.includes('buyer_number_events')
    || message.includes('buyer_number_allocation_events')
    || message.includes('uq_buyer_channel_sequence')
    || message.includes('buyer_customers.buyer_customer_no')
    || message.includes('transaction_assertion_failed')) {
    return new FormalOrderError('VERSION_CONFLICT', 409);
  }
  if (message.includes('formal_orders_are_immutable')
    || message.includes('formal_order_financial_snapshots_are_immutable')
    || message.includes('formal_order_events_are_immutable')) {
    return new FormalOrderError('FORMAL_ORDER_STATE_CONFLICT', 409);
  }
  return new FormalOrderError('DEPENDENCY_UNAVAILABLE', 503);
}

function validateActor(actor: FormalOrderStaffActor): void {
  if (!actor
    || typeof actor.staffId !== 'string'
    || actor.staffId.length < 1
    || actor.staffId.length > 120
    || typeof actor.displayName !== 'string'
    || actor.displayName.length < 1
    || actor.displayName.length > 100
    || actor.roles.length < 1
    || typeof actor.permissions?.has !== 'function') {
    throw new FormalOrderError('VALIDATION_ERROR', 400);
  }
}
