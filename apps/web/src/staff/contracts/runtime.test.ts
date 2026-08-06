import { describe, expect, it } from 'vitest';
import { staffWorkItemsSchema } from './runtime';

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
});
