import type {
  DemandTaskType,
  MarketplaceCode,
  SellerMemberRole,
  SqlDatabase,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  isDemandTaskType,
} from '@ygb/contracts';

export interface SellerDemandActor {
  memberId: string;
  sellerOrganizationId: string;
  role: SellerMemberRole;
  storeIds: readonly string[];
  allActiveStores: boolean;
  canManageProducts: boolean;
}

export interface DemandStaffActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
}

export interface BuyerDemandContext {
  buyerCustomerId: string;
  marketplaceCode: MarketplaceCode;
  accessStatus: 'ACTIVE' | 'DISABLED';
  identityReviewStatus: 'CLEAR' | 'REVIEW_REQUIRED';
}

/** Safe, field-scoped failure detail exposed through the API error envelope. */
export interface DemandBatchErrorDetail {
  readonly field: string;
  readonly reason?: string;
}

export class DemandBatchError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'PRODUCT_NOT_FOUND'
      | 'DEMAND_BATCH_NOT_FOUND'
      | 'DEMAND_BATCH_ALREADY_REVIEWED'
      | 'DEMAND_BATCH_NOT_PUBLISHED'
      | 'DEMAND_BATCH_EXPIRED'
      | 'SCHEDULE_WINDOW_CONFLICT'
      | 'CUSTOMER_NOT_ACTIVE'
      | 'IDENTITY_REVIEW_REQUIRED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
    public readonly details: DemandBatchErrorDetail | null = null,
  ) {
    super(code);
    this.name = 'DemandBatchError';
  }
}

export function requireSellerDemandPermission(
  actor: SellerDemandActor,
): void {
  if (!actor.canManageProducts
    || (
      actor.role !== 'OWNER'
      && actor.role !== 'OPERATIONS'
    )) {
    throw new DemandBatchError('FORBIDDEN', 403);
  }
}

export function requireDemandPublishPermission(
  actor: {
    roles: Iterable<StaffRoleCode>;
    permissions: ReadonlySet<StaffPermissionCode>;
  },
): void {
  if (!actor.permissions.has('DEMAND_PUBLISH')
    || ![...actor.roles].some((role) => role === 'owner' || role === 'seller_ops')) {
    throw new DemandBatchError('FORBIDDEN', 403);
  }
}

export function canPublishInitialDemandSchedule(
  actor: {
    roles: Iterable<StaffRoleCode>;
    permissions: ReadonlySet<StaffPermissionCode>;
  },
): boolean {
  return actor.permissions.has('PRODUCT_REVIEW')
    && actor.permissions.has('DEMAND_PUBLISH')
    && [...actor.roles].some((role) => role === 'owner' || role === 'seller_ops');
}

export function requireInitialDemandSchedulePermission(
  actor: {
    roles: Iterable<StaffRoleCode>;
    permissions: ReadonlySet<StaffPermissionCode>;
  },
): void {
  if (!canPublishInitialDemandSchedule(actor)) {
    throw new DemandBatchError('FORBIDDEN', 403);
  }
}

export function sellerCanAccessDemandStore(
  actor: SellerDemandActor,
  storeId: string,
): boolean {
  return actor.allActiveStores
    || actor.storeIds.includes(storeId);
}

export function cleanDemandIdentifier(
  value: string,
  maximum = 120,
): string {
  if (typeof value !== 'string') {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanDemandOptionalNotes(
  value: string | null,
  maximum: number,
): string | null {
  if (value === null) return null;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanDemandReason(
  value: string | null | undefined,
): string {
  if (typeof value !== 'string') {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > 1000
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function parseDemandTaskType(
  value: unknown,
): DemandTaskType {
  if (!isDemandTaskType(value)) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function validateDemandSchedule(input: {
  openAt: number;
  reservationDeadline: number;
  orderDeadline: number;
}): void {
  if (!Number.isSafeInteger(input.openAt)
    || input.openAt < 0
    || !Number.isSafeInteger(input.reservationDeadline)
    || input.reservationDeadline <= input.openAt
    || !Number.isSafeInteger(input.orderDeadline)
    || input.orderDeadline <= input.reservationDeadline) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
}

export function validateTargetQuantity(
  value: number,
): number {
  if (!Number.isSafeInteger(value)
    || value < 1
    || value > 100000) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function insertDemandBatchEventStatement(
  database: SqlDatabase,
  input: {
    demandBatchId: string;
    organizationId: string;
    storeId: string;
    productId: string;
    eventType:
      | 'DEMAND_BATCH_SUBMITTED'
      | 'DEMAND_BATCH_PUBLISHED'
      | 'DEMAND_BATCH_REJECTED'
      | 'DEMAND_BATCH_WITHDRAWN'
      | 'DEMAND_BATCH_CLOSED';
    actorType: 'STAFF' | 'SELLER_MEMBER';
    actorId: string;
    previousStatus: string | null;
    nextStatus:
      | 'SUBMITTED'
      | 'PUBLISHED'
      | 'REJECTED'
      | 'WITHDRAWN'
      | 'CLOSED';
    demandVersion: number;
    reason?: string | null;
    idempotencyKey: string;
    createdAt: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO demand_batch_events (
      id,
      demand_batch_id,
      organization_id,
      store_id,
      product_id,
      event_type,
      actor_type,
      actor_id,
      previous_status,
      next_status,
      demand_version,
      reason,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.demandBatchId,
    input.organizationId,
    input.storeId,
    input.productId,
    input.eventType,
    input.actorType,
    input.actorId,
    input.previousStatus,
    input.nextStatus,
    input.demandVersion,
    input.reason ?? null,
    input.idempotencyKey,
    input.createdAt,
  );
}

export function demandAuditState(input: {
  status: string;
  version: number;
  taskType: DemandTaskType;
  targetQuantity: number;
  openAt: number;
  reservationDeadline: number;
  orderDeadline: number;
}): Record<string, unknown> {
  return {
    status: input.status,
    version: input.version,
    task_type: input.taskType,
    target_quantity: input.targetQuantity,
    open_at: input.openAt,
    reservation_deadline: input.reservationDeadline,
    order_deadline: input.orderDeadline,
  };
}

export function normalizeDemandBatchError(
  error: unknown,
): DemandBatchError {
  if (error instanceof DemandBatchError) return error;

  const record = error as {
    code?: unknown;
  };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new DemandBatchError(
      'IDEMPOTENCY_CONFLICT',
      409,
    );
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new DemandBatchError(
      'REQUEST_IN_PROGRESS',
      409,
    );
  }
  if (record?.code === 'VALIDATION_ERROR') {
    return new DemandBatchError('VALIDATION_ERROR', 400);
  }
  if (record?.code === 'FORBIDDEN') {
    return new DemandBatchError('FORBIDDEN', 403);
  }
  if (record?.code === 'NOT_FOUND') {
    return new DemandBatchError('NOT_FOUND', 404);
  }
  if (record?.code === 'ORDERING_PROFILE_REQUIRED') {
    return new DemandBatchError('VALIDATION_ERROR', 409);
  }

  const message = String(error);
  if (message.includes('transaction_assertion_failed')) {
    return new DemandBatchError('VERSION_CONFLICT', 409);
  }
  return new DemandBatchError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}
