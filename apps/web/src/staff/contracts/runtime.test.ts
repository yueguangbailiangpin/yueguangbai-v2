import { describe, expect, it } from 'vitest';
import {
  demandReviewContextSchema,
  staffReservationSchedulePageSchema,
  staffWorkItemsSchema,
} from './runtime';

const item = {
  work_item_id: 'work-1', work_type: 'REVIEW_DECISION',
  source_entity_type: 'REVIEW_CASE', source_entity_id: 'review-1',
  buyer_customer_id: 'buyer-1', seller_organization_id: 'seller-1', store_id: 'store-1',
  duty_code: 'BUYER_AFTER_SALES_OWNER', fixed_assignment_id: 'assignment-1', assigned_staff_id: 'staff-1',
  status: 'OPEN', version: 1, created_at: 1, updated_at: 1, completed_at: null, cancelled_at: null,
};

describe('Staff workbench runtime DTOs', () => {
  it('accepts the bounded cursor page', () => {
    expect(staffWorkItemsSchema.parse({ work_items: [item], next_cursor: 'opaque' }).work_items).toHaveLength(1);
  });

  it.each(['object_key', 'session_token', 'password_hash', 'drive_file_id'])('rejects sensitive/unknown field %s', (field) => {
    expect(staffWorkItemsSchema.safeParse({ work_items: [{ ...item, [field]: 'secret' }], next_cursor: null }).success).toBe(false);
  });

  it.each(['internal_notes', 'financial_snapshot', 'other_buyer_private_wechat'])(
    'rejects scheduling DTO leakage %s',
    (field) => {
      const page = {
        demand: { demand_batch_id: 'demand-1', product_id: 'product-1',
          product_name: '产品', target_quantity: 1, effective_reservation_count: 1,
          order_deadline: 1, demand_version: 1, schedule: null },
        items: [{ reservation_id: 'reservation-1', status: 'APPROVED', submitted_at: 1,
          rank: 1, planned_order_date: null, buyer_reference: 'B001',
          buyer_customer_id: null, buyer_display_name: null,
          actual_order_status: null, actual_order_date: null, [field]: 'secret' }],
        next_cursor: null, timezone: 'Asia/Shanghai',
        sorting: 'submitted_at ASC, id ASC', data_as_of: 1,
      };
      expect(staffReservationSchedulePageSchema.safeParse({ page }).success).toBe(false);
    },
  );

  it('accepts only the bounded authoritative demand review context', () => {
    const reviewContext = {
      demand_batch_id: 'demand-1', demand_version: 2, status: 'SUBMITTED',
      seller_organization_id: 'seller-1', store_id: 'store-1',
      product_id: 'product-1', product_version_no: 3, product_name: '产品',
      task_type: 'IMAGE', target_quantity: 10, reservation_deadline: 1,
      order_deadline: 2, cadence: { order_interval_days: 2, orders_per_run: 5 },
      can_publish: true,
      timezone: 'Asia/Shanghai', data_as_of: 1,
    };
    expect(demandReviewContextSchema.parse({ review_context: reviewContext })
      .review_context.demand_version).toBe(2);
    expect(demandReviewContextSchema.safeParse({ review_context: {
      ...reviewContext, work_item_version: 99,
    } }).success).toBe(false);
  });
});
