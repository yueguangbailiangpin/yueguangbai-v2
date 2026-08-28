import type {
  StaffAssignmentDutyCode,
  StaffPermissionCode,
  StaffWorkItemType,
} from '@ygb/contracts';

const DUTY_ELIGIBILITY: Readonly<Record<
  StaffAssignmentDutyCode,
  StaffPermissionCode
>> = Object.freeze({
  SELLER_ACCOUNT_MANAGER: 'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
  BUYER_PRE_SALES_OWNER: 'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
  BUYER_REFUND_OWNER: 'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
});


const DUTY_BASE_PERMISSION: Readonly<Record<
  StaffAssignmentDutyCode,
  StaffPermissionCode
>> = Object.freeze({
  SELLER_ACCOUNT_MANAGER: 'PRODUCT_VIEW',
  BUYER_PRE_SALES_OWNER: 'BUYER_VIEW',
  BUYER_REFUND_OWNER: 'BUYER_REFUND_VIEW',
});

const DUTY_BUSINESS_PERMISSIONS: Readonly<Record<
  StaffAssignmentDutyCode,
  readonly StaffPermissionCode[]
>> = Object.freeze({
  SELLER_ACCOUNT_MANAGER: [
    'PRODUCT_VIEW',
    'PRODUCT_REVIEW',
    'DEMAND_VIEW',
    'DEMAND_PUBLISH',
  ],
  BUYER_PRE_SALES_OWNER: [
    'BUYER_VIEW',
    'RESERVATION_VIEW',
    'RESERVATION_DECIDE',
    'ORDER_INSTRUCTION_VIEW',
    'ORDER_INSTRUCTION_PUBLISH',
    'ORDER_VIEW',
    'ORDER_CONFIRM',
  ],
  BUYER_REFUND_OWNER: [
    'BUYER_VIEW',
    'REVIEW_VIEW',
    'REVIEW_DECIDE',
    'BUYER_REFUND_VIEW',
    'BUYER_REFUND_RECORD',
  ],
});

const WORK_ITEM_DUTY: Readonly<Record<
  StaffWorkItemType,
  StaffAssignmentDutyCode
>> = Object.freeze({
  PRODUCT_APPLICATION_REVIEW: 'SELLER_ACCOUNT_MANAGER',
  DEMAND_REVIEW: 'SELLER_ACCOUNT_MANAGER',
  RESERVATION_DECISION: 'BUYER_PRE_SALES_OWNER',
  ORDER_INSTRUCTION_PUBLISH: 'BUYER_PRE_SALES_OWNER',
  ORDER_EVIDENCE_REVIEW: 'BUYER_PRE_SALES_OWNER',
  REVIEW_DECISION: 'BUYER_REFUND_OWNER',
  BUYER_REFUND_PROCESSING: 'BUYER_REFUND_OWNER',
});

const WORK_ITEM_PERMISSION: Readonly<Record<
  StaffWorkItemType,
  StaffPermissionCode
>> = Object.freeze({
  PRODUCT_APPLICATION_REVIEW: 'PRODUCT_REVIEW',
  DEMAND_REVIEW: 'DEMAND_PUBLISH',
  RESERVATION_DECISION: 'RESERVATION_DECIDE',
  ORDER_INSTRUCTION_PUBLISH: 'ORDER_INSTRUCTION_PUBLISH',
  ORDER_EVIDENCE_REVIEW: 'ORDER_CONFIRM',
  REVIEW_DECISION: 'REVIEW_DECIDE',
  BUYER_REFUND_PROCESSING: 'BUYER_REFUND_RECORD',
});

export function eligibilityPermissionForDuty(
  dutyCode: StaffAssignmentDutyCode,
): StaffPermissionCode {
  return DUTY_ELIGIBILITY[dutyCode];
}

export function basePermissionForDuty(
  dutyCode: StaffAssignmentDutyCode,
): StaffPermissionCode {
  return DUTY_BASE_PERMISSION[dutyCode];
}

export function businessPermissionsForDuty(
  dutyCode: StaffAssignmentDutyCode,
): readonly StaffPermissionCode[] {
  return DUTY_BUSINESS_PERMISSIONS[dutyCode];
}

export function dutyForWorkItem(
  workType: StaffWorkItemType,
): StaffAssignmentDutyCode {
  return WORK_ITEM_DUTY[workType];
}

export function businessPermissionForWorkItem(
  workType: StaffWorkItemType,
): StaffPermissionCode {
  return WORK_ITEM_PERMISSION[workType];
}

export function cleanAssignmentReason(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid_assignment_reason');
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > 1000
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error('invalid_assignment_reason');
  }
  return normalized;
}

export function cleanAssignmentIdentifier(
  value: unknown,
  maximum = 200,
): string {
  if (typeof value !== 'string') throw new Error('invalid_assignment_identifier');
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error('invalid_assignment_identifier');
  }
  return normalized;
}

/**
 * Stage 7.5 batch 1 SLA policy: backend-authoritative hours per work type.
 * `BUYER_REFUND_PROCESSING` anchors on the obligation's created_at (the
 * obligations table carries no due date); every other type anchors on the
 * work item's created_at.
 */
export const WORK_ITEM_SLA_HOURS: Readonly<Record<StaffWorkItemType, number>> =
  Object.freeze({
    PRODUCT_APPLICATION_REVIEW: 48,
    DEMAND_REVIEW: 48,
    RESERVATION_DECISION: 24,
    ORDER_INSTRUCTION_PUBLISH: 24,
    ORDER_EVIDENCE_REVIEW: 48,
    REVIEW_DECISION: 48,
    BUYER_REFUND_PROCESSING: 72,
  });

export function workItemSlaDueAt(
  workType: StaffWorkItemType,
  createdAt: number,
  sourceCreatedAt: number | null,
): number {
  const anchor = workType === 'BUYER_REFUND_PROCESSING'
    ? sourceCreatedAt ?? createdAt
    : createdAt;
  return anchor + WORK_ITEM_SLA_HOURS[workType] * 60 * 60 * 1000;
}

const WORK_ITEM_NEXT_ACTION: Readonly<Record<StaffWorkItemType, string>> =
  Object.freeze({
    PRODUCT_APPLICATION_REVIEW: 'REVIEW_PRODUCT_APPLICATION',
    DEMAND_REVIEW: 'REVIEW_DEMAND',
    RESERVATION_DECISION: 'DECIDE_RESERVATION',
    ORDER_INSTRUCTION_PUBLISH: 'PUBLISH_ORDER_INSTRUCTION',
    ORDER_EVIDENCE_REVIEW: 'REVIEW_ORDER_EVIDENCE',
    REVIEW_DECISION: 'DECIDE_REVIEW',
    BUYER_REFUND_PROCESSING: 'PROCESS_BUYER_REFUND',
  });

export function workItemNextAction(workType: StaffWorkItemType): string {
  return WORK_ITEM_NEXT_ACTION[workType];
}

export type StaffWorkItemPriority = 'OVERDUE' | 'DUE_TODAY' | 'NORMAL';

export function workItemPriority(
  slaDueAt: number,
  chinaTodayOf: (epoch: number) => string,
  now: number,
): StaffWorkItemPriority {
  if (slaDueAt < now) return 'OVERDUE';
  return chinaTodayOf(slaDueAt) === chinaTodayOf(now) ? 'DUE_TODAY' : 'NORMAL';
}
