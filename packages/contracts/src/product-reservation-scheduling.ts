import type { DemandBatchStatus, DemandTaskType } from './demand';
import type { ReservationStatus } from './reservation';

// The current live scheduling contract is Amazon JP, so customer/order schedule
// dates are Tokyo-local. Company operating reports remain Asia/Shanghai.
// Before a second live Marketplace is enabled this contract becomes per-market.
export const PRODUCT_SCHEDULE_TIMEZONE = 'Asia/Tokyo' as const;
export const STAFF_PRODUCT_PAGE_DEFAULT_LIMIT = 25;
export const STAFF_PRODUCT_PAGE_MAX_LIMIT = 100;
export const STAFF_RESERVATION_SCHEDULE_PAGE_DEFAULT_LIMIT = 50;
export const STAFF_RESERVATION_SCHEDULE_PAGE_MAX_LIMIT = 100;

export interface OrderCadenceDto { order_interval_days:number; orders_per_run:number }
export interface StaffProductListItemDto { product_id:string;seller_organization_id:string;store_id:string;store_name:string;marketplace_code:string;asin:string;status:'ACTIVE'|'DISABLED';aggregate_version:number;current_version_no:number;product_name:string;cadence:OrderCadenceDto|null;updated_at:number }
export interface StaffProductPageDto { items:readonly StaffProductListItemDto[];next_cursor:string|null;data_as_of:number }
export interface StaffProductVersionDto { product_version_id:string;version_no:number;product_name:string;search_keywords:readonly string[];ordering_guide_expected_amount_jpy:number;color_spec_mode:'MAIN_IMAGE_VARIANT'|'ANY_VARIANT';default_buyer_self_pay_bps:number;product_url:string|null;buyer_visible_notes:string|null;internal_notes:string|null;cadence:OrderCadenceDto|null;created_at:number }
export interface StaffProductDemandDto { demand_batch_id:string;status:DemandBatchStatus;target_quantity:number;effective_reservation_count:number;order_deadline:number;demand_version:number;schedule_version:number|null;first_order_date:string|null }
export interface StaffProductDetailDto extends StaffProductListItemDto { versions:readonly StaffProductVersionDto[];demands:readonly StaffProductDemandDto[];timezone:typeof PRODUCT_SCHEDULE_TIMEZONE;data_as_of:number }
export interface DemandReviewContextDto { demand_batch_id:string;demand_version:number;status:'SUBMITTED';seller_organization_id:string;store_id:string;product_id:string;product_version_no:number;product_name:string;task_type:DemandTaskType;target_quantity:number;reservation_deadline:number;order_deadline:number;cadence:OrderCadenceDto|null;can_publish:boolean;timezone:typeof PRODUCT_SCHEDULE_TIMEZONE;data_as_of:number }
export interface DemandOrderScheduleVersionDto extends OrderCadenceDto { schedule_version_id:string;version_no:number;demand_version:number;first_order_date:string;theoretical_last_order_date:string;affected_reservation_count:number;preview_hash:string;change_reason:string;changed_by_staff_id:string;created_at:number }
export interface StaffReservationScheduleItemDto { reservation_id:string;status:ReservationStatus;submitted_at:number;rank:number|null;planned_order_date:string|null;buyer_reference:string;buyer_customer_id:string|null;buyer_display_name:string|null;actual_order_status:string|null;actual_order_date:string|null }
export interface StaffReservationSchedulePageDto { demand:{demand_batch_id:string;product_id:string;product_name:string;target_quantity:number;effective_reservation_count:number;order_deadline:number;demand_version:number;schedule:DemandOrderScheduleVersionDto|null};items:readonly StaffReservationScheduleItemDto[];next_cursor:string|null;timezone:typeof PRODUCT_SCHEDULE_TIMEZONE;sorting:'submitted_at ASC, id ASC';data_as_of:number }
export interface DemandSchedulePreviewDto extends OrderCadenceDto { demand_batch_id:string;expected_version:number;current_schedule_version:number|null;first_order_date:string;theoretical_last_order_date:string;order_deadline_date:string;effective_reservation_count:number;affected_reservation_count:number;before_first_order_date:string|null;before_theoretical_last_order_date:string|null;preview_hash:string;timezone:typeof PRODUCT_SCHEDULE_TIMEZONE;data_as_of:number }
export interface ConfirmDemandScheduleResult { demand_batch_id:string;demand_version:number;schedule:DemandOrderScheduleVersionDto;replayed:boolean }
