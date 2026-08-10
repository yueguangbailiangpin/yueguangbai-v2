import type { AcquisitionLeadType, StaffPermissionCode } from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { AcquisitionError } from './errors';

export function requireAcquisitionAdmin(actor: AssignmentStaffAuthorization): void {
  if (!actor.roles.has('owner') || !actor.permissions.has('ACQUISITION_ADMIN')) {
    throw new AcquisitionError('FORBIDDEN', 403);
  }
}

export function requireAcquisitionOperator(actor: AssignmentStaffAuthorization): void {
  if (!actor.roles.has('owner') && !actor.roles.has('acquisition')) {
    throw new AcquisitionError('FORBIDDEN', 403);
  }
}

export function requireLeadDuty(
  actor: AssignmentStaffAuthorization,
  leadType: AcquisitionLeadType,
): void {
  const permission: StaffPermissionCode = leadType === 'BUYER'
    ? 'ACQUISITION_BUYER_LEAD' : 'ACQUISITION_SELLER_LEAD';
  const roleAllowed = actor.roles.has('owner')
    || (leadType === 'BUYER' && actor.roles.has('pre_sales'))
    || (leadType === 'SELLER' && actor.roles.has('seller_ops'));
  if (!roleAllowed || !actor.permissions.has(permission)) {
    throw new AcquisitionError('FORBIDDEN', 403);
  }
}

export function visibleLeadTypes(actor: AssignmentStaffAuthorization): AcquisitionLeadType[] {
  const result: AcquisitionLeadType[] = [];
  if ((actor.roles.has('owner') || actor.roles.has('pre_sales'))
    && actor.permissions.has('ACQUISITION_BUYER_LEAD')) result.push('BUYER');
  if ((actor.roles.has('owner') || actor.roles.has('seller_ops'))
    && actor.permissions.has('ACQUISITION_SELLER_LEAD')) result.push('SELLER');
  if (result.length === 0) throw new AcquisitionError('FORBIDDEN', 403);
  return result;
}
