import type {
  SqlDatabase,
  StaffDataScope,
  StaffPermissionCode,
} from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from './effective-authorization';
import { StaffAssignmentError } from './errors';

interface IdRow { id: string }

export async function resolveStaffDataScope(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  options: {
    requiredPermission?: StaffPermissionCode;
  } = {},
): Promise<StaffDataScope> {
  if (options.requiredPermission
    && !actor.permissions.has(options.requiredPermission)) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
  if (actor.roles.has('owner')) {
    return {
      type: 'GLOBAL',
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
    };
  }
  const teamIds = actor.permissions.has('TASK_VIEW_TEAM')
    ? actor.leaderTeamIds
    : [];
  const [buyers, sellers] = await Promise.all([
    database.prepare(`
      SELECT buyer_customer_id AS id
      FROM buyer_staff_assignments
      WHERE staff_id=? AND status='ACTIVE'
      UNION
      SELECT buyer_customer_id AS id
      FROM staff_work_items
      WHERE assigned_staff_id=? AND status='OPEN'
        AND buyer_customer_id IS NOT NULL
      UNION
      SELECT assignment.buyer_customer_id AS id
      FROM buyer_staff_assignments assignment
      JOIN staff_team_memberships membership
        ON membership.staff_id=assignment.staff_id
        AND membership.status='ACTIVE'
      JOIN staff_teams team ON team.id=membership.team_id AND team.status='ACTIVE'
      JOIN staff_departments department
        ON department.id=team.department_id AND department.status='ACTIVE'
      WHERE assignment.status='ACTIVE'
        AND membership.team_id IN (${placeholders(teamIds)})
      UNION
      SELECT item.buyer_customer_id AS id
      FROM staff_work_items item
      JOIN staff_team_memberships membership
        ON membership.staff_id=item.assigned_staff_id
        AND membership.status='ACTIVE'
      JOIN staff_teams team ON team.id=membership.team_id AND team.status='ACTIVE'
      JOIN staff_departments department
        ON department.id=team.department_id AND department.status='ACTIVE'
      WHERE item.status='OPEN' AND item.buyer_customer_id IS NOT NULL
        AND membership.team_id IN (${placeholders(teamIds)})
    `).bind(
      actor.staffId,
      actor.staffId,
      ...teamIds,
      ...teamIds,
    ).all<IdRow>(),
    database.prepare(`
      SELECT seller_organization_id AS id
      FROM seller_staff_assignments
      WHERE staff_id=? AND status='ACTIVE'
      UNION
      SELECT seller_organization_id AS id
      FROM staff_work_items
      WHERE assigned_staff_id=? AND status='OPEN'
        AND seller_organization_id IS NOT NULL
      UNION
      SELECT assignment.seller_organization_id AS id
      FROM seller_staff_assignments assignment
      JOIN staff_team_memberships membership
        ON membership.staff_id=assignment.staff_id
        AND membership.status='ACTIVE'
      JOIN staff_teams team ON team.id=membership.team_id AND team.status='ACTIVE'
      JOIN staff_departments department
        ON department.id=team.department_id AND department.status='ACTIVE'
      WHERE assignment.status='ACTIVE'
        AND membership.team_id IN (${placeholders(teamIds)})
      UNION
      SELECT item.seller_organization_id AS id
      FROM staff_work_items item
      JOIN staff_team_memberships membership
        ON membership.staff_id=item.assigned_staff_id
        AND membership.status='ACTIVE'
      JOIN staff_teams team ON team.id=membership.team_id AND team.status='ACTIVE'
      JOIN staff_departments department
        ON department.id=team.department_id AND department.status='ACTIVE'
      WHERE item.status='OPEN' AND item.seller_organization_id IS NOT NULL
        AND membership.team_id IN (${placeholders(teamIds)})
    `).bind(
      actor.staffId,
      actor.staffId,
      ...teamIds,
      ...teamIds,
    ).all<IdRow>(),
  ]);
  return {
    type: teamIds.length > 0
      ? 'TEAM_ASSIGNMENTS'
      : buyers.results.length > 0
        ? 'ASSIGNED_BUYERS'
        : 'ASSIGNED_SELLER_ORGANIZATIONS',
    buyerCustomerIds: uniqueSorted(buyers.results.map((row) => row.id)),
    sellerOrganizationIds: uniqueSorted(sellers.results.map((row) => row.id)),
    teamIds: [...teamIds].sort(),
  };
}

export function scopeAllowsBuyer(
  scope: StaffDataScope,
  buyerCustomerId: string,
): boolean {
  return scope.type === 'GLOBAL'
    || scope.buyerCustomerIds.includes(buyerCustomerId);
}

export function scopeAllowsSellerOrganization(
  scope: StaffDataScope,
  sellerOrganizationId: string,
): boolean {
  return scope.type === 'GLOBAL'
    || scope.sellerOrganizationIds.includes(sellerOrganizationId);
}

export function requireBuyerScope(
  scope: StaffDataScope,
  buyerCustomerId: string,
): void {
  if (!scopeAllowsBuyer(scope, buyerCustomerId)) {
    throw new StaffAssignmentError('NOT_FOUND', 404);
  }
}

export function requireSellerOrganizationScope(
  scope: StaffDataScope,
  sellerOrganizationId: string,
): void {
  if (!scopeAllowsSellerOrganization(scope, sellerOrganizationId)) {
    throw new StaffAssignmentError('NOT_FOUND', 404);
  }
}

function placeholders(values: readonly string[]): string {
  return values.length > 0 ? values.map(() => '?').join(', ') : "''";
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
