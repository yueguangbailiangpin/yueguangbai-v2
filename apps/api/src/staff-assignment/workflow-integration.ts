import type {
  SqlDatabase,
  StaffWorkItemType,
} from '@ygb/contracts';
import { resolveAssignmentStaffAuthorization } from './effective-authorization';
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
    allowCompleted?: boolean;
  },
): Promise<void> {
  const actor = await resolveAssignmentStaffAuthorization(database, input.staffId);
  if (!actor) throw new StaffAssignmentError('FORBIDDEN', 403);
  await requireWorkItemOperationAccess(database, actor, input);
}
