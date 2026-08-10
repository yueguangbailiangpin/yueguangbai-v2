import type { StaffRoleCode } from './staff';

export const STAFF_BINDING_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
export const STAFF_BINDING_STATE_TTL_MS = 10 * 60 * 1000;

export const STAFF_ACCESS_MANAGEMENT_PATHS = Object.freeze({
  overview: '/api/staff/access-management',
  employees: '/api/staff/access-management/employees',
  // legacy migration-only paths
  invitations: '/api/staff/access-management/invitations',
  bindingStart: '/api/staff-auth/binding/start',
} as const);

export type StaffAccessStatus = 'ACTIVE' | 'DISABLED';
export type StaffRoleDisplayName = '总管理员' | '获客' | '售前' | '卖家对接' | '买家返款';

export interface StaffAccessMarketplaceOptionDto {
  code: string;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
}

export interface StaffAccessEmployeeDto {
  staff_id: string;
  display_name: string;
  email: string | null;
  status: StaffAccessStatus;
  version: number;
  role: { code: StaffRoleCode; display_name: StaffRoleDisplayName };
  marketplace_codes: readonly string[];
  last_login_at: number | null;
  updated_at: number;
}

export interface StaffAccessManagementOverviewDto {
  employees: readonly StaffAccessEmployeeDto[];
  available_marketplaces: readonly StaffAccessMarketplaceOptionDto[];
}

export interface CreateStaffAccountRequest {
  display_name: string;
  email: string;
  role_code: StaffRoleCode;
  marketplace_codes: readonly string[];
}
export interface CreateStaffAccountResponse {
  employee: StaffAccessEmployeeDto;
  replayed: boolean;
}
export interface UpdateStaffAccountRequest {
  display_name: string;
  email: string;
  role_code: StaffRoleCode;
  marketplace_codes: readonly string[];
  expected_version: number;
}
export interface ChangeStaffAccessStatusRequest {
  status: StaffAccessStatus;
  expected_version: number;
}
export interface ChangeStaffRoleRequest {
  role_code: StaffRoleCode;
  expected_version: number;
}
export interface StaffAccessMutationResponse {
  employee: StaffAccessEmployeeDto;
  replayed: boolean;
}

// Deprecated Feishu-binding types remain exported so old migration-only modules
// and focused tests can compile while the active composition no longer exposes
// those routes or UI.
export type StaffFeishuBindingStatus = 'ACTIVE' | 'REVOKED' | 'MISSING';
export type StaffBindingInvitationStatus = 'ISSUED' | 'CONSUMED' | 'CANCELLED' | 'EXPIRED';
export interface StaffAccessTeamOptionDto { team_id:string; team_name:string; department_name:string }
export interface StaffBindingInvitationDto {
  invitation_id:string; display_name:string;
  role:{ code:StaffRoleCode; display_name:StaffRoleDisplayName };
  team:StaffAccessTeamOptionDto|null; status:StaffBindingInvitationStatus;
  version:number; issued_at:number; expires_at:number; consumed_at:number|null; cancelled_at:number|null;
}
export interface CreateStaffBindingInvitationRequest { display_name:string; role_code:StaffRoleCode; team_id:string|null }
export interface CreateStaffBindingInvitationResponse { invitation:StaffBindingInvitationDto; invitation_path:string|null; replayed:boolean }
export interface CancelStaffBindingInvitationRequest { expected_version:number }
export interface CancelStaffBindingInvitationResponse { invitation:StaffBindingInvitationDto; replayed:boolean }
export interface StaffBindingStartRequest { invite_token:string }
export interface StaffBindingStartResponse { provider:'FEISHU'; authorization_url:string; expires_at:number }
