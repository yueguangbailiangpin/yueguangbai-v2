import type {
  SqlDatabase,
  StaffWorkItemType,
} from '@ygb/contracts';
import { resolveAssignmentStaffAuthorization } from './effective-authorization';
import type { AssignmentStaffAuthorization } from './effective-authorization';
import { StaffAssignmentError } from './errors';
import { requireWorkItemOperationAccess } from './work-item-authorization';

/** Resolves the authoritative Staff actor from D1 and enforces task ownership. */
export async function requireAssignedWorkflowActor(
  database: SqlDatabase,
  input: {
    staffId: string;
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
    authoritativeSellerOrganizationId?: string;
    allowCompleted?: boolean;
  },
): Promise<AssignmentStaffAuthorization> {
  const actor = await resolveAssignmentStaffAuthorization(database, input.staffId);
  if (!actor) throw new StaffAssignmentError('FORBIDDEN', 403);
  const workItem = await requireWorkItemOperationAccess(database, actor, input);
  if (input.authoritativeSellerOrganizationId !== undefined
    && workItem.sellerOrganizationId
      !== input.authoritativeSellerOrganizationId
    && !actor.roles.has('owner')) {
    throw new StaffAssignmentError('NOT_FOUND', 404);
  }
  return actor;
}
