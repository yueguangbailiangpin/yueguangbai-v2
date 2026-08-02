export const STAFF_ASSIGNMENT_DUTY_CODES = [
  'SELLER_ACCOUNT_MANAGER',
  'BUYER_PRE_SALES_OWNER',
  'BUYER_AFTER_SALES_OWNER',
  'BUYER_REFUND_OWNER',
] as const;
export type StaffAssignmentDutyCode =
  typeof STAFF_ASSIGNMENT_DUTY_CODES[number];

export const BUYER_ASSIGNMENT_DUTY_CODES = [
  'BUYER_PRE_SALES_OWNER',
  'BUYER_AFTER_SALES_OWNER',
  'BUYER_REFUND_OWNER',
] as const;
export type BuyerAssignmentDutyCode =
  typeof BUYER_ASSIGNMENT_DUTY_CODES[number];

export const STAFF_AVAILABILITY_STATUSES = [
  'AVAILABLE',
  'UNAVAILABLE',
] as const;
export type StaffAvailabilityStatus =
  typeof STAFF_AVAILABILITY_STATUSES[number];

export const STAFF_ASSIGNMENT_SOURCES = [
  'AUTO_INITIAL',
  'AUTO_REPLACEMENT',
  'OWNER_FALLBACK',
  'MANUAL_REASSIGN',
  'BATCH_TRANSFER',
] as const;
export type StaffAssignmentSource =
  typeof STAFF_ASSIGNMENT_SOURCES[number];

export const STAFF_WORK_ITEM_TYPES = [
  'PRODUCT_APPLICATION_REVIEW',
  'DEMAND_REVIEW',
  'RESERVATION_DECISION',
  'ORDER_INSTRUCTION_PUBLISH',
  'ORDER_EVIDENCE_REVIEW',
  'REVIEW_DECISION',
  'BUYER_REFUND_PROCESSING',
] as const;
export type StaffWorkItemType =
  typeof STAFF_WORK_ITEM_TYPES[number];

export const STAFF_WORK_ITEM_STATUSES = [
  'OPEN',
  'COMPLETED',
  'CANCELLED',
] as const;
export type StaffWorkItemStatus =
  typeof STAFF_WORK_ITEM_STATUSES[number];

export const STAFF_ASSIGNMENT_SUBJECT_TYPES = [
  'BUYER_CUSTOMER',
  'SELLER_ORGANIZATION',
] as const;
export type StaffAssignmentSubjectType =
  typeof STAFF_ASSIGNMENT_SUBJECT_TYPES[number];

export const STAFF_DATA_SCOPE_TYPES = [
  'GLOBAL',
  'ASSIGNED_BUYERS',
  'ASSIGNED_SELLER_ORGANIZATIONS',
  'TEAM_ASSIGNMENTS',
] as const;
export type StaffDataScopeType =
  typeof STAFF_DATA_SCOPE_TYPES[number];

export interface StaffDataScope {
  type: StaffDataScopeType;
  buyerCustomerIds: readonly string[];
  sellerOrganizationIds: readonly string[];
  teamIds: readonly string[];
}

export interface StaffAvailabilityDto {
  staff_id: string;
  availability_status: StaffAvailabilityStatus;
  reason: string | null;
  version: number;
  effective_default: boolean;
  updated_at: number | null;
}

export interface StaffAssignmentDto {
  assignment_id: string;
  subject_type: StaffAssignmentSubjectType;
  subject_id: string;
  duty_code: StaffAssignmentDutyCode;
  staff_id: string;
  status: 'ACTIVE' | 'REVOKED';
  source: StaffAssignmentSource;
  reason: string | null;
  version: number;
  created_at: number;
  revoked_at: number | null;
}

export interface StaffWorkItemDto {
  work_item_id: string;
  work_type: StaffWorkItemType;
  source_entity_type: string;
  source_entity_id: string;
  buyer_customer_id: string | null;
  seller_organization_id: string | null;
  store_id: string | null;
  duty_code: StaffAssignmentDutyCode;
  fixed_assignment_id: string;
  assigned_staff_id: string;
  status: StaffWorkItemStatus;
  version: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  cancelled_at: number | null;
}

export const STAFF_REASSIGNMENT_BATCH_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'FAILED',
  'CANCELLED',
] as const;
export type StaffReassignmentBatchStatus =
  typeof STAFF_REASSIGNMENT_BATCH_STATUSES[number];

export interface StaffReassignmentBatchDto {
  batch_id: string;
  source_staff_id: string;
  target_mode: 'STAFF' | 'AUTO_SELECT';
  target_staff_id: string | null;
  duty_code: StaffAssignmentDutyCode;
  subject_type: StaffAssignmentSubjectType;
  status: StaffReassignmentBatchStatus;
  reason: string;
  version: number;
  total_items: number;
  completed_items: number;
  failed_items: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export function isStaffAssignmentDutyCode(
  value: unknown,
): value is StaffAssignmentDutyCode {
  return typeof value === 'string'
    && (STAFF_ASSIGNMENT_DUTY_CODES as readonly string[]).includes(value);
}

export function isStaffWorkItemType(
  value: unknown,
): value is StaffWorkItemType {
  return typeof value === 'string'
    && (STAFF_WORK_ITEM_TYPES as readonly string[]).includes(value);
}

export function isStaffAvailabilityStatus(
  value: unknown,
): value is StaffAvailabilityStatus {
  return typeof value === 'string'
    && (STAFF_AVAILABILITY_STATUSES as readonly string[]).includes(value);
}
