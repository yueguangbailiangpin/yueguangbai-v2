import type { DemandTaskType } from './demand';
import type { ReservationStatus } from './reservation';
import type { FixedIntegerString } from './pricing';
import type { MarketplaceCode } from './customer';

export interface BuyerPortalMeDto {
  buyer: {
    display_name: string;
    marketplace_code: MarketplaceCode;
    identity_review_status: 'CLEAR' | 'REVIEW_REQUIRED';
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
