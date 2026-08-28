import type { DemandTaskType } from './demand';
import type { ReservationStatus } from './reservation';
import type { FixedIntegerString } from './pricing';
import type { MarketplaceCode } from './customer';

export interface BuyerPortalMeDto {
  /**
   * Stage 7.5 batch 2: public display names of the buyer's fixed
   * pre-sales / refund owners (null when unassigned). Never includes staff
   * ids, emails, permissions, or any other internal field.
   */
  assigned_contacts: {
    pre_sales_owner_display_name: string | null;
    refund_owner_display_name: string | null;
  };
  buyer: {
    display_name: string;
    marketplace_code: MarketplaceCode;
    identity_review_status: 'CLEAR' | 'REVIEW_REQUIRED';
    /** 客户编码（D2 注册即分配；历史买家可能为 null，首单确认时转正）。 */
    customer_number: string | null;
    /** 返款收款人姓名（P7a 收款账户；null = 未填写，资料页可后补）。 */
    refund_account_name: string | null;
    /** 返款收款支付宝账号（P7a 收款账户；null = 未填写）。 */
    refund_account_identifier: string | null;
  };
}

export interface BuyerPortalDemandDto {
  demand_id: string;
  demand_version: number;
  marketplace_code: MarketplaceCode;
  product_name: string;
  main_image: {
    file_object_id: string;
    file_version: number;
    purpose: 'PRODUCT_IMAGE';
    visibility: 'SELLER_VISIBLE';
  } | null;
  reference_order_amount_jpy: FixedIntegerString;
  buyer_self_pay_bps: number;
  estimated_buyer_self_pay_jpy: FixedIntegerString;
  estimated_refundable_principal_jpy: FixedIntegerString;
  buyer_visible_notes: string | null;
  store_display_name: string;
  task_type: DemandTaskType;
  target_quantity: number;
  remaining_quantity: number;
  open_at: number;
  reservation_deadline: number;
  order_deadline: number;
  /**
   * A buyer-safe reservation decision for this demand at read time.  It never
   * exposes the reservation or any other buyer's information.
   */
  reservation_eligibility:
    | 'ELIGIBLE'
    | 'INELIGIBLE_ACTIVE_STORE_RESERVATION';
  reservation_ineligibility_reason:
    | 'ACTIVE_STORE_RESERVATION'
    | null;
}

export interface BuyerPortalReservationDemandDto {
  demand_id: string;
  demand_version: number;
  marketplace_code: MarketplaceCode;
  product_name: string;
  reference_order_amount_jpy: FixedIntegerString;
  buyer_self_pay_bps: number;
  estimated_buyer_self_pay_jpy: FixedIntegerString;
  estimated_refundable_principal_jpy: FixedIntegerString;
  buyer_visible_notes: string | null;
  store_display_name: string;
  task_type: DemandTaskType;
  reservation_deadline: number;
  order_deadline: number;
}

export interface BuyerPortalReservationDto {
  reservation_id: string;
  status: ReservationStatus;
  version: number;
  submitted_at: number;
  updated_at: number;
  hold_expires_at: number;
  order_deadline_snapshot: number;
  buyer_self_pay_bps_snapshot: number;
  reference_order_amount_jpy_snapshot: FixedIntegerString;
  estimated_self_pay_jpy_snapshot: FixedIntegerString;
  estimated_refundable_principal_jpy_snapshot: FixedIntegerString;
  buyer_self_pay_accepted_at: number;
  buyer_self_pay_accepted_demand_version: number;
  decided_at: number | null;
  cancelled_at: number | null;
  expired_at: number | null;
  can_cancel: boolean;
  demand: BuyerPortalReservationDemandDto;
}

export interface BuyerPortalPageDto<T> {
  items: readonly T[];
  next_cursor: string | null;
}

export interface BuyerPortalReservationMutationDto {
  reservation: BuyerPortalReservationDto;
  replayed: boolean;
}
