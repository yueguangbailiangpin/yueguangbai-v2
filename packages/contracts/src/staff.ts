export const STAFF_ROLE_CODES = [
  'owner',
  'pre_sales',
  'seller_ops',
  'seller_support',
  'after_sales',
  'buyer_support',
] as const;

export type StaffRoleCode = typeof STAFF_ROLE_CODES[number];

export const STAFF_PERMISSION_CODES = [
  'TASK_VIEW_OPEN',
  'TASK_CLAIM',
  'TASK_VIEW_TEAM',
  'TASK_ASSIGN_TEAM',
  'TASK_REASSIGN_TEAM',
  'TASK_TAKEOVER_TEAM',
  'TASK_COLLABORATE_TEAM',

  'BUYER_VIEW',
  'BUYER_CREATE',
  'BUYER_ACTIVATE_STANDARD',
  'BUYER_IDENTITY_HIGH_RISK_MANAGE',

  'SELLER_VIEW',
  'SELLER_MANAGE',

  'PRODUCT_VIEW',
  'PRODUCT_REVIEW',
  'DEMAND_VIEW',
  'DEMAND_PUBLISH',

  'RESERVATION_VIEW',
  'RESERVATION_DECIDE',

  'ORDER_VIEW',
  'ORDER_CONFIRM',

  'ORDER_INSTRUCTION_VIEW',
  'ORDER_INSTRUCTION_PUBLISH',
  'ORDER_INSTRUCTION_MANAGE',
  'ORDER_INSTRUCTION_EXPIRY_RUN',

  'REVIEW_VIEW',
  'REVIEW_DECIDE',

  'BUYER_REFUND_VIEW',
  'BUYER_REFUND_RECORD',

  'SELLER_SETTLEMENT_VIEW',
  'SELLER_SETTLEMENT_RECORD',

  'BUYER_SUPPORT_VIEW',
  'BUYER_SUPPORT_NOTE',
  'SELLER_SUPPORT_VIEW',
  'SELLER_SUPPORT_NOTE',

  'FINANCIAL_VIEW',
  'FINANCIAL_CORRECT',
  'FINANCIAL_EXPORT',
  'SCHEDULED_OPERATIONS_RUN',
  'STAFF_MANAGE',
  'PERMISSION_MANAGE',
  'AUDIT_VIEW',

  'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
  'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
  'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
  'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
  'ASSIGNMENT_BATCH_TRANSFER',
  'ASSIGNMENT_AVAILABILITY_MANAGE',
] as const;

export type StaffPermissionCode =
  typeof STAFF_PERMISSION_CODES[number];

export type StaffPermissionEffect = 'GRANT' | 'DENY';

export function isStaffRoleCode(
  value: unknown,
): value is StaffRoleCode {
  return typeof value === 'string'
    && (STAFF_ROLE_CODES as readonly string[]).includes(value);
}

export function isStaffPermissionCode(
  value: unknown,
): value is StaffPermissionCode {
  return typeof value === 'string'
    && (STAFF_PERMISSION_CODES as readonly string[]).includes(value);
}
