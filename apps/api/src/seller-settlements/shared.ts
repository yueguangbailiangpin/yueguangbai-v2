import type {
  FileActor,
  FileEntityType,
  FilePurpose,
  FileVisibility,
  FixedIntegerString,
  StaffPermissionCode,
} from '@ygb/contracts';
import type { FileAuthorizationResource, FileAuthorizationService } from '../files/authorization';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

export type SellerSettlementErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'FILE_OBJECT_NOT_FOUND'
  | 'FILE_NOT_VERIFIED'
  | 'SELLER_SETTLEMENT_CONFLICT'
  | 'DEPENDENCY_UNAVAILABLE';

export class SellerSettlementError extends Error {
  constructor(
    public readonly code: SellerSettlementErrorCode,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'SellerSettlementError';
  }
}

export function requireSettlementPermission(
  actor: AssignmentStaffAuthorization,
  permission: StaffPermissionCode,
): void {
  if (actor.staffStatus !== 'ACTIVE' || !actor.permissions.has(permission)) {
    throw new SellerSettlementError('FORBIDDEN', 403);
  }
}

export function requireFinancialCorrectionPermissions(
  actor: AssignmentStaffAuthorization,
): void {
  requireSettlementPermission(actor, 'SELLER_SETTLEMENT_RECORD');
  requireSettlementPermission(actor, 'FINANCIAL_CORRECT');
}

export function cleanSettlementIdentifier(value: unknown): string {
  if (typeof value !== 'string') throw validation();
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) throw validation();
  return normalized;
}

export function cleanSettlementReason(value: unknown): string {
  const normalized = cleanSettlementIdentifier(value);
  if (normalized.length > 2000) throw validation();
  return normalized;
}

export function cleanSettlementTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw validation();
  return Number(value);
}

export function cleanSettlementVersion(value: unknown): number {
  const parsed = cleanSettlementTimestamp(value);
  if (parsed < 1) throw validation();
  return parsed;
}

export function cleanPositiveCnyFen(value: unknown): number {
  const parsed = parseIntegerString(value);
  if (parsed < 1n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw validation();
  return Number(parsed);
}

export function cleanNonNegativeCnyFen(value: unknown): number {
  const parsed = parseIntegerString(value);
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw validation();
  return Number(parsed);
}

export function fixedInteger(value: number | string | bigint): FixedIntegerString {
  const serialized = String(value);
  if (!/^(0|[1-9][0-9]*)$/u.test(serialized)) {
    throw new SellerSettlementError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return serialized;
}

export function normalizeSettlementError(error: unknown): SellerSettlementError {
  if (error instanceof SellerSettlementError) return error;
  const code = (error as { code?: unknown })?.code;
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return new SellerSettlementError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (code === 'REQUEST_IN_PROGRESS') {
    return new SellerSettlementError('REQUEST_IN_PROGRESS', 409);
  }
  if (code === 'FORBIDDEN') return new SellerSettlementError('FORBIDDEN', 403);
  if (code === 'NOT_FOUND') return new SellerSettlementError('NOT_FOUND', 404);
  const message = String(error);
  if (message.includes('transaction_assertion_failed')
    || message.includes('seller_payment_invalid_update')) {
    return new SellerSettlementError('VERSION_CONFLICT', 409);
  }
  if (message.includes('seller_payment_proof_authority_mismatch')
    || message.includes('seller_allocation_exceeds_available_balance')
    || message.includes('seller_allocation_reversal_exceeds_allocation')
    || message.includes('seller_payment_reversal_has_active_allocations')
    || message.includes('UNIQUE constraint failed')) {
    return new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new SellerSettlementError('NOT_FOUND', 404);
  }
  return new SellerSettlementError('DEPENDENCY_UNAVAILABLE', 503);
}

export class SellerSettlementFileAuthorization
implements FileAuthorizationService {
  assertCanCreateUpload(actor: FileActor, input: {
    purpose: FilePurpose;
    visibility: FileVisibility;
  }): void {
    if (actor.type !== 'STAFF'
      || input.purpose !== 'SELLER_SETTLEMENT_PROOF'
      || input.visibility !== 'INTERNAL_ONLY') throw new Error('FORBIDDEN');
  }
  assertCanUpload(actor: FileActor, resource: FileAuthorizationResource): void {
    this.assertOwner(actor, resource);
  }
  assertCanCompleteUpload(actor: FileActor, resource: FileAuthorizationResource): void {
    this.assertOwner(actor, resource);
  }
  assertCanLink(actor: FileActor, resource: FileAuthorizationResource): void {
    this.assertOwner(actor, resource);
    if (resource.purpose !== 'SELLER_SETTLEMENT_PROOF'
      || resource.visibility !== 'INTERNAL_ONLY') throw new Error('FORBIDDEN');
  }
  assertCanRead(): never {
    throw new Error('FORBIDDEN');
  }
  private assertOwner(actor: FileActor, resource: FileAuthorizationResource): void {
    if (actor.type !== 'STAFF'
      || resource.ownerActorType !== 'STAFF'
      || resource.ownerActorId !== actor.id) throw new Error('FORBIDDEN');
  }
}

export const sellerSettlementFileAuthorization =
  new SellerSettlementFileAuthorization();

function parseIntegerString(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw validation();
  }
  try {
    return BigInt(value);
  } catch {
    throw validation();
  }
}

function validation(): SellerSettlementError {
  return new SellerSettlementError('VALIDATION_ERROR', 400);
}

export function isSettlementEntityType(
  value: FileEntityType,
): value is 'SELLER_SETTLEMENT' {
  return value === 'SELLER_SETTLEMENT';
}