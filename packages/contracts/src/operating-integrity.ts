import type { BuyerRefundPaymentChannel } from './buyer-refund';

export const FORMAL_ORDER_OPERATIONAL_STATES=[
  'NORMAL','PLATFORM_CANCELLED','RETURN_REFUND','BUSINESS_VOID','MANUAL_INVESTIGATION',
] as const;
export type FormalOrderOperationalState=typeof FORMAL_ORDER_OPERATIONAL_STATES[number];
export const FORMAL_ORDER_OPERATIONAL_EVENT_TYPES=[
  'PLATFORM_CANCELLED','RETURN_REFUND','BUSINESS_VOID','MANUAL_INVESTIGATION','RESOLVED',
] as const;
export type FormalOrderOperationalEventType=typeof FORMAL_ORDER_OPERATIONAL_EVENT_TYPES[number];
export const FORMAL_ORDER_ADJUSTMENT_SCOPES=[
  'PROJECTED_GROSS_PROFIT','COMPLETED_GROSS_PROFIT','SELLER_PRINCIPAL_DUE','SELLER_SERVICE_FEE_DUE','BUYER_REFUND_DUE',
] as const;
export type FormalOrderAdjustmentScope=typeof FORMAL_ORDER_ADJUSTMENT_SCOPES[number];

export interface FormalOrderOperationalEventDto{
  event_id:string;formal_order_id:string;event_type:FormalOrderOperationalEventType;reason:string;actor_staff_id:string;created_at:number;
}
export interface FormalOrderFinancialAdjustmentDto{
  adjustment_id:string;formal_order_id:string;source_operational_event_id:string|null;adjustment_scope:FormalOrderAdjustmentScope;
  amount_cny_fen:string;reason:string;actor_staff_id:string;created_at:number;
}
export interface FormalOrderIntegrityDto{
  formal_order_id:string;canonical_marketplace_code:string;operational_state:FormalOrderOperationalState;
  events:readonly FormalOrderOperationalEventDto[];adjustments:readonly FormalOrderFinancialAdjustmentDto[];
}

export const REVIEW_VISIBILITY_STATUSES=['VISIBLE','NOT_VISIBLE','DROPPED','RECHECK_REQUIRED'] as const;
export type ReviewVisibilityStatus=typeof REVIEW_VISIBILITY_STATUSES[number];
export interface ReviewVisibilityObservationDto{
  observation_id:string;review_case_id:string;formal_order_id:string;visibility_status:ReviewVisibilityStatus;
  note:string|null;observed_at:number;actor_staff_id:string;created_at:number;
}

export interface BuyerAdvancePrincipalEntryDto{
  entry_id:string;formal_order_id:string;buyer_customer_id:string;entry_type:'PAYMENT'|'REVERSAL';
  original_payment_entry_id:string|null;amount_cny_fen:string;paid_at:number|null;reversed_at:number|null;
  china_business_date:string;payment_channel:BuyerRefundPaymentChannel;note:string|null;actor_staff_id:string;created_at:number;
}
