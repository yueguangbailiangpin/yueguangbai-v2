import {
  isStaffRoleCode,
  type SqlDatabase,
  type StaffAccessMutationResponse,
  type StaffAccessStatus,
  type StaffRoleCode,
} from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { changeStaffAccountStatus, updateStaffAccount } from './accounts';
import { StaffAccessManagementError } from './errors';
import { readStaffAccessEmployee } from './read-model';

interface Command {
  actor: AssignmentStaffAuthorization;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
}

// Compatibility wrappers for focused legacy tests/modules. Active routes use
// the combined email/role/Marketplace account endpoints.
export async function changeStaffAccessStatus(
  database: SqlDatabase,
  input: { staffId: string; status: StaffAccessStatus; expectedVersion: number },
  command: Command,
): Promise<StaffAccessMutationResponse> {
  if (input.status !== 'ACTIVE' && input.status !== 'DISABLED') validation();
  const employee = await changeStaffAccountStatus(database, input.staffId, {
    status: input.status,
    expectedVersion: input.expectedVersion,
  }, command.actor);
  return { employee, replayed: false };
}

export async function changeStaffRole(
  database: SqlDatabase,
  input: { staffId: string; roleCode: StaffRoleCode; expectedVersion: number },
  command: Command,
): Promise<StaffAccessMutationResponse> {
  if (!isStaffRoleCode(input.roleCode)) validation();
  const current = await readStaffAccessEmployee(database, input.staffId);
  if (!current.email) throw new StaffAccessManagementError('STATE_CONFLICT', 409);
  const employee = await updateStaffAccount(database, input.staffId, {
    displayName: current.display_name,
    email: current.email,
    roleCode: input.roleCode,
    marketplaceCodes: input.roleCode === 'owner' ? [] : current.marketplace_codes,
    expectedVersion: input.expectedVersion,
  }, command.actor);
  return { employee, replayed: false };
}

function validation(): never {
  throw new StaffAccessManagementError('VALIDATION_ERROR', 400);
}
