import type {
  OrderEvidenceEventType,
  OrderEvidenceStatus,
  SqlDatabase,
  SqlStatement,
  MarketplaceCode,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import { canonicalJson } from '@ygb/domain';

const AMAZON_ORDER_NUMBER_DIGITS = 17;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export interface BuyerOrderEvidenceActor {
  buyerCustomerId: string;
  marketplaceCode: MarketplaceCode;
  accessStatus: 'ACTIVE' | 'DISABLED';
  identityReviewStatus: 'CLEAR' | 'REVIEW_REQUIRED';
}

export interface StaffOrderEvidenceActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
}

export type OrderEvidenceErrorCode =
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'ORDER_EVIDENCE_NOT_FOUND'
  | 'ORDER_EVIDENCE_ALREADY_EXISTS'
  | 'ORDER_EVIDENCE_STATE_CONFLICT'
  | 'ORDER_EVIDENCE_FILE_CONFLICT'
  | 'ORDER_NUMBER_ALREADY_CLAIMED'
  | 'RESERVATION_NOT_FOUND'
  | 'FILE_OBJECT_NOT_FOUND'
  | 'FILE_NOT_VERIFIED'
  | 'VERSION_CONFLICT'
  | 'CUSTOMER_NOT_ACTIVE'
  | 'IDENTITY_REVIEW_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'DEPENDENCY_UNAVAILABLE';

export class OrderEvidenceError extends Error {
  constructor(
    public readonly code: OrderEvidenceErrorCode,
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'OrderEvidenceError';
  }
}

export function validateBuyerOrderEvidenceActor(
  actor: BuyerOrderEvidenceActor,
): void {
  if (actor.marketplaceCode !== 'AMAZON_JP') {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  if (actor.accessStatus !== 'ACTIVE') {
    throw new OrderEvidenceError('CUSTOMER_NOT_ACTIVE', 409);
  }
  if (actor.identityReviewStatus !== 'CLEAR') {
    throw new OrderEvidenceError(
      'IDENTITY_REVIEW_REQUIRED',
      409,
    );
  }
}

export function requireOrderEvidenceViewPermission(
  actor: StaffOrderEvidenceActor,
): void {
  if (!actor.permissions.has('ORDER_VIEW')) {
    throw new OrderEvidenceError('FORBIDDEN', 403);
  }
}

export function requireOrderEvidenceDecisionPermission(
  actor: StaffOrderEvidenceActor,
): void {
  if (!actor.permissions.has('ORDER_CONFIRM')) {
    throw new OrderEvidenceError('FORBIDDEN', 403);
  }
}

export function cleanOrderEvidenceIdentifier(
  value: string,
  maximum = 200,
): string {
  if (typeof value !== 'string') {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanOptionalOrderEvidenceText(
  value: string | null | undefined,
  maximum = 2000,
): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanRequiredOrderEvidenceText(
  value: string | null | undefined,
  maximum = 2000,
): string {
  const normalized = cleanOptionalOrderEvidenceText(value, maximum);
  if (normalized === null) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export interface NormalizedAmazonOrderNumber {
  raw: string;
  normalized: string;
}

export function normalizeAmazonOrderNumber(
  value: string,
): NormalizedAmazonOrderNumber {
  if (typeof value !== 'string') {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  const raw = value.normalize('NFKC').trim();
  if (raw.length < 1
    || raw.length > 100
    || /[\u0000-\u001f\u007f]/u.test(raw)) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }

  const compact = raw
    .replace(/[‐‑‒–—―−﹘﹣－]/gu, '-')
    .replace(/[\s\u00a0]/gu, '');
  if (!/^[0-9-]+$/u.test(compact)) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  const digits = compact.replaceAll('-', '');
  if (digits.length !== AMAZON_ORDER_NUMBER_DIGITS
    || !/^\d{17}$/u.test(digits)) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }

  return {
    raw,
    normalized:
      `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`,
  };
}

export function validateFinalPaidJpy(value: number): number {
  if (!Number.isSafeInteger(value)
    || value < 0
    || value > MAX_SAFE_INTEGER) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function validateExpectedVersion(
  value: number,
  options: { allowZero?: boolean } = {},
): number {
  const minimum = options.allowZero === true ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function validateCommandTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function normalizeEvidenceFileIds(
  values: readonly string[],
): readonly string[] {
  if (!Array.isArray(values)
    || values.length !== 1) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  const normalized = values.map((value) =>
    cleanOrderEvidenceIdentifier(value, 120));
  const unique = [...new Set(normalized)].sort();
  if (unique.length !== normalized.length) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  return Object.freeze(unique);
}

export function insertOrderEvidenceEventStatement(
  database: SqlDatabase,
  input: {
    submissionId: string;
    reservationId: string;
    buyerCustomerId: string;
    evidenceVersionId: string;
    eventType: OrderEvidenceEventType;
    actorType: 'BUYER_CUSTOMER' | 'STAFF' | 'SYSTEM';
    actorId: string;
    previousStatus: OrderEvidenceStatus | null;
    nextStatus: OrderEvidenceStatus;
    aggregateVersion: number;
    publicReason?: string | null;
    internalNote?: string | null;
    metadata?: unknown;
    idempotencyKey: string;
    createdAt: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO order_evidence_events (
      id,
      submission_id,
      reservation_id,
      buyer_customer_id,
      evidence_version_id,
      event_type,
      actor_type,
      actor_id,
      previous_status,
      next_status,
      aggregate_version,
      public_reason,
      internal_note,
      metadata_json,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.submissionId,
    input.reservationId,
    input.buyerCustomerId,
    input.evidenceVersionId,
    input.eventType,
    input.actorType,
    input.actorId,
    input.previousStatus,
    input.nextStatus,
    input.aggregateVersion,
    input.publicReason ?? null,
    input.internalNote ?? null,
    canonicalJson(input.metadata ?? {}),
    input.idempotencyKey,
    input.createdAt,
  );
}

export function normalizeOrderEvidenceError(
  error: unknown,
): OrderEvidenceError {
  if (error instanceof OrderEvidenceError) return error;

  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return new OrderEvidenceError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (code === 'REQUEST_IN_PROGRESS') {
    return new OrderEvidenceError('REQUEST_IN_PROGRESS', 409);
  }
  if (code === 'ORDER_NUMBER_ALREADY_CLAIMED'
    || code === 'ORDER_NUMBER_CONFLICT_REQUIRES_REVIEW') {
    return new OrderEvidenceError('ORDER_NUMBER_ALREADY_CLAIMED', 409);
  }

  const message = String(error);
  if (message.includes(
    'order_evidence_submissions.reservation_id',
  )) {
    return new OrderEvidenceError(
      'ORDER_EVIDENCE_ALREADY_EXISTS',
      409,
    );
  }
  if (message.includes('order_evidence_file_conflict')
    || message.includes('file_entity_links.file_object_id')) {
    return new OrderEvidenceError(
      'ORDER_EVIDENCE_FILE_CONFLICT',
      409,
    );
  }
  if (message.includes('order_evidence_file_not_verified')) {
    return new OrderEvidenceError('FILE_NOT_VERIFIED', 409);
  }
  if (message.includes('formal_order_number_claims')
    || message.includes('uq_formal_order_number_claims_active')
    || message.includes('formal_order_number_claim_source_mismatch')) {
    return new OrderEvidenceError('ORDER_NUMBER_ALREADY_CLAIMED', 409);
  }
  if (message.includes('transaction_assertion_failed')) {
    return new OrderEvidenceError('VERSION_CONFLICT', 409);
  }
  return new OrderEvidenceError('DEPENDENCY_UNAVAILABLE', 503);
}
