import type { StaffRoleCode } from './staff';

export const STAFF_ACCESS_MANAGEMENT_PATHS = Object.freeze({
  overview: '/api/staff/access-management',
  employees: '/api/staff/access-management/employees',
  sellerOrganizationAssignments: '/api/staff/access-management/seller-organization-assignments',
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
/**
 * The single fixed seller-side owner. IDs are deliberately kept in the
 * transport contract for mutations, but the Staff UI must render the human
 * names instead of asking an operator to type either ID.
 */
export interface StaffAccessSellerOrganizationAssignmentDto {
  seller_organization_id: string;
  seller_organization_name: string;
  marketplace_code: string;
  manager: {
    assignment_id: string;
    staff_id: string;
    staff_display_name: string;
    version: number;
  } | null;
}
export interface ChangeStaffAccessSellerOrganizationAssignmentRequest {
  assigned_staff_id: string;
  expected_assignment_version: number;
}
export interface StaffAccessSellerOrganizationAssignmentMutationDto {
  seller_organization: StaffAccessSellerOrganizationAssignmentDto;
  replayed: boolean;
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
