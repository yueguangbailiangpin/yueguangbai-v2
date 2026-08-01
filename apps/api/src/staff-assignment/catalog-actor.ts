import type {
  SqlDatabase,
  StaffDataScope,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import type { CatalogStaffActor } from '../catalog/catalog-shared';
import { requireSellerOrganizationScope, resolveStaffDataScope } from './data-scope';
import { resolveAssignmentStaffAuthorization } from './effective-authorization';
import { StaffAssignmentError } from './errors';

/**
 * Builds the Catalog actor from persisted Staff facts. Request JSON and headers
 * are never accepted as scope authority.
 */
export async function resolveScopedCatalogStaffActor(
  database: SqlDatabase,
  input: {
    staffId: string;
    requiredPermission: StaffPermissionCode;
  },
): Promise<CatalogStaffActor & { dataScope: StaffDataScope }> {
  const authorization = await resolveAssignmentStaffAuthorization(
    database,
    input.staffId,
  );
  if (!authorization
    || !authorization.permissions.has(input.requiredPermission)) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
  const dataScope = await resolveStaffDataScope(database, authorization, {
    requiredPermission: input.requiredPermission,
  });
  return Object.freeze({
    staffId: authorization.staffId,
    displayName: authorization.displayName,
    roles: Object.freeze([...authorization.roles]) as readonly StaffRoleCode[],
    permissions: authorization.permissions,
    dataScope,
  });
}

export function requireCatalogOrganizationScope(
  actor: CatalogStaffActor & { dataScope?: StaffDataScope },
  sellerOrganizationId: string,
): void {
  if (!actor.dataScope) throw new StaffAssignmentError('FORBIDDEN', 403);
  requireSellerOrganizationScope(actor.dataScope, sellerOrganizationId);
}
