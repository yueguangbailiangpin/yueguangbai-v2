import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { StaffAccessManagementError } from './errors';

export function requireStaffAccessManager(
  actor: AssignmentStaffAuthorization | null | undefined,
): AssignmentStaffAuthorization {
  if (!actor) {
    throw new StaffAccessManagementError('UNAUTHENTICATED', 401);
  }
  if (actor.roles.size !== 1
    || !actor.roles.has('owner')
    || !actor.permissions.has('STAFF_MANAGE')
    || !actor.permissions.has('PERMISSION_MANAGE')) {
    throw new StaffAccessManagementError('FORBIDDEN', 403);
  }
  return actor;
}
