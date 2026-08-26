import type {
  ReservationStatus,
  MarketplaceCode,
  SqlDatabase,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  canonicalJson,
} from '@ygb/domain';

export interface BuyerReservationActor {
  buyerCustomerId: string;
  marketplaceCode: MarketplaceCode;
  accessStatus: 'ACTIVE' | 'DISABLED';
  identityReviewStatus: 'CLEAR' | 'REVIEW_REQUIRED';
}

export interface ReservationStaffActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
}

export class ReservationError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'DEMAND_BATCH_NOT_FOUND'
      | 'DEMAND_BATCH_NOT_PUBLISHED'
      | 'DEMAND_BATCH_EXPIRED'
      | 'RESERVATION_NOT_FOUND'
      | 'RESERVATION_ALREADY_EXISTS'
      | 'RESERVATION_ALREADY_DECIDED'
      | 'BUYER_STORE_RESERVATION_CONFLICT'
      | 'RESERVATION_HISTORY_PARTICIPATION'
      | 'CAPACITY_FULL'
      | 'CUSTOMER_NOT_ACTIVE'
      | 'IDENTITY_REVIEW_REQUIRED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'ReservationError';
  }
}

export function requireReservationDecisionPermission(
  actor: ReservationStaffActor,
): void {
  if (!actor.permissions.has('RESERVATION_DECIDE')) {
    throw new ReservationError('FORBIDDEN', 403);
  }
}

export function validateBuyerReservationActor(
  actor: BuyerReservationActor,
): void {
  if (actor.accessStatus !== 'ACTIVE') {
    throw new ReservationError(
      'CUSTOMER_NOT_ACTIVE',
      409,
    );
  }
  if (actor.identityReviewStatus !== 'CLEAR') {
    throw new ReservationError(
      'IDENTITY_REVIEW_REQUIRED',
      409,
    );
  }
}

export function cleanReservationIdentifier(
  value: string,
  maximum = 120,
): string {
  if (typeof value !== 'string') {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanReservationReason(
  value: string | null | undefined,
): string {
  if (typeof value !== 'string') {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > 1000
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function insertReservationEventStatement(
  database: SqlDatabase,
  input: {
    reservationId: string;
    demandBatchId: string;
    buyerCustomerId: string;
    eventType:
      | 'RESERVATION_SUBMITTED'
      | 'RESERVATION_APPROVED'
      | 'RESERVATION_REJECTED'
      | 'RESERVATION_CANCELLED'
      | 'RESERVATION_EXPIRED'
      | 'RESERVATION_REOPENED';
    actorType: 'BUYER_CUSTOMER' | 'STAFF' | 'SYSTEM';
    actorId: string;
    previousStatus: ReservationStatus | null;
    nextStatus: ReservationStatus;
    reservationVersion: number;
    reason?: string | null;
    idempotencyKey: string;
    createdAt: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO reservation_events (
      id,
      reservation_id,
      demand_batch_id,
      buyer_customer_id,
      event_type,
      actor_type,
      actor_id,
      previous_status,
      next_status,
      reservation_version,
      reason,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.reservationId,
    input.demandBatchId,
    input.buyerCustomerId,
    input.eventType,
    input.actorType,
    input.actorId,
    input.previousStatus,
    input.nextStatus,
    input.reservationVersion,
    input.reason ?? null,
    input.idempotencyKey,
    input.createdAt,
  );
}

export function reservationPrecheckSnapshot(input: {
  buyerCustomerId: string;
  marketplaceCode: 'AMAZON_JP';
  demandBatchId: string;
  productId: string;
  demandStatus: string;
  buyerAccessStatus: string;
  buyerIdentityReviewStatus: string;
  openAt: number;
  reservationDeadline: number;
  orderDeadline: number;
  targetQuantity: number;
  heldCount: number;
  approvedCount: number;
  checkedAt: number;
}): string {
  return canonicalJson({
    buyer_customer_id: input.buyerCustomerId,
    marketplace_code: input.marketplaceCode,
    demand_batch_id: input.demandBatchId,
    product_id: input.productId,
    demand_status: input.demandStatus,
    buyer_access_status: input.buyerAccessStatus,
    buyer_identity_review_status:
      input.buyerIdentityReviewStatus,
    open_at: input.openAt,
    reservation_deadline: input.reservationDeadline,
    order_deadline: input.orderDeadline,
    target_quantity: input.targetQuantity,
    held_count_before: input.heldCount,
    approved_count_before: input.approvedCount,
    checked_at: input.checkedAt,
  });
}

export function normalizeReservationError(
  error: unknown,
): ReservationError {
  if (error instanceof ReservationError) return error;

  const record = error as {
    code?: unknown;
  };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new ReservationError(
      'IDEMPOTENCY_CONFLICT',
      409,
    );
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new ReservationError(
      'REQUEST_IN_PROGRESS',
      409,
    );
  }
  if (record?.code === 'VERSION_CONFLICT') {
    return new ReservationError('VERSION_CONFLICT', 409);
  }
  if (record?.code === 'SELF_PAY_ACCEPTANCE_MISMATCH') {
    return new ReservationError('VERSION_CONFLICT', 409);
  }
  if (record?.code === 'VALIDATION_ERROR') {
    return new ReservationError('VALIDATION_ERROR', 400);
  }

  const message = String(error);
  if (message.includes(
    'product_reservations.demand_batch_id, '
      + 'product_reservations.buyer_customer_id',
  )) {
    return new ReservationError(
      'RESERVATION_ALREADY_EXISTS',
      409,
    );
  }
  if (message.includes('product_reservations.buyer_customer_id, '
    + 'product_reservations.store_id')
    || message.includes('product_reservations.buyer_customer_id, '
      + 'product_reservations.product_id')) {
    return new ReservationError(
      'BUYER_STORE_RESERVATION_CONFLICT',
      409,
    );
  }
  if (message.includes('demand_batch_capacity_exceeded')) {
    return new ReservationError('CAPACITY_FULL', 409);
  }
  if (message.includes('transaction_assertion_failed')) {
    return new ReservationError(
      'VERSION_CONFLICT',
      409,
    );
  }
  return new ReservationError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}
