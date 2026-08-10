import type {
  SqlDatabase,
  StaffDataScope,
  StaffPermissionCode,
} from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from './effective-authorization';
import { StaffAssignmentError } from './errors';

interface IdRow { id: string }
interface MarketplaceRow { marketplace_code: string }

export async function resolveStaffMarketplaceCodes(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
): Promise<readonly string[]> {
  if (actor.roles.has('owner')) return [];
  const role = [...actor.roles][0];
  const rows = await database.prepare(`
    SELECT marketplace_code
    FROM staff_marketplace_scopes
    WHERE staff_id=? AND role_code=? AND status='ACTIVE'
    ORDER BY marketplace_code
  `).bind(actor.staffId, role).all<MarketplaceRow>();
  return Object.freeze(rows.results.map((row) => row.marketplace_code));
}

export async function resolveStaffDataScope(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  options: { requiredPermission?: StaffPermissionCode } = {},
): Promise<StaffDataScope> {
  if (options.requiredPermission && !actor.permissions.has(options.requiredPermission)) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
  if (actor.roles.has('owner')) {
    return {
      type: 'GLOBAL', marketplaceCodes: [], buyerCustomerIds: [],
      sellerOrganizationIds: [], teamIds: [],
    };
  }

  const marketplaceCodes = await resolveStaffMarketplaceCodes(database, actor);
  if (marketplaceCodes.length === 0) {
    return {
      type: 'MARKETPLACE', marketplaceCodes: [], buyerCustomerIds: [],
      sellerOrganizationIds: [], teamIds: [],
    };
  }
  const placeholders = marketplaceCodes.map(() => '?').join(',');
  const role = [...actor.roles][0];
  const maySeeBuyers = role === 'pre_sales' || role === 'buyer_refund';
  const maySeeSellers = role === 'seller_ops';
  const [buyers, sellers] = await Promise.all([
    maySeeBuyers
      ? database.prepare(`
          SELECT buyer_customer_id AS id
          FROM buyer_marketplace_assignments
          WHERE marketplace_code IN (${placeholders})
          ORDER BY buyer_customer_id
        `).bind(...marketplaceCodes).all<IdRow>()
      : Promise.resolve({ results: [] as IdRow[] }),
    maySeeSellers
      ? database.prepare(`
          SELECT DISTINCT seller_organization_id AS id
          FROM seller_store_marketplaces
          WHERE marketplace_code IN (${placeholders})
          ORDER BY seller_organization_id
        `).bind(...marketplaceCodes).all<IdRow>()
      : Promise.resolve({ results: [] as IdRow[] }),
  ]);

  return {
    type: 'MARKETPLACE',
    marketplaceCodes: [...marketplaceCodes],
    buyerCustomerIds: uniqueSorted(buyers.results.map((row) => row.id)),
    sellerOrganizationIds: uniqueSorted(sellers.results.map((row) => row.id)),
    teamIds: [],
  };
}

export function scopeAllowsMarketplace(scope: StaffDataScope, marketplaceCode: string): boolean {
  return scope.type === 'GLOBAL' || scope.marketplaceCodes.includes(marketplaceCode);
}

export function scopeAllowsBuyer(scope: StaffDataScope, buyerCustomerId: string): boolean {
  return scope.type === 'GLOBAL' || scope.buyerCustomerIds.includes(buyerCustomerId);
}

export function scopeAllowsSellerOrganization(scope: StaffDataScope, sellerOrganizationId: string): boolean {
  return scope.type === 'GLOBAL' || scope.sellerOrganizationIds.includes(sellerOrganizationId);
}

export function requireMarketplaceScope(scope: StaffDataScope, marketplaceCode: string): void {
  if (!scopeAllowsMarketplace(scope, marketplaceCode)) throw new StaffAssignmentError('NOT_FOUND', 404);
}
export function requireBuyerScope(scope: StaffDataScope, buyerCustomerId: string): void {
  if (!scopeAllowsBuyer(scope, buyerCustomerId)) throw new StaffAssignmentError('NOT_FOUND', 404);
}
export function requireSellerOrganizationScope(scope: StaffDataScope, sellerOrganizationId: string): void {
  if (!scopeAllowsSellerOrganization(scope, sellerOrganizationId)) throw new StaffAssignmentError('NOT_FOUND', 404);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
