import { z } from 'zod';
import type { StaffAuthApiAdapter, StaffSession } from '../auth/staff/staff-auth-api';
import { settlementPayablesSchema, settlementPaymentsSchema, settlementSummarySchema } from './contracts/runtime';
import type { StaffWorkItem } from './contracts/runtime';

export type SettlementSummary = z.output<typeof settlementSummarySchema>['settlement'];
export type SettlementPayable = z.output<typeof settlementPayablesSchema>['items'][number];
export type SettlementPayment = z.output<typeof settlementPaymentsSchema>['items'][number];

export function staffTestAdapter(value: StaffSession): StaffAuthApiAdapter {
  return {
    bootstrap: async () => ({ data: { session: value, access_email: 'staff@example.com' }, requestId: 'bootstrap' }),
    readSession: async () => ({ data: { session: value }, requestId: 'session' }),
    logout: async () => ({ data: { logged_out: true, all_devices_logged_out: false }, requestId: 'logout' }),
    logoutAll: async () => ({ data: { logged_out: true, all_devices_logged_out: true, session_version: 2 }, requestId: 'logout-all' }),
  };
}

export function staffTestSession(
  role: StaffSession['role']['code'],
  permissions: string[],
): StaffSession {
  const roles = {
    owner: { code: 'owner', display_name: '总管理员' },
    acquisition: { code: 'acquisition', display_name: '获客' },
    pre_sales: { code: 'pre_sales', display_name: '售前' },
    seller_ops: { code: 'seller_ops', display_name: '卖家对接' },
    buyer_refund: { code: 'buyer_refund', display_name: '买家返款' },
  } as const;
  return {
    staff_id: 'staff-1', display_name: '测试员工', role: roles[role], permissions,
    data_scope: role === 'owner'
      ? { type: 'GLOBAL', marketplaceCodes: [], buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [] }
      : { type: 'ASSIGNED_SELLER_ORGANIZATIONS', marketplaceCodes: ['AMAZON_JP'], buyerCustomerIds: [], sellerOrganizationIds: ['seller-1'], teamIds: [] },
    authorization_version: 1, session_version: 1, expires_at: Date.now() + 100_000,
  };
}

export const staffTestWorkItem: StaffWorkItem = {
  work_item_id: 'work-1', work_type: 'ORDER_EVIDENCE_REVIEW',
  source_entity_type: 'ORDER_EVIDENCE', source_entity_id: 'evidence-1',
  buyer_customer_id: 'buyer-1', seller_organization_id: 'seller-1', store_id: 'store-1',
  duty_code: 'BUYER_PRE_SALES_OWNER', fixed_assignment_id: 'assignment-1', assigned_staff_id: 'staff-1',
  status: 'OPEN', version: 1, created_at: 1_787_000_000_000, updated_at: 1_787_000_000_000,
  completed_at: null, cancelled_at: null,
};

export const sellerSettlementWorkItem: StaffWorkItem = {
  ...staffTestWorkItem,
  work_item_id: 'work-seller', work_type: 'PRODUCT_APPLICATION_REVIEW',
  source_entity_type: 'PRODUCT_APPLICATION', source_entity_id: 'product-1',
};

export const settlementSummary = {
  outstanding_principal_cny_fen: '80000', outstanding_service_fee_cny_fen: '12000',
  total_outstanding_cny_fen: '92000', unallocated_credit_cny_fen: '3000',
} satisfies SettlementSummary;

export const settlementPayables = [
  { payable_id: 'principal-1', formal_order_id: 'order-1', amazon_order_number: 'ORDER-1', store: { id: 'store-1', display_name: '美国店铺' }, product: { id: 'product-1', asin: 'B000000001', name: '产品' }, payable_type: 'SELLER_PRINCIPAL' as const, due_amount_cny_fen: '80000', paid_amount_cny_fen: '0', outstanding_amount_cny_fen: '80000', status: 'UNPAID' as const, due_at: 1_787_000_000_000, created_at: 1_787_000_000_000 },
  { payable_id: 'fee-1', formal_order_id: 'order-1', amazon_order_number: 'ORDER-1', store: { id: 'store-1', display_name: '美国店铺' }, product: { id: 'product-1', asin: 'B000000001', name: '产品' }, payable_type: 'SELLER_SERVICE_FEE' as const, due_amount_cny_fen: '12000', paid_amount_cny_fen: '0', outstanding_amount_cny_fen: '12000', status: 'UNPAID' as const, due_at: 1_787_000_000_000, created_at: 1_787_000_000_000 },
] satisfies SettlementPayable[];

export const settlementPayment = {
  payment_id: 'payment-1', amount_cny_fen: '3000', paid_at: 1_787_000_000_000,
  recorded_at: 1_787_000_000_000, allocated_amount_cny_fen: '0',
  unallocated_amount_cny_fen: '3000', status: 'UNALLOCATED' as const, version: 1,
  allocations: [],
  proof: { file_object_id: 'proof-1', file_version: 2, purpose: 'SELLER_SETTLEMENT_PROOF' as const, visibility: 'INTERNAL_ONLY' as const },
} satisfies SettlementPayment;
