import type {
  SqlDatabase,
  StaffDataScope,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import { addCalendarDays } from '@ygb/domain';
import {
  scopeAllowsSellerOrganization,
} from '../staff-assignment';

export interface SchedulingStaffActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
  dataScope: StaffDataScope;
}

export class SchedulingError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'SCHEDULE_WINDOW_CONFLICT'
      | 'SCHEDULE_PREVIEW_STALE'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'SchedulingError';
  }
}

export function requireScheduleView(actor: SchedulingStaffActor): void {
  if (!actor.permissions.has('PRODUCT_VIEW')) {
    throw new SchedulingError('FORBIDDEN', 403);
  }
}

export function requireScheduleEdit(actor: SchedulingStaffActor): void {
  if (!actor.permissions.has('PRODUCT_REVIEW')
    || !actor.permissions.has('DEMAND_PUBLISH')
    || !actor.roles.some((role) => role === 'owner' || role === 'seller_ops')) {
    throw new SchedulingError('FORBIDDEN', 403);
  }
}

export function requireSellerScheduleScope(
  actor: SchedulingStaffActor,
  sellerOrganizationId: string,
): void {
  if (!scopeAllowsSellerOrganization(actor.dataScope, sellerOrganizationId)) {
    throw new SchedulingError('NOT_FOUND', 404);
  }
}

export async function canViewProduct(
  database: SqlDatabase,
  actor: SchedulingStaffActor,
  productId: string,
  sellerOrganizationId: string,
): Promise<boolean> {
  if (scopeAllowsSellerOrganization(actor.dataScope, sellerOrganizationId)) {
    return true;
  }
  return hasScopedBuyerReservation(database, actor.dataScope, {
    productId,
  });
}

export async function canViewDemand(
  database: SqlDatabase,
  actor: SchedulingStaffActor,
  demandBatchId: string,
  sellerOrganizationId: string,
): Promise<boolean> {
  if (scopeAllowsSellerOrganization(actor.dataScope, sellerOrganizationId)) {
    return true;
  }
  return hasScopedBuyerReservation(database, actor.dataScope, {
    demandBatchId,
  });
}

async function hasScopedBuyerReservation(
  database: SqlDatabase,
  scope: StaffDataScope,
  target: { productId: string } | { demandBatchId: string },
): Promise<boolean> {
  if (scope.type === 'GLOBAL') return true;
  if (scope.buyerCustomerIds.length < 1) return false;
  const byProduct = 'productId' in target;
  const row = await database.prepare(`
    SELECT 1 AS found
    FROM product_reservations
    WHERE ${byProduct ? 'product_id' : 'demand_batch_id'}=?
      AND buyer_customer_id IN (${placeholders(scope.buyerCustomerIds)})
    LIMIT 1
  `).bind(
    byProduct ? target.productId : target.demandBatchId,
    ...scope.buyerCustomerIds,
  ).first<{ found: number }>();
  return row?.found === 1;
}

export function cleanScheduleIdentifier(value: string): string {
  if (typeof value !== 'string') return validationError();
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 120
    || /[\u0000-\u001f\u007f]/u.test(normalized)) return validationError();
  return normalized;
}

export function cleanScheduleReason(value: unknown): string {
  if (typeof value !== 'string') return validationError();
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 1000
    || /[\u0000-\u001f\u007f]/u.test(normalized)) return validationError();
  return normalized;
}

export function cleanDateOnly(value: unknown): string {
  if (typeof value !== 'string') return validationError();
  const normalized = value.normalize('NFKC').trim();
  try {
    if (addCalendarDays(normalized, 0) !== normalized) return validationError();
  } catch {
    return validationError();
  }
  return normalized;
}

export function positiveInteger(
  value: unknown,
  maximum = 100_000,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < 1 || value > maximum) return validationError();
  return value;
}

export function parsePageLimit(
  value: string | undefined,
  defaultValue: number,
  maximum: number,
): number {
  if (value === undefined) return defaultValue;
  if (!/^[1-9][0-9]*$/u.test(value)) return validationError();
  return positiveInteger(Number(value), maximum);
}

export interface ScheduleCursor {
  at: number;
  id: string;
}

export function encodeScheduleCursor(
  kind: 'product' | 'reservation',
  cursor: ScheduleCursor,
): string {
  const bytes = new TextEncoder().encode(JSON.stringify({
    v: 1, kind, at: cursor.at, id: cursor.id,
  }));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decodeScheduleCursor(
  kind: 'product' | 'reservation',
  value: string | undefined,
): ScheduleCursor | null {
  if (value === undefined) return null;
  if (value.length < 1 || value.length > 1000) return validationError();
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    ))) as Record<string, unknown>;
    if (parsed['v'] !== 1 || parsed['kind'] !== kind
      || !Number.isSafeInteger(parsed['at']) || Number(parsed['at']) < 0
      || typeof parsed['id'] !== 'string'
      || parsed['id'].length < 1 || parsed['id'].length > 120) {
      return validationError();
    }
    return { at: Number(parsed['at']), id: parsed['id'] };
  } catch {
    return validationError();
  }
}

export function normalizeSchedulingError(error: unknown): SchedulingError {
  if (error instanceof SchedulingError) return error;
  const code = (error as { code?: unknown })?.code;
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return new SchedulingError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (code === 'REQUEST_IN_PROGRESS') {
    return new SchedulingError('REQUEST_IN_PROGRESS', 409);
  }
  const message = String(error);
  if (message.includes('transaction_assertion_failed')) {
    return new SchedulingError('VERSION_CONFLICT', 409);
  }
  if (message.includes('demand_order_schedule_source_invalid')) {
    return new SchedulingError('VERSION_CONFLICT', 409);
  }
  return new SchedulingError('DEPENDENCY_UNAVAILABLE', 503);
}

export function placeholders(values: readonly unknown[]): string {
  return values.length > 0 ? values.map(() => '?').join(', ') : "''";
}

function validationError(): never {
  throw new SchedulingError('VALIDATION_ERROR', 400);
}
