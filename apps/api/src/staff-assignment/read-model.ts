import type {
  SqlDatabase,
  StaffAssignmentDto,
  StaffAssignmentDutyCode,
  StaffWorkItemDto,
  StaffWorkItemType,
} from '@ygb/contracts';
import {
  businessPermissionForWorkItem,
  eligibilityPermissionForDuty,
} from '@ygb/domain';
import type { AssignmentStaffAuthorization } from './effective-authorization';
import { StaffAssignmentError } from './errors';
import { isOwner } from './permission-policy';
import { representativeWorkType } from './reassignment-service';

const DUTIES: readonly StaffAssignmentDutyCode[] = [
  'SELLER_ACCOUNT_MANAGER',
  'BUYER_PRE_SALES_OWNER',
  'BUYER_AFTER_SALES_OWNER',
  'BUYER_REFUND_OWNER',
];
const WORK_TYPES: readonly StaffWorkItemType[] = [
  'PRODUCT_APPLICATION_REVIEW',
  'DEMAND_REVIEW',
  'RESERVATION_DECISION',
  'ORDER_EVIDENCE_REVIEW',
  'REVIEW_DECISION',
  'BUYER_REFUND_PROCESSING',
];

export async function listMyAssignments(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
): Promise<readonly StaffAssignmentDto[]> {
  const allowedDuties = DUTIES.filter((duty) =>
    actor.permissions.has(eligibilityPermissionForDuty(duty))
    && actor.permissions.has(
      businessPermissionForWorkItem(representativeWorkType(duty)),
    ));
  if (allowedDuties.length < 1) return [];
  const dutySql = placeholders(allowedDuties);
  const [buyer, seller] = await Promise.all([
    database.prepare(`
      SELECT id AS assignment_id, 'BUYER_CUSTOMER' AS subject_type,
        buyer_customer_id AS subject_id, duty_code, staff_id,
        status, source, reason, version, created_at, revoked_at
      FROM buyer_staff_assignments
      WHERE staff_id=? AND status='ACTIVE'
        AND duty_code IN (${dutySql})
      ORDER BY duty_code, buyer_customer_id
    `).bind(actor.staffId, ...allowedDuties).all<StaffAssignmentDto>(),
    database.prepare(`
      SELECT id AS assignment_id, 'SELLER_ORGANIZATION' AS subject_type,
        seller_organization_id AS subject_id, duty_code, staff_id,
        status, source, reason, version, created_at, revoked_at
      FROM seller_staff_assignments
      WHERE staff_id=? AND status='ACTIVE'
        AND duty_code IN (${dutySql})
      ORDER BY seller_organization_id
    `).bind(actor.staffId, ...allowedDuties).all<StaffAssignmentDto>(),
  ]);
  return [...buyer.results, ...seller.results];
}

export async function listVisibleWorkItems(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  options: { limit?: number; status?: 'OPEN' | 'COMPLETED' | 'CANCELLED' } = {},
): Promise<readonly StaffWorkItemDto[]> {
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  const allowedWorkTypes = visibleWorkTypes(actor);
  if (allowedWorkTypes.length < 1) return [];
  const status = options.status ?? 'OPEN';
  const visibilityScope = await visibility(database, actor);
  const rows = await database.prepare(`
    SELECT id AS work_item_id, work_type, source_entity_type,
      source_entity_id, buyer_customer_id, seller_organization_id,
      store_id, duty_code, fixed_assignment_id, assigned_staff_id,
      status, version, created_at, updated_at, completed_at, cancelled_at
    FROM staff_work_items
    WHERE status=?
      AND work_type IN (${placeholders(allowedWorkTypes)})
      AND (?=1 OR assigned_staff_id IN (${placeholders(visibilityScope.staffIds)}))
    ORDER BY created_at, id
    LIMIT ?
  `).bind(
    status,
    ...allowedWorkTypes,
    visibilityScope.global ? 1 : 0,
    ...visibilityScope.staffIds,
    limit,
  ).all<StaffWorkItemDto>();
  return rows.results;
}

export async function getVisibleWorkItem(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  workItemId: string,
): Promise<StaffWorkItemDto> {
  const allowedWorkTypes = visibleWorkTypes(actor);
  if (allowedWorkTypes.length < 1) {
    throw new StaffAssignmentError('NOT_FOUND', 404);
  }
  const scope = await visibility(database, actor);
  const row = await database.prepare(`
    SELECT id AS work_item_id, work_type, source_entity_type,
      source_entity_id, buyer_customer_id, seller_organization_id,
      store_id, duty_code, fixed_assignment_id, assigned_staff_id,
      status, version, created_at, updated_at, completed_at, cancelled_at
    FROM staff_work_items
    WHERE id=?
      AND work_type IN (${placeholders(allowedWorkTypes)})
      AND (?=1 OR assigned_staff_id IN (${placeholders(scope.staffIds)}))
  `).bind(
    workItemId,
    ...allowedWorkTypes,
    scope.global ? 1 : 0,
    ...scope.staffIds,
  ).first<StaffWorkItemDto>();
  if (!row) throw new StaffAssignmentError('NOT_FOUND', 404);
  return row;
}

function visibleWorkTypes(
  actor: AssignmentStaffAuthorization,
): StaffWorkItemType[] {
  return WORK_TYPES.filter((workType) =>
    actor.permissions.has(businessPermissionForWorkItem(workType)));
}

async function visibility(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
): Promise<{ global: boolean; staffIds: readonly string[] }> {
  if (isOwner(actor)) return { global: true, staffIds: [] };
  const teamStaffIds = actor.permissions.has('TASK_VIEW_TEAM')
    ? await visibleTeamStaffIds(database, actor.leaderTeamIds)
    : [];
  return {
    global: false,
    staffIds: [...new Set([actor.staffId, ...teamStaffIds])],
  };
}

async function visibleTeamStaffIds(
  database: SqlDatabase,
  leaderTeamIds: readonly string[],
): Promise<string[]> {
  if (leaderTeamIds.length < 1) return [];
  const rows = await database.prepare(`
    SELECT DISTINCT membership.staff_id AS id
    FROM staff_team_memberships membership
    JOIN staff_teams team ON team.id=membership.team_id AND team.status='ACTIVE'
    JOIN staff_departments department
      ON department.id=team.department_id AND department.status='ACTIVE'
    WHERE membership.status='ACTIVE'
      AND membership.team_id IN (${placeholders(leaderTeamIds)})
    ORDER BY membership.staff_id
  `).bind(...leaderTeamIds).all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

function placeholders(values: readonly unknown[]): string {
  return values.length > 0 ? values.map(() => '?').join(', ') : "''";
}
