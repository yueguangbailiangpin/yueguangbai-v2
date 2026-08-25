import type {
  OrderInstructionStatus,
  SqlDatabase,
  SqlStatement,
  MarketplaceCode,
  StaffPermissionCode,
} from '@ygb/contracts';
import { canonicalJson } from '@ygb/domain';
import {
  requireBuyerScope,
  resolveStaffDataScope,
} from '../staff-assignment/data-scope';
import type { AssignmentStaffAuthorization } from '../staff-assignment/effective-authorization';

export const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
export const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_EXPIRY_SCAN_BATCH_SIZE = 50;
export const MAX_EXPIRY_SCAN_BATCH_SIZE = 100;

export interface BuyerInstructionActor {
  buyerCustomerId: string;
  marketplaceCode: MarketplaceCode;
  accessStatus: 'ACTIVE' | 'DISABLED';
  identityReviewStatus: 'CLEAR' | 'REVIEW_REQUIRED';
}

export type OrderInstructionStaffActor = AssignmentStaffAuthorization;

export type OrderInstructionErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'STATE_CONFLICT'
  | 'RESERVATION_NOT_APPROVED'
  | 'INSTRUCTION_NOT_PUBLISHED'
  | 'INSTRUCTION_NOT_READABLE'
  | 'INSTRUCTION_TERMINAL'
  | 'INSTRUCTION_EXPIRED'
  | 'INSUFFICIENT_ORDER_WINDOW'
  | 'MAIN_IMAGE_REQUIRED'
  | 'KEYWORDS_REQUIRED'
  | 'ORDERING_PROFILE_REQUIRED'
  | 'SELF_PAY_ACCEPTANCE_MISMATCH'
  | 'EVIDENCE_ALREADY_EXISTS'
  | 'FORMAL_ORDER_ALREADY_EXISTS'
  | 'ORDER_NUMBER_ALREADY_CLAIMED'
  | 'ORDER_NUMBER_CONFLICT_REQUIRES_REVIEW'
  | 'FILE_NOT_VERIFIED'
  | 'FILE_ACCESS_DENIED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS';

export class OrderInstructionError extends Error {
  constructor(
    public readonly code: OrderInstructionErrorCode,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 503,
  ) {
    super(code);
    this.name = 'OrderInstructionError';
  }
}

export function validateTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function validateExpectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function cleanIdentifier(value: string, maximum = 200): string {
  if (typeof value !== 'string') {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanOptionalPublicText(
  value: string | null | undefined,
  maximum = 2000,
): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanRequiredReason(
  value: string | null | undefined,
): string {
  const reason = cleanOptionalPublicText(value, 1000);
  if (reason === null) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  return reason;
}

export function requireInstructionPermission(
  actor: OrderInstructionStaffActor,
  permission: StaffPermissionCode,
): void {
  if (!actor.permissions.has(permission)) {
    throw new OrderInstructionError('FORBIDDEN', 403);
  }
}


export async function requireInstructionBuyerScope(
  database: SqlDatabase,
  actor: OrderInstructionStaffActor,
  buyerCustomerId: string,
  permission: StaffPermissionCode,
): Promise<void> {
  try {
    const scope = await resolveStaffDataScope(database, actor, {
      requiredPermission: permission,
    });
    requireBuyerScope(scope, buyerCustomerId);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'FORBIDDEN') {
      throw new OrderInstructionError('FORBIDDEN', 403);
    }
    if (code === 'NOT_FOUND') {
      throw new OrderInstructionError('NOT_FOUND', 404);
    }
    throw error;
  }
}

export function validateBuyerActor(actor: BuyerInstructionActor): void {
  if (actor.marketplaceCode !== 'AMAZON_JP') {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  if (actor.accessStatus !== 'ACTIVE'
    || actor.identityReviewStatus !== 'CLEAR') {
    throw new OrderInstructionError('FORBIDDEN', 403);
  }
}

export function instructionCanReadImages(input: {
  status: OrderInstructionStatus;
  evidenceStatus: string | null;
  resubmissionDeadlineAt: number | null;
  formalOrderId: string | null;
  now: number;
}): boolean {
  if (input.status !== 'ACTIVE' || input.formalOrderId !== null) return false;
  if (input.evidenceStatus === 'CONSUMED'
    || input.evidenceStatus === 'WITHDRAWN') return false;
  if (input.evidenceStatus === 'CHANGES_REQUESTED') {
    return input.resubmissionDeadlineAt !== null
      && input.now < input.resubmissionDeadlineAt;
  }
  return input.evidenceStatus === null
    || input.evidenceStatus === 'PENDING_VERIFICATION'
    || input.evidenceStatus === 'VERIFIED';
}


export function assertPreviousStatementChangedOnce(
  database: SqlDatabase,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
  `);
}

export function insertInstructionEventStatement(
  database: SqlDatabase,
  input: {
    instructionId: string;
    reservationId: string;
    eventType: string;
    actorType: 'STAFF' | 'BUYER_CUSTOMER' | 'SYSTEM';
    actorId: string;
    previousStatus: OrderInstructionStatus | null;
    nextStatus: OrderInstructionStatus;
    instructionVersion: number;
    instructionVersionId?: string | null;
    reason?: string | null;
    metadata?: unknown;
    idempotencyKey: string;
    createdAt: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO order_instruction_events (
      id, instruction_id, reservation_id, instruction_version_id,
      event_type, actor_type, actor_id, previous_status, next_status,
      aggregate_version, reason, metadata_json, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.instructionId,
    input.reservationId,
    input.instructionVersionId ?? null,
    input.eventType,
    input.actorType,
    input.actorId,
    input.previousStatus,
    input.nextStatus,
    input.instructionVersion,
    input.reason ?? null,
    canonicalJson(input.metadata ?? {}),
    input.idempotencyKey,
    input.createdAt,
  );
}

export function normalizeOrderInstructionError(
  error: unknown,
): OrderInstructionError {
  if (error instanceof OrderInstructionError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return new OrderInstructionError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (code === 'REQUEST_IN_PROGRESS') {
    return new OrderInstructionError('REQUEST_IN_PROGRESS', 409);
  }
  const message = String(error);
  if (message.includes('instruction_version_conflict')
    || message.includes('transaction_assertion_failed')) {
    return new OrderInstructionError('VERSION_CONFLICT', 409);
  }
  if (message.includes('formal_order_number_claims')) {
    return new OrderInstructionError('ORDER_NUMBER_ALREADY_CLAIMED', 409);
  }
  return new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
}
