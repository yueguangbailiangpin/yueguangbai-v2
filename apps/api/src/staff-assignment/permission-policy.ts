import type {
  StaffAssignmentDutyCode,
  StaffPermissionCode,
  StaffWorkItemType,
} from '@ygb/contracts';
import {
  businessPermissionForWorkItem,
  eligibilityPermissionForDuty,
} from '@ygb/domain';
import { StaffAssignmentError } from './errors';
import type { AssignmentStaffAuthorization } from './effective-authorization';

export function requireDutyEligibility(
  actor: AssignmentStaffAuthorization,
  dutyCode: StaffAssignmentDutyCode,
): void {
  if (!actor.permissions.has(eligibilityPermissionForDuty(dutyCode))) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
}

export function requireWorkItemBusinessPermission(
  actor: AssignmentStaffAuthorization,
  workType: StaffWorkItemType,
): void {
  if (!actor.permissions.has(businessPermissionForWorkItem(workType))) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
}

export function requirePermission(
  actor: AssignmentStaffAuthorization,
  permission: StaffPermissionCode,
): void {
  if (!actor.permissions.has(permission)) {
    throw new StaffAssignmentError('FORBIDDEN', 403);
  }
}

export function isOwner(actor: AssignmentStaffAuthorization): boolean {
  return actor.roles.has('owner');
}
