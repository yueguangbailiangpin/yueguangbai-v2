import type {
  ApiErrorCode,
  StaffPermissionCode,
} from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

export class InternalFinanceError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 503,
  ) {
    super(code);
    this.name = 'InternalFinanceError';
  }
}

export function requireFinancialActor(
  value: AssignmentStaffAuthorization | null | undefined,
  options: { export?: boolean } = {},
): AssignmentStaffAuthorization {
  if (!value || value.staffStatus !== 'ACTIVE') {
    throw new InternalFinanceError('UNAUTHENTICATED', 401);
  }
  requireOwnerPermission(value, 'FINANCIAL_VIEW');
  if (options.export) requireOwnerPermission(value, 'FINANCIAL_EXPORT');
  return value;
}

function requireOwnerPermission(
  actor: AssignmentStaffAuthorization,
  permission: StaffPermissionCode,
): void {
  if (!actor.roles.has('owner') || !actor.permissions.has(permission)) {
    throw new InternalFinanceError('FORBIDDEN', 403);
  }
}

export function financeIdentifier(value: string | undefined): string {
  if (typeof value !== 'string') return validation();
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return validation();
  }
  return normalized;
}

export function validation(): never {
  throw new InternalFinanceError('VALIDATION_ERROR', 400);
}
