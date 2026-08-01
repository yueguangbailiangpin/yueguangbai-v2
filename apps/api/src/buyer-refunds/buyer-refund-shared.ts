import {
  isBuyerRefundPaymentChannel,
  type BuyerRefundPaymentChannel,
  type BuyerRefundProofFileInput,
  type BuyerRefundStatus,
  type SqlDatabase,
  type SqlStatement,
  type StaffPermissionCode,
  type StaffRoleCode,
} from '@ygb/contracts';

export interface BuyerRefundStaffActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
}

export type BuyerRefundObligationActor =
  | {
      type: 'SYSTEM';
      systemId: string;
    }
  | {
      type: 'STAFF';
      staff: BuyerRefundStaffActor;
    };

export type BuyerRefundErrorCode =
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'BUYER_REFUND_NOT_FOUND'
  | 'BUYER_REFUND_ALREADY_EXISTS'
  | 'BUYER_REFUND_STATE_CONFLICT'
  | 'BUYER_REFUND_FILE_CONFLICT'
  | 'BUYER_REFUND_PAYMENT_NOT_FOUND'
  | 'BUYER_REFUND_REVERSAL_EXCEEDS_PAYMENT'
  | 'FILE_OBJECT_NOT_FOUND'
  | 'FILE_NOT_VERIFIED'
  | 'DEPENDENCY_UNAVAILABLE';

export class BuyerRefundError extends Error {
  constructor(
    public readonly code: BuyerRefundErrorCode,
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'BuyerRefundError';
  }
}

export function requireBuyerRefundViewPermission(
  actor: BuyerRefundStaffActor,
): void {
  validateBuyerRefundStaffActor(actor);
  const roleAllowed = actor.roles.includes('owner')
    || actor.roles.includes('after_sales')
    || actor.roles.includes('buyer_support');
  if (!roleAllowed || !actor.permissions.has('BUYER_REFUND_VIEW')) {
    throw new BuyerRefundError('FORBIDDEN', 403);
  }
}

export function requireBuyerRefundRecordPermission(
  actor: BuyerRefundStaffActor,
): void {
  validateBuyerRefundStaffActor(actor);
  const roleAllowed = actor.roles.includes('owner')
    || actor.roles.includes('after_sales');
  if (!roleAllowed || !actor.permissions.has('BUYER_REFUND_RECORD')) {
    throw new BuyerRefundError('FORBIDDEN', 403);
  }
}

export function validateBuyerRefundObligationActor(
  actor: BuyerRefundObligationActor,
): void {
  if (actor.type === 'SYSTEM') {
    cleanBuyerRefundIdentifier(actor.systemId, 200);
    return;
  }
  requireBuyerRefundRecordPermission(actor.staff);
}

export function buyerRefundActorIdentity(
  actor: BuyerRefundObligationActor,
): {
  actorType: 'SYSTEM' | 'STAFF';
  actorId: string;
  actorRoles: readonly StaffRoleCode[];
} {
  validateBuyerRefundObligationActor(actor);
  if (actor.type === 'SYSTEM') {
    return {
      actorType: 'SYSTEM',
      actorId: actor.systemId,
      actorRoles: [],
    };
  }
  return {
    actorType: 'STAFF',
    actorId: actor.staff.staffId,
    actorRoles: actor.staff.roles,
  };
}

export function cleanBuyerRefundIdentifier(
  raw: string,
  maximum = 120,
): string {
  if (typeof raw !== 'string') {
    throw new BuyerRefundError('VALIDATION_ERROR', 400);
  }
  const normalized = raw.normalize('NFKC').trim();
  if (!safeText(normalized, maximum)) {
    throw new BuyerRefundError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanBuyerRefundExpectedVersion(
  value: number,
  options: { allowZero?: boolean } = {},
): number {
  const minimum = options.allowZero === true ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new BuyerRefundError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function cleanBuyerRefundAmount(
  value: number,
  options: { allowZero?: boolean } = {},
): number {
  const minimum = options.allowZero === true ? 0 : 1;
  if (!Number.isSafeInteger(value)
    || value < minimum
    || value > Number.MAX_SAFE_INTEGER) {
    throw new BuyerRefundError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function cleanBuyerRefundTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BuyerRefundError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function cleanBuyerRefundBusinessDate(raw: string): string {
  const value = cleanBuyerRefundIdentifier(raw, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new BuyerRefundError('VALIDATION_ERROR', 400);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw new BuyerRefundError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function cleanBuyerRefundPaymentChannel(
  value: unknown,
): BuyerRefundPaymentChannel {
  if (!isBuyerRefundPaymentChannel(value)) {
    throw new BuyerRefundError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function cleanOptionalBuyerRefundText(
  raw: string | null | undefined,
  maximum: number,
): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') {
    throw new BuyerRefundError('VALIDATION_ERROR', 400);
  }
  const normalized = raw.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  if (!safeText(normalized, maximum)) {
    throw new BuyerRefundError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function normalizeBuyerRefundProofFiles(
  files: readonly BuyerRefundProofFileInput[],
): readonly BuyerRefundProofFileInput[] {
  if (!Array.isArray(files) || files.length < 1 || files.length > 10) {
    throw new BuyerRefundError('VALIDATION_ERROR', 400);
  }
  const seen = new Set<string>();
  const normalized = files.map((file) => {
    const fileObjectId = cleanBuyerRefundIdentifier(file.fileObjectId);
    const expectedFileVersion = cleanBuyerRefundExpectedVersion(
      file.expectedFileVersion,
    );
    if (seen.has(fileObjectId)) {
      throw new BuyerRefundError('BUYER_REFUND_FILE_CONFLICT', 409);
    }
    seen.add(fileObjectId);
    return Object.freeze({ fileObjectId, expectedFileVersion });
  });
  return Object.freeze(normalized);
}

export function buyerRefundStatusFromAmounts(
  dueAmountCnyFen: number,
  netPaidCnyFen: number,
): BuyerRefundStatus {
  cleanBuyerRefundAmount(dueAmountCnyFen, { allowZero: true });
  cleanBuyerRefundAmount(netPaidCnyFen, { allowZero: true });
  if (netPaidCnyFen === 0) return 'DUE';
  if (netPaidCnyFen < dueAmountCnyFen) return 'PARTIALLY_PAID';
  if (netPaidCnyFen === dueAmountCnyFen) return 'PAID';
  return 'OVERPAID';
}

export function assertPreviousBuyerRefundStatementChangedOnce(
  database: SqlDatabase,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
  `);
}

export function normalizeBuyerRefundError(error: unknown): BuyerRefundError {
  if (error instanceof BuyerRefundError) return error;
  const record = error as { code?: unknown };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new BuyerRefundError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new BuyerRefundError('REQUEST_IN_PROGRESS', 409);
  }
  if (record?.code === 'VERSION_CONFLICT') {
    return new BuyerRefundError('VERSION_CONFLICT', 409);
  }
  if (record?.code === 'FILE_OBJECT_NOT_FOUND'
    || record?.code === 'NOT_FOUND') {
    return new BuyerRefundError('FILE_OBJECT_NOT_FOUND', 404);
  }
  if (record?.code === 'FILE_NOT_VERIFIED') {
    return new BuyerRefundError('FILE_NOT_VERIFIED', 409);
  }
  if (record?.code === 'FILE_STORAGE_CONFLICT') {
    return new BuyerRefundError('BUYER_REFUND_FILE_CONFLICT', 409);
  }
  if (record?.code === 'FORBIDDEN') {
    return new BuyerRefundError('FORBIDDEN', 403);
  }
  if (record?.code === 'VALIDATION_ERROR') {
    return new BuyerRefundError('VALIDATION_ERROR', 400);
  }

  const message = String(error);
  if (message.includes('buyer_refund_reversal_exceeds_payment')) {
    return new BuyerRefundError(
      'BUYER_REFUND_REVERSAL_EXCEEDS_PAYMENT',
      409,
    );
  }
  if (message.includes(
    'UNIQUE constraint failed: buyer_refund_obligations.source_review_event_id',
  ) || message.includes(
    'UNIQUE constraint failed: buyer_refund_obligations.formal_order_id',
  )) {
    return new BuyerRefundError('BUYER_REFUND_ALREADY_EXISTS', 409);
  }
  if (message.includes('buyer_refund_payment_file_authority_mismatch')
    || message.includes('UNIQUE constraint failed: buyer_refund_payment_entry_files')
    || message.includes('UNIQUE constraint failed: file_entity_links')) {
    return new BuyerRefundError('BUYER_REFUND_FILE_CONFLICT', 409);
  }
  if (message.includes('buyer_refund_obligation_source_mismatch')
    || message.includes('buyer_refund_obligation_invalid_update')
    || message.includes('buyer_refund_payment_entry_source_mismatch')
    || message.includes('buyer_refund_event_identity_mismatch')
    || message.includes('buyer_refund_obligations_are_immutable')
    || message.includes('buyer_refund_payment_entries_are_immutable')
    || message.includes('buyer_refund_payment_entry_files_are_immutable')
    || message.includes('buyer_refund_events_are_immutable')
    || message.includes('FOREIGN KEY constraint failed')) {
    return new BuyerRefundError('BUYER_REFUND_STATE_CONFLICT', 409);
  }
  if (message.includes('transaction_assertion_failed')) {
    return new BuyerRefundError('VERSION_CONFLICT', 409);
  }
  return new BuyerRefundError('DEPENDENCY_UNAVAILABLE', 503);
}

export function fixedIntegerString(value: number): `${number}` {
  cleanBuyerRefundAmount(value, { allowZero: true });
  return String(value) as `${number}`;
}

function validateBuyerRefundStaffActor(actor: BuyerRefundStaffActor): void {
  if (!actor
    || !safeText(actor.staffId, 120)
    || !safeText(actor.displayName, 100)
    || !Array.isArray(actor.roles)
    || actor.roles.length < 1
    || typeof actor.permissions?.has !== 'function') {
    throw new BuyerRefundError('VALIDATION_ERROR', 400);
  }
}

function safeText(value: string, maximum: number): boolean {
  return value.length >= 1
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}
