export const STAFF_ASSIGNMENT_DUTY_CODES = [
  'SELLER_ACCOUNT_MANAGER',
  'BUYER_PRE_SALES_OWNER',
  'BUYER_REFUND_OWNER',
] as const;
export type StaffAssignmentDutyCode = typeof STAFF_ASSIGNMENT_DUTY_CODES[number];

export const BUYER_ASSIGNMENT_DUTY_CODES = [
  'BUYER_PRE_SALES_OWNER',
  'BUYER_REFUND_OWNER',
] as const;
export type BuyerAssignmentDutyCode = typeof BUYER_ASSIGNMENT_DUTY_CODES[number];

export const STAFF_ASSIGNMENT_SOURCES = [
  'AUTO_INITIAL', 'MANUAL_REASSIGN',
] as const;
export type StaffAssignmentSource = typeof STAFF_ASSIGNMENT_SOURCES[number];

export const STAFF_WORK_ITEM_TYPES = [
  'PRODUCT_APPLICATION_REVIEW','DEMAND_REVIEW','RESERVATION_DECISION',
  'ORDER_INSTRUCTION_PUBLISH','ORDER_EVIDENCE_REVIEW','REVIEW_DECISION','BUYER_REFUND_PROCESSING',
] as const;
export type StaffWorkItemType = typeof STAFF_WORK_ITEM_TYPES[number];
export const STAFF_WORK_ITEM_STATUSES = ['OPEN','COMPLETED','CANCELLED'] as const;
export type StaffWorkItemStatus = typeof STAFF_WORK_ITEM_STATUSES[number];
export const STAFF_ASSIGNMENT_SUBJECT_TYPES = ['BUYER_CUSTOMER','SELLER_ORGANIZATION'] as const;
export type StaffAssignmentSubjectType = typeof STAFF_ASSIGNMENT_SUBJECT_TYPES[number];

export const STAFF_DATA_SCOPE_TYPES = [
  'GLOBAL','MARKETPLACE','ASSIGNED_BUYERS','ASSIGNED_SELLER_ORGANIZATIONS','TEAM_ASSIGNMENTS',
] as const;
export type StaffDataScopeType = typeof STAFF_DATA_SCOPE_TYPES[number];
export interface StaffDataScope {
  type: StaffDataScopeType;
  marketplaceCodes: readonly string[];
  buyerCustomerIds: readonly string[];
  sellerOrganizationIds: readonly string[];
  teamIds: readonly string[];
}

export interface StaffAssignmentDto {
  assignment_id:string; subject_type:StaffAssignmentSubjectType; subject_id:string;
  duty_code:StaffAssignmentDutyCode; staff_id:string; status:'ACTIVE'|'REVOKED';
  source:StaffAssignmentSource; reason:string|null; version:number; created_at:number; revoked_at:number|null;
}
export interface StaffWorkItemDto {
  work_item_id:string; work_type:StaffWorkItemType; source_entity_type:string; source_entity_id:string;
  buyer_customer_id:string|null; seller_organization_id:string|null; store_id:string|null;
  duty_code:StaffAssignmentDutyCode; fixed_assignment_id:string; assigned_staff_id:string;
  status:StaffWorkItemStatus; version:number; created_at:number; updated_at:number;
  completed_at:number|null; cancelled_at:number|null;
  /** Stage 7.5 batch 1: backend-authoritative SLA metadata (never client-derived). */
  sla_due_at:number|null; is_overdue:boolean; overdue_since:number|null;
  next_action:string; responsible_role:import('./staff').StaffRoleCode;
  responsible_staff_name:string|null;
  priority:'OVERDUE'|'DUE_TODAY'|'NORMAL';
}

/**
 * Stage 7.5 batch 1: authoritative workbench metrics. `refund_due_today_cny_fen`
 * is non-null only for the owner and buyer_refund roles (backend integer sum).
 */
export interface StaffWorkbenchSummaryDto {
  open_count:number; due_today_count:number; overdue_count:number;
  exception_order_count:number;
  refund_due_today_cny_fen:string|null;
  recent:readonly StaffWorkItemDto[];
}
export interface StaffWorkItemListQuery { status?:StaffWorkItemStatus; work_type?:StaffWorkItemType; limit?:number; cursor?:string }
export interface StaffWorkItemPageDto { work_items:readonly StaffWorkItemDto[]; next_cursor:string|null }
export function isStaffAssignmentDutyCode(value:unknown):value is StaffAssignmentDutyCode{return typeof value==='string'&&(STAFF_ASSIGNMENT_DUTY_CODES as readonly string[]).includes(value);}
export function isStaffWorkItemType(value:unknown):value is StaffWorkItemType{return typeof value==='string'&&(STAFF_WORK_ITEM_TYPES as readonly string[]).includes(value);}
