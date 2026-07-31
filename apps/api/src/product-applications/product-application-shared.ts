import type {
  ProductVersionFields,
  SellerMemberRole,
  SqlDatabase,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  canonicalJson,
} from '@ygb/domain';

export interface SellerProductApplicationActor {
  memberId: string;
  sellerOrganizationId: string;
  role: SellerMemberRole;
  storeIds: readonly string[];
  allActiveStores: boolean;
  canManageProducts: boolean;
}

export interface ProductApplicationStaffActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
}

export class ProductApplicationError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'STORE_NOT_FOUND'
      | 'DUPLICATE_PRODUCT'
      | 'ASIN_STORE_CONFLICT'
      | 'PRODUCT_APPLICATION_NOT_FOUND'
      | 'PRODUCT_APPLICATION_ALREADY_REVIEWED'
      | 'PRODUCT_APPLICATION_CONFLICT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'ProductApplicationError';
  }
}

export function requireSellerCanSubmitProducts(
  actor: SellerProductApplicationActor,
): void {
  if (!actor.canManageProducts
    || (
      actor.role !== 'OWNER'
      && actor.role !== 'OPERATIONS'
    )) {
    throw new ProductApplicationError('FORBIDDEN', 403);
  }
}

export function requireProductReviewPermission(
  actor: ProductApplicationStaffActor,
): void {
  if (!actor.permissions.has('PRODUCT_REVIEW')) {
    throw new ProductApplicationError('FORBIDDEN', 403);
  }
}

export function sellerCanAccessStore(
  actor: SellerProductApplicationActor,
  storeId: string,
): boolean {
  return actor.allActiveStores
    || actor.storeIds.includes(storeId);
}

export function cleanApplicationIdentifier(
  value: string,
  maximum = 120,
): string {
  if (typeof value !== 'string') {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }
  return normalized;
}

export function cleanOptionalSellerNotes(
  value: string | null,
): string | null {
  if (value === null) return null;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  if (normalized.length > 2000
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }
  return normalized;
}

export function cleanReviewReason(
  value: string | null | undefined,
): string {
  if (typeof value !== 'string') {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > 1000
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }
  return normalized;
}

export function parseApplicationProductFields(
  parser: () => ProductVersionFields,
): ProductVersionFields {
  try {
    return parser();
  } catch {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }
}

export function insertProductApplicationEventStatement(
  database: SqlDatabase,
  input: {
    applicationId: string;
    organizationId: string;
    storeId: string;
    eventType:
      | 'PRODUCT_APPLICATION_SUBMITTED'
      | 'PRODUCT_APPLICATION_APPROVED'
      | 'PRODUCT_APPLICATION_REJECTED'
      | 'PRODUCT_APPLICATION_WITHDRAWN';
    actorType: 'STAFF' | 'SELLER_MEMBER';
    actorId: string;
    previousStatus: string | null;
    nextStatus:
      | 'SUBMITTED'
      | 'APPROVED'
      | 'REJECTED'
      | 'WITHDRAWN';
    applicationVersion: number;
    productId?: string | null;
    reason?: string | null;
    idempotencyKey: string;
    createdAt: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO product_application_events (
      id,
      application_id,
      organization_id,
      store_id,
      event_type,
      actor_type,
      actor_id,
      previous_status,
      next_status,
      application_version,
      product_id,
      reason,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.applicationId,
    input.organizationId,
    input.storeId,
    input.eventType,
    input.actorType,
    input.actorId,
    input.previousStatus,
    input.nextStatus,
    input.applicationVersion,
    input.productId ?? null,
    input.reason ?? null,
    input.idempotencyKey,
    input.createdAt,
  );
}

export function productVersionSnapshot(
  version: ProductVersionFields,
): {
  product_name: string;
  search_keywords_json: string;
  product_url: string | null;
  buyer_visible_notes: string | null;
  internal_notes: string | null;
} {
  return {
    product_name: version.productName,
    search_keywords_json: canonicalJson(
      version.searchKeywords,
    ),
    product_url: version.productUrl,
    buyer_visible_notes: version.buyerVisibleNotes,
    internal_notes: version.internalNotes,
  };
}

export function normalizeProductApplicationError(
  error: unknown,
): ProductApplicationError {
  if (error instanceof ProductApplicationError) return error;

  const record = error as {
    code?: unknown;
  };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new ProductApplicationError(
      'IDEMPOTENCY_CONFLICT',
      409,
    );
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new ProductApplicationError(
      'REQUEST_IN_PROGRESS',
      409,
    );
  }

  const message = String(error);
  if (message.includes(
    'product_applications.marketplace_code, '
      + 'product_applications.asin_normalized',
  )) {
    return new ProductApplicationError(
      'PRODUCT_APPLICATION_CONFLICT',
      409,
    );
  }
  if (message.includes(
    'products.marketplace_code, products.asin_normalized',
  )) {
    return new ProductApplicationError(
      'ASIN_STORE_CONFLICT',
      409,
    );
  }
  if (message.includes(
    'product_versions.product_id, product_versions.version_no',
  )
    || message.includes('transaction_assertion_failed')) {
    return new ProductApplicationError(
      'VERSION_CONFLICT',
      409,
    );
  }
  return new ProductApplicationError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}
