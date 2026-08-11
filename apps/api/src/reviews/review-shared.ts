import type {
  PricingReviewType,
  ReviewCaseStatus,
  SqlDatabase,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  normalizeReviewUrl,
  ReviewUrlValidationError,
} from '@ygb/domain';

export interface BuyerReviewActor {
  buyerCustomerId: string;
}

export interface StaffReviewActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
}

export type ReviewErrorCode =
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'FORMAL_ORDER_NOT_FOUND'
  | 'FORMAL_ORDER_STATE_CONFLICT'
  | 'REVIEW_CASE_NOT_FOUND'
  | 'REVIEW_ALREADY_EXISTS'
  | 'REVIEW_STATE_CONFLICT'
  | 'REVIEW_FILE_CONFLICT'
  | 'FILE_OBJECT_NOT_FOUND'
  | 'FILE_NOT_VERIFIED'
  | 'DEPENDENCY_UNAVAILABLE';

export class ReviewError extends Error {
  constructor(
    public readonly code: ReviewErrorCode,
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'ReviewError';
  }
}

export function validateBuyerReviewActor(actor: BuyerReviewActor): void {
  if (!actor || !safeText(actor.buyerCustomerId, 120)) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
}

export function requireReviewDecisionPermission(
  actor: StaffReviewActor,
): void {
  validateStaffReviewActor(actor);
  const roleAllowed = actor.roles.includes('owner')
    || actor.roles.includes('buyer_refund');
  if (!roleAllowed || !actor.permissions.has('REVIEW_DECIDE')) {
    throw new ReviewError('FORBIDDEN', 403);
  }
}

export function cleanReviewIdentifier(
  raw: string,
  maximum = 120,
): string {
  if (typeof raw !== 'string') {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  const normalized = raw.normalize('NFKC').trim();
  if (!safeText(normalized, maximum)) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanExpectedVersion(
  value: number,
  options: { allowZero?: boolean } = {},
): number {
  const minimum = options.allowZero === true ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function cleanReviewTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function cleanReviewUrl(
  reviewType: PricingReviewType,
  raw: string | null | undefined,
): string | null {
  try {
    return normalizeReviewUrl(reviewType, raw);
  } catch (error) {
    if (error instanceof ReviewUrlValidationError) {
      throw new ReviewError('VALIDATION_ERROR', 400);
    }
    throw error;
  }
}

export function cleanOptionalReviewText(
  raw: string | null | undefined,
  maximum: number,
): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  const normalized = raw.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  if (!safeText(normalized, maximum)) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanRequiredReviewText(
  raw: string,
  maximum: number,
): string {
  const normalized = cleanOptionalReviewText(raw, maximum);
  if (normalized === null) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function normalizeReviewFileInputs(
  files: readonly {
    fileObjectId: string;
    expectedFileVersion: number;
  }[],
): readonly {
  fileObjectId: string;
  expectedFileVersion: number;
}[] {
  if (!Array.isArray(files) || files.length < 1 || files.length > 3) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  const seen = new Set<string>();
  const normalized = files.map((file) => {
    const fileObjectId = cleanReviewIdentifier(file.fileObjectId, 120);
    const expectedFileVersion = cleanExpectedVersion(
      file.expectedFileVersion,
    );
    if (seen.has(fileObjectId)) {
      throw new ReviewError('REVIEW_FILE_CONFLICT', 409);
    }
    seen.add(fileObjectId);
    return { fileObjectId, expectedFileVersion };
  });
  return Object.freeze(normalized);
}

export function assertPreviousStatementChangedOnce(
  database: SqlDatabase,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
  `);
}

export function normalizeReviewError(error: unknown): ReviewError {
  if (error instanceof ReviewError) return error;
  const record = error as { code?: unknown; status?: unknown };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new ReviewError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new ReviewError('REQUEST_IN_PROGRESS', 409);
  }
  if (record?.code === 'VERSION_CONFLICT') {
    return new ReviewError('VERSION_CONFLICT', 409);
  }
  if (record?.code === 'BUYER_REFUND_STATE_CONFLICT'
    || record?.code === 'SELLER_SETTLEMENT_CONFLICT') {
    return new ReviewError('FORMAL_ORDER_STATE_CONFLICT', 409);
  }
  if (record?.code === 'BUYER_REFUND_NOT_FOUND') {
    return new ReviewError('FORMAL_ORDER_NOT_FOUND', 404);
  }
  if (record?.code === 'FILE_OBJECT_NOT_FOUND'
    || record?.code === 'NOT_FOUND') {
    return new ReviewError('FILE_OBJECT_NOT_FOUND', 404);
  }
  if (record?.code === 'FILE_NOT_VERIFIED') {
    return new ReviewError('FILE_NOT_VERIFIED', 409);
  }
  if (record?.code === 'FORBIDDEN') {
    return new ReviewError('FORBIDDEN', 403);
  }
  if (record?.code === 'VALIDATION_ERROR') {
    return new ReviewError('VALIDATION_ERROR', 400);
  }

  const message = String(error);
  if (message.includes('UNIQUE constraint failed: review_cases.formal_order_id')) {
    return new ReviewError('REVIEW_ALREADY_EXISTS', 409);
  }
  if (message.includes('UNIQUE constraint failed: review_evidence_version_files')
    || message.includes('review_evidence_file_authority_mismatch')) {
    return new ReviewError('REVIEW_FILE_CONFLICT', 409);
  }
  if (message.includes('review_evidence_version_url_invalid')) {
    return new ReviewError('VALIDATION_ERROR', 400);
  }
  if (message.includes('review_case_invalid_transition')
    || message.includes('review_case_source_mismatch')
    || message.includes('review_evidence_version_source_mismatch')
    || message.includes('review_event_identity_mismatch')
    || message.includes('review_cases_are_immutable')
    || message.includes('review_evidence_versions_are_immutable')
    || message.includes('review_evidence_version_files_are_immutable')
    || message.includes('review_events_are_immutable')
    || message.includes('FOREIGN KEY constraint failed')) {
    return new ReviewError('REVIEW_STATE_CONFLICT', 409);
  }
  if (message.includes('transaction_assertion_failed')) {
    return new ReviewError('VERSION_CONFLICT', 409);
  }
  return new ReviewError('DEPENDENCY_UNAVAILABLE', 503);
}

export function isTerminalReviewStatus(status: ReviewCaseStatus): boolean {
  return status === 'REJECTED'
    || status === 'WITHDRAWN'
    || status === 'APPROVED';
}

function validateStaffReviewActor(actor: StaffReviewActor): void {
  if (!actor
    || !safeText(actor.staffId, 120)
    || !safeText(actor.displayName, 100)
    || !Array.isArray(actor.roles)
    || actor.roles.length !== 1
    || typeof actor.permissions?.has !== 'function') {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
}

function safeText(value: string, maximum: number): boolean {
  return value.length >= 1
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}
