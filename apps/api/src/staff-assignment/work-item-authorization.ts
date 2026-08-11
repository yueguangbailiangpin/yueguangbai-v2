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
  seller_organization_id: string | null;
  marketplace_code: string;
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
): Promise<{
  workItemId: string;
  assignedStaffId: string;
  sellerOrganizationId: string | null;
}> {
  const businessPermission = businessPermissionForWorkItem(input.workType);
  if (!actor.permissions.has(businessPermission)) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
  const item = await database.prepare(`
    SELECT id, assigned_staff_id, seller_organization_id, marketplace_code
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
  if (isOwner(actor)) {
    return {
      workItemId: item.id,
      assignedStaffId: item.assigned_staff_id,
      sellerOrganizationId: item.seller_organization_id,
    };
  }
  if (item.assigned_staff_id !== actor.staffId) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
  const primary = await database.prepare(`
    SELECT 1 AS allowed FROM staff_marketplace_scopes
    WHERE staff_id=? AND marketplace_code=?
      AND status='ACTIVE' AND scope_kind='PRIMARY'
    LIMIT 1
  `).bind(actor.staffId, item.marketplace_code)
    .first<{ allowed: number }>();
  if (!primary) throw new StaffAssignmentError('FORBIDDEN', 403);
  return {
    workItemId: item.id,
    assignedStaffId: item.assigned_staff_id,
    sellerOrganizationId: item.seller_organization_id,
  };
}
