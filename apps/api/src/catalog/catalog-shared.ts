import type {
  StaffDataScope,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';

export interface CatalogStaffActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
  dataScope?: StaffDataScope;
}

export class CatalogError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'DUPLICATE_STORE'
      | 'STORE_NOT_FOUND'
      | 'PRODUCT_NOT_FOUND'
      | 'DUPLICATE_PRODUCT'
      | 'ASIN_STORE_CONFLICT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'CatalogError';
  }
}

export function requireCatalogPermission(
  actor: CatalogStaffActor,
  permission: StaffPermissionCode,
): void {
  if (!actor.permissions.has(permission)) {
    throw new CatalogError('FORBIDDEN', 403);
  }
}

export function parseCatalogInput<T>(
  parser: () => T,
): T {
  try {
    return parser();
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError('VALIDATION_ERROR', 400);
  }
}

export function cleanCatalogIdentifier(
  value: string,
  maximum = 120,
): string {
  if (typeof value !== 'string') {
    throw new CatalogError('VALIDATION_ERROR', 400);
  }
  const cleaned = value.normalize('NFKC').trim();
  if (cleaned.length < 1
    || cleaned.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(cleaned)) {
    throw new CatalogError('VALIDATION_ERROR', 400);
  }
  return cleaned;
}

export function normalizeCatalogError(
  error: unknown,
): CatalogError {
  if (error instanceof CatalogError) return error;

  const record = error as {
    code?: unknown;
  };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new CatalogError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new CatalogError('REQUEST_IN_PROGRESS', 409);
  }

  const message = String(error);
  if (message.includes(
    'seller_stores.organization_id, '
      + 'seller_stores.marketplace_code, '
      + 'seller_stores.normalized_name',
  )) {
    return new CatalogError('DUPLICATE_STORE', 409);
  }
  if (message.includes(
    'products.marketplace_code, products.asin_normalized',
  )) {
    return new CatalogError('ASIN_STORE_CONFLICT', 409);
  }
  if (message.includes(
    'product_versions.product_id, product_versions.version_no',
  )) {
    return new CatalogError('VERSION_CONFLICT', 409);
  }
  if (message.includes('transaction_assertion_failed')) {
    return new CatalogError('VERSION_CONFLICT', 409);
  }
  return new CatalogError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}
