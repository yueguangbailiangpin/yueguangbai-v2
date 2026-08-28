import type { FixedIntegerString, PricingReviewType } from './pricing';
import type { StaffRoleCode } from './staff';

/**
 * Stage 7.5 batch 1: authoritative business-stage / responsibility projection
 * shared by the staff formal-order cursor list and the unified order detail.
 * All values are computed by the backend from fixed assignments and the
 * frozen financial facts; the frontend never derives them.
 */

export const FORMAL_ORDER_BUSINESS_STAGES = [
  'BUYER_REFUND',
  'SELLER_SETTLEMENT',
  'COMPLETED',
] as const;
export type FormalOrderBusinessStage = typeof FORMAL_ORDER_BUSINESS_STAGES[number];

export const FORMAL_ORDER_EXCEPTION_STATES = [
  'NONE',
  'OPEN',
] as const;
export type FormalOrderExceptionState = typeof FORMAL_ORDER_EXCEPTION_STATES[number];

export const FORMAL_ORDER_NEXT_ACTIONS = [
  'PROCESS_BUYER_REFUND',
  'FOLLOW_SELLER_SETTLEMENT',
  'REVIEW_COMPLETED_ORDER',
  'RESOLVE_EXCEPTION',
  'ASSIGN_RESPONSIBLE_STAFF',
] as const;
export type FormalOrderNextAction = typeof FORMAL_ORDER_NEXT_ACTIONS[number];

/** Fixed-assignment role that owns the order's current stage. */
export type FormalOrderResponsibleRole =
  | 'buyer_refund'
  | 'seller_ops'
  | 'owner';

export interface FormalOrderResponsibleStaffProjection {
  staff_id: string;
  display_name: string;
}

export interface FormalOrderResponsibilityDto {
  stage: FormalOrderBusinessStage;
  responsible_role: FormalOrderResponsibleRole;
  /** Fixed-assignment owner for the stage; null when unassigned (fail-closed hint). */
  responsible_staff: FormalOrderResponsibleStaffProjection | null;
  next_action: FormalOrderNextAction;
  next_action_due_at: number | null;
  is_overdue: boolean;
  /** Authoritative overdue origin: equals next_action_due_at whenever overdue. */
  overdue_since: number | null;
  exception_state: FormalOrderExceptionState;
  exception_reason: string | null;
  /** Action codes the caller may execute (UI hint only; server re-authorizes). */
  available_actions: readonly string[];
}

/**
 * Lightweight list row for `GET /api/staff/formal-orders` list mode.
 * Amounts are backend-authoritative snapshot integers as decimal strings.
 */
export interface StaffFormalOrderListItemDto {
  formal_order_id: string;
  marketplace_code: string;
  amazon_order_number: string;
  amazon_order_date: string | null;
  confirmed_at: number;
  buyer_customer_id: string;
  buyer_customer_no: string;
  buyer_display_name: string;
  seller_organization_id: string;
  store_display_name: string;
  product_name_snapshot: string;
  review_type: PricingReviewType;
  buyer_expected_principal_cny_fen: FixedIntegerString | null;
  seller_expected_principal_cny_fen: FixedIntegerString | null;
  responsibility: FormalOrderResponsibilityDto;
}

export interface StaffFormalOrderListPageDto {
  items: readonly StaffFormalOrderListItemDto[];
  next_cursor: string | null;
}

export const STAFF_ORDER_LIST_DEFAULT_LIMIT = 20 as const;
export const STAFF_ORDER_LIST_MAX_LIMIT = 100 as const;

export function isFormalOrderBusinessStage(
  value: unknown,
): value is FormalOrderBusinessStage {
  return typeof value === 'string'
    && (FORMAL_ORDER_BUSINESS_STAGES as readonly string[]).includes(value);
}

export function isFormalOrderExceptionState(
  value: unknown,
): value is FormalOrderExceptionState {
  return typeof value === 'string'
    && (FORMAL_ORDER_EXCEPTION_STATES as readonly string[]).includes(value);
}

/** Role that owns a work-item duty code (fixed-assignment model). */
export function responsibleRoleForDuty(
  duty:
    | 'SELLER_ACCOUNT_MANAGER'
    | 'BUYER_PRE_SALES_OWNER'
    | 'BUYER_REFUND_OWNER',
): StaffRoleCode {
  switch (duty) {
    case 'SELLER_ACCOUNT_MANAGER':
      return 'seller_ops';
    case 'BUYER_PRE_SALES_OWNER':
      return 'pre_sales';
    case 'BUYER_REFUND_OWNER':
      return 'buyer_refund';
  }
}
