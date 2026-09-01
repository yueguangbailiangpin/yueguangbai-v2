import type { StaffRoleCode } from './staff';

export const STAFF_ACCESS_MANAGEMENT_PATHS = Object.freeze({
  overview: '/api/staff/access-management',
  employees: '/api/staff/access-management/employees',
  sellerOrganizationAssignments: '/api/staff/access-management/seller-organization-assignments',
  buyerAssignments: '/api/staff/access-management/buyer-assignments',
} as const);

export type StaffAccessStatus = 'ACTIVE' | 'DISABLED';
export type StaffRoleDisplayName = '总管理员' | '售前' | '卖家对接' | '买家返款';
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
export interface StaffAccessBuyerFixedOwnerDto {
  assignment_id: string;
  staff_id: string;
  staff_display_name: string;
  version: number;
}
/**
 * The single fixed Buyer refund owner (BUYER_REFUND_OWNER duty) and the
 * single fixed Buyer pre-sales owner (BUYER_PRE_SALES_OWNER duty). A buyer
 * without either owner fails closed on the matching work until an owner sets
 * one through these routes.
 */
export interface StaffAccessBuyerRefundOwnerAssignmentDto {
  buyer_customer_id: string;
  buyer_display_name: string;
  marketplace_code: string;
  pre_sales_owner: StaffAccessBuyerFixedOwnerDto | null;
  refund_owner: StaffAccessBuyerFixedOwnerDto | null;
}
export interface ChangeStaffAccessBuyerRefundOwnerRequest {
  buyer_customer_id: string;
  assigned_staff_id: string;
  expected_assignment_version: number;
  reason: string;
}
export interface StaffAccessBuyerRefundOwnerMutationDto {
  buyer: StaffAccessBuyerRefundOwnerAssignmentDto;
  replayed: boolean;
}
/**
 * Stage 6.6E: the pre-sales fixed-owner variant of the buyer assignment
 * mutation (BUYER_PRE_SALES_OWNER duty, pre_sales-eligible staff only).
 */
export interface ChangeStaffAccessBuyerPreSalesOwnerRequest {
  buyer_customer_id: string;
  assigned_staff_id: string;
  expected_assignment_version: number;
  reason: string;
}
export interface StaffAccessBuyerPreSalesOwnerMutationDto {
  buyer: StaffAccessBuyerRefundOwnerAssignmentDto;
  replayed: boolean;
}
/**
 * Stage 6.6E: Personal DENY management. A DENY can only shrink a role's
 * default permissions; GRANT rows are forbidden at the database level.
 */
export interface StaffAccessPersonalDenyDto {
  staff_id: string;
  staff_display_name: string;
  permission_code: string;
  status: 'ACTIVE' | 'REVOKED';
  reason: string | null;
  assigned_by_staff_id: string;
  assigned_at: number;
  revoked_at: number | null;
}
export interface SetStaffAccessPersonalDenyRequest {
  staff_id: string;
  permission_code: string;
  reason: string;
}
export interface RevokeStaffAccessPersonalDenyRequest {
  staff_id: string;
  permission_code: string;
  reason: string;
}
export interface StaffAccessPersonalDenyMutationDto {
  deny: StaffAccessPersonalDenyDto;
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
