import type {
  SqlDatabase,
  StaffWorkItemType,
} from '@ygb/contracts';
import { businessPermissionForWorkItem } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from './effective-authorization';
import { StaffAssignmentError } from './errors';
import { isOwner } from './permission-policy';

interface WorkItemAccessRow {
  id: string;
  assigned_staff_id: string;
}

export async function requireWorkItemOperationAccess(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  input: {
    workType: StaffWorkItemType;
    sourceEntityType:
      | 'PRODUCT_APPLICATION'
      | 'DEMAND_BATCH'
      | 'RESERVATION'
      | 'ORDER_INSTRUCTION'
      | 'ORDER_EVIDENCE'
      | 'REVIEW_CASE'
      | 'BUYER_REFUND_OBLIGATION';
    sourceEntityId: string;
    allowCompleted?: boolean;
  },
): Promise<{ workItemId: string; assignedStaffId: string }> {
  const businessPermission = businessPermissionForWorkItem(input.workType);
  if (!actor.permissions.has(businessPermission)) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
  const item = await database.prepare(`
    SELECT id, assigned_staff_id
    FROM staff_work_items
    WHERE source_entity_type=? AND source_entity_id=?
      AND work_type=? AND status IN (${input.allowCompleted
        ? "'OPEN', 'COMPLETED'"
        : "'OPEN'"})
  `).bind(
    input.sourceEntityType,
    input.sourceEntityId,
    input.workType,
  ).first<WorkItemAccessRow>();
  if (!item) throw new StaffAssignmentError('NOT_FOUND', 404);
  if (item.assigned_staff_id === actor.staffId || isOwner(actor)) {
    return {
      workItemId: item.id,
      assignedStaffId: item.assigned_staff_id,
    };
  }
  if (!actor.permissions.has('TASK_TAKEOVER_TEAM')
    || actor.leaderTeamIds.length < 1) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
  const placeholders = actor.leaderTeamIds.map(() => '?').join(', ');
  const member = await database.prepare(`
    SELECT 1 AS allowed
    FROM staff_team_memberships membership
    JOIN staff_teams team ON team.id=membership.team_id
      AND team.status='ACTIVE'
    JOIN staff_departments department ON department.id=team.department_id
      AND department.status='ACTIVE'
    WHERE membership.staff_id=? AND membership.status='ACTIVE'
      AND membership.team_id IN (${placeholders})
    LIMIT 1
  `).bind(item.assigned_staff_id, ...actor.leaderTeamIds)
    .first<{ allowed: number }>();
  if (!member) throw new StaffAssignmentError('FORBIDDEN', 403);
  return {
    workItemId: item.id,
    assignedStaffId: item.assigned_staff_id,
  };
}
