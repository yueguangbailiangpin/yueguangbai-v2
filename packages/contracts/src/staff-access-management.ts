import type { StaffRoleCode } from './staff';

export const STAFF_ACCESS_MANAGEMENT_PATHS = Object.freeze({
  overview: '/api/staff/access-management',
  employees: '/api/staff/access-management/employees',
} as const);

export type StaffAccessStatus = 'ACTIVE' | 'DISABLED';
export type StaffRoleDisplayName = '总管理员' | '获客' | '售前' | '卖家对接' | '买家返款';
export type StaffMarketplaceScopeKind = 'PRIMARY' | 'SUPPORT';

export interface StaffAccessMarketplaceOptionDto {
  code: string;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
}
export interface StaffAccessMarketplaceScopeDto {
  code: string;
  scope_kind: StaffMarketplaceScopeKind;
}
export interface StaffAccessEmployeeDto {
  staff_id: string;
  display_name: string;
  email: string | null;
  status: StaffAccessStatus;
  version: number;
  role: { code: StaffRoleCode; display_name: StaffRoleDisplayName };
  marketplace_codes: readonly string[];
  /** Added after the one-primary-plus-support model. Optional for old fixtures. */
  marketplace_scopes?: readonly StaffAccessMarketplaceScopeDto[];
  last_login_at: number | null;
  updated_at: number;
}

export interface StaffAccessManagementOverviewDto {
  employees: readonly StaffAccessEmployeeDto[];
  available_marketplaces: readonly StaffAccessMarketplaceOptionDto[];
}
export interface CreateStaffAccountRequest {display_name:string;email:string;role_code:StaffRoleCode;marketplace_codes:readonly string[]}
export interface CreateStaffAccountResponse {employee:StaffAccessEmployeeDto;replayed:boolean}
export interface UpdateStaffAccountRequest {display_name:string;email:string;role_code:StaffRoleCode;marketplace_codes:readonly string[];expected_version:number}
export interface ChangeStaffAccessStatusRequest {status:StaffAccessStatus;expected_version:number}
export interface ChangeStaffRoleRequest {role_code:StaffRoleCode;expected_version:number}
export interface StaffAccessMutationResponse {employee:StaffAccessEmployeeDto;replayed:boolean}
