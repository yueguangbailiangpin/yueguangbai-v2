import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import {
  invitationViewSchema,
  refundPaymentMutationSchema,
  refundReversalMutationSchema,
  settlementPayablesSchema,
  settlementPaymentMutationSchema,
  settlementPaymentsSchema,
  settlementSummarySchema,
  staffBuyerRefundSchema,
  staffBuyerRefundListSchema,
  staffSearchSchema,
  staffOrderEvidenceSchema,
  staffOrderEvidencePreflightSchema,
  staffReviewSchema,
  staffReviewValueSchema,
  staffWorkItemsSchema,
  
  
  
  
  adminDashboardSummarySchema,
  demandReviewContextSchema,
  demandReviewMutationSchema,
  demandScheduleConfirmationSchema,
  demandSchedulePreviewSchema,
  mainImageMutationSchema,
  productVersionMutationSchema,
  staffProductDetailSchema,
  staffProductPageSchema,
  staffReservationSchedulePageSchema,
  staffAccessOverviewSchema,
  staffAccessMutationSchema,
  staffFormalOrderDetailSchema,
  staffSellerPrincipalRatePoliciesResponseSchema,
  staffSellerPrincipalRatePolicyMutationSchema,
  internalFinanceOrderDetailSchema,
  staffRateCenterSchema,
  staffRateCenterBaseMutationSchema,
  staffSellerServiceFeesSchema,
  staffSellerServiceFeeMutationSchema,
  reservationReopenSchema,
} from '../contracts/runtime';

const orderMutationSchema = z.union([
  z
    .object({
      submission_id: z.string(),
      reservation_id: z.string(),
      buyer_customer_id: z.string(),
      marketplace: z.literal('AMAZON_JP'),
      status: z.literal('CHANGES_REQUESTED'),
      version: z.number().int(),
      current_evidence_version_no: z.number().int(),
      current_evidence_version_id: z.string(),
      replayed: z.boolean(),
      public_change_reason: z.string(),
    })
    .strict(),
  z
    .object({
      formal_order_id: z.string(),
      order_evidence_submission_id: z.string(),
      status: z.literal('CONFIRMED'),
      version: z.number().int(),
      reference_order_amount_jpy: z.string(),
      final_paid_jpy: z.string(),
      price_difference_jpy: z.string(),
      price_mismatch_acknowledged: z.boolean(),
      confirmed_at: z.number().int(),
      replayed: z.boolean(),
    })
    .strict(),
]);
const reviewMutationSchema = z
  .object({
    review: z.union([
      staffReviewValueSchema,
      z
        .object({
          review_case_id: z.string(),
          formal_order_id: z.string(),
          status: z.enum(['CHANGES_REQUESTED', 'REJECTED']),
          version: z.number().int(),
          current_evidence_version_no: z.number().int(),
          current_evidence_version_id: z.string(),
          replayed: z.boolean(),
        })
        .strict(),
      z
        .object({
          review_case_id: z.string(),
          formal_order_id: z.string(),
          status: z.literal('APPROVED'),
          version: z.number().int(),
          current_evidence_version_no: z.number().int(),
          current_evidence_version_id: z.string(),
          approved_event_id: z.string(),
          financial_events: z.array(
            z
              .object({
                event_id: z.string(),
                event_type: z.enum(['BUYER_REFUND_BECAME_DUE', 'SELLER_SERVICE_FEE_ACCRUED']),
                amount_cny_fen: z.string(),
                formal_order_financial_snapshot_id: z.string(),
              })
              .strict(),
          ),
          replayed: z.boolean(),
        })
        .strict(),
    ]),
  })
  .strict();

function read<T extends z.ZodType>(
  client: QueryClient,
  path: string,
  schema: T,
  signal?: AbortSignal,
) {
  return identityApiRequest('staff', client, {
    path,
    method: 'GET',
    schema,
    ...(signal ? { signal } : {}),
  });
}
function write<T extends z.ZodType>(
  client: QueryClient,
  path: string,
  body: unknown,
  schema: T,
  key: string,
  signal?: AbortSignal,
) {
  return identityApiRequest('staff', client, {
    path,
    method: 'POST',
    schema,
    body,
    headers: operationHeaders({ key, body }),
    ...(signal ? { signal } : {}),
  });
}

export const staffApi = Object.freeze({
  accessManagement: (client: QueryClient, signal?: AbortSignal) =>
    read(client, '/api/staff/access-management', staffAccessOverviewSchema, signal),
  changeStaffAccessStatus: (client: QueryClient, staffId: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/access-management/employees/${encodeURIComponent(staffId)}/status`,
      body,
      staffAccessMutationSchema,
      key,
    ),
  products: (
    client: QueryClient,
    input: { search: string; cursor: string | null },
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({ limit: '25' });
    if (input.search) query.set('search', input.search);
    if (input.cursor) query.set('cursor', input.cursor);
    return read(client, `/api/staff/catalog/products?${query}`, staffProductPageSchema, signal);
  },
  product: (client: QueryClient, id: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/catalog/products/${encodeURIComponent(id)}`,
      staffProductDetailSchema,
      signal,
    ),
  addProductVersion: (client: QueryClient, id: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/catalog/products/${encodeURIComponent(id)}/versions`,
      body,
      productVersionMutationSchema,
      key,
    ),
  linkMainImage: (client: QueryClient, versionId: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/catalog/product-versions/${encodeURIComponent(versionId)}/main-image`,
      body,
      mainImageMutationSchema,
      key,
    ),
  reopenReservation: (
    client: QueryClient,
    reservationId: string,
    body: { expected_version: number; reason: string },
  ) =>
    write(
      client,
      `/api/staff/reservations/${encodeURIComponent(reservationId)}/reopen`,
      body,
      reservationReopenSchema,
      crypto.randomUUID(),
    ),
  reservationSchedule: (
    client: QueryClient,
    id: string,
    cursor: string | null,
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({ limit: '50' });
    if (cursor) query.set('cursor', cursor);
    return read(
      client,
      `/api/staff/demand-batches/${encodeURIComponent(id)}/reservation-schedule?${query}`,
      staffReservationSchedulePageSchema,
      signal,
    );
  },
  previewDemandSchedule: (client: QueryClient, id: string, body: unknown, signal?: AbortSignal) =>
    identityApiRequest('staff', client, {
      path: `/api/staff/demand-batches/${encodeURIComponent(id)}/schedule/preview`,
      method: 'POST',
      schema: demandSchedulePreviewSchema,
      body,
      ...(signal ? { signal } : {}),
    }),
  confirmDemandSchedule: (client: QueryClient, id: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/demand-batches/${encodeURIComponent(id)}/schedule/confirm`,
      body,
      demandScheduleConfirmationSchema,
      key,
    ),
  demandReviewContext: (client: QueryClient, id: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/demand-batches/${encodeURIComponent(id)}/review-context`,
      demandReviewContextSchema,
      signal,
    ),
  reviewDemand: (client: QueryClient, id: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/demand-batches/${encodeURIComponent(id)}/review`,
      body,
      demandReviewMutationSchema,
      key,
    ),
  workItems: (
    client: QueryClient,
    query: { status: string; workType: string | null; cursor: string | null; limit?: number },
    signal?: AbortSignal,
  ) => {
    const parameters = new URLSearchParams({ status: query.status, limit: String(query.limit ?? 25) });
    if (query.workType) parameters.set('work_type', query.workType);
    if (query.cursor) parameters.set('cursor', query.cursor);
    return read(client, `/api/staff/me/work-items?${parameters}`, staffWorkItemsSchema, signal);
  },
  sellerPrincipalRatePolicies: (
    client: QueryClient,
    sourceCurrencyCode: string,
    sellerOrganizationId: string | null,
    signal?: AbortSignal,
    asOf?: number,
  ) => {
    const parameters = new URLSearchParams({ source_currency_code: sourceCurrencyCode });
    if (sellerOrganizationId !== null) {
      parameters.set('seller_organization_id', sellerOrganizationId);
    }
    if (asOf !== undefined) {
      parameters.set('as_of', String(asOf));
    }
    return read(
      client,
      `/api/staff/seller-principal-rate-policies?${parameters}`,
      staffSellerPrincipalRatePoliciesResponseSchema,
      signal,
    ).then((response) => ({
      data: response.data.policies,
      requestId: response.requestId,
    }));
  },
  saveSellerPrincipalRatePolicy: (client: QueryClient, body: unknown, key: string) =>
    write(
      client,
      '/api/staff/seller-principal-rate-policies/save',
      body,
      staffSellerPrincipalRatePolicyMutationSchema,
      key,
    ),
  sellerServiceFees: (
    client: QueryClient,
    sellerOrganizationId: string,
    signal?: AbortSignal,
    asOf?: number,
  ) => {
    const parameters = new URLSearchParams({
      seller_organization_id: sellerOrganizationId,
    });
    if (asOf !== undefined) {
      parameters.set('as_of', String(asOf));
    }
    return read(
      client,
      `/api/staff/seller-service-fees?${parameters}`,
      staffSellerServiceFeesSchema,
      signal,
    );
  },
  saveSellerServiceFee: (client: QueryClient, body: unknown, key: string) =>
    write(
      client,
      '/api/staff/seller-service-fees',
      body,
      staffSellerServiceFeeMutationSchema,
      key,
    ),
  rateCenter: (
    client: QueryClient,
    businessDate: string,
    sellerOrganizationId: string | null,
    signal?: AbortSignal,
    asOf?: number,
  ) => {
    const parameters = new URLSearchParams({ business_date: businessDate });
    if (sellerOrganizationId !== null)
      parameters.set('seller_organization_id', sellerOrganizationId);
    if (asOf !== undefined) parameters.set('as_of', String(asOf));
    return read(client, `/api/staff/rate-center?${parameters}`, staffRateCenterSchema, signal);
  },
  financeOrderDetail: (client: QueryClient, formalOrderId: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/finance/orders/${encodeURIComponent(formalOrderId)}`,
      internalFinanceOrderDetailSchema,
      signal,
    ).then((response) => ({
      data: response.data.order,
      requestId: response.requestId,
    })),
  formalOrderDetail: (client: QueryClient, formalOrderId: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/formal-orders/${encodeURIComponent(formalOrderId)}`,
      staffFormalOrderDetailSchema,
      signal,
    ),
  saveOrderDayBaseRate: (client: QueryClient, body: unknown, key: string) =>
    write(
      client,
      '/api/staff/rate-center/base-rates',
      body,
      staffRateCenterBaseMutationSchema,
      key,
    ),
  orderEvidence: (client: QueryClient, id: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/order-evidence/${encodeURIComponent(id)}`,
      staffOrderEvidenceSchema,
      signal,
    ),
  orderEvidencePreflight: (client: QueryClient, id: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/order-evidence/${encodeURIComponent(id)}/preflight`,
      staffOrderEvidencePreflightSchema,
      signal,
    ),
  mutateOrderEvidence: (
    client: QueryClient,
    id: string,
    action: 'approve' | 'request-changes',
    body: unknown,
    key: string,
  ) =>
    write(
      client,
      `/api/staff/order-evidence/${encodeURIComponent(id)}/${action}`,
      body,
      orderMutationSchema,
      key,
    ),
  review: (client: QueryClient, id: string, signal?: AbortSignal) =>
    read(client, `/api/staff/reviews/${encodeURIComponent(id)}`, staffReviewSchema, signal),
  mutateReview: (
    client: QueryClient,
    id: string,
    action: 'approve' | 'reject' | 'request-changes',
    body: unknown,
    key: string,
  ) =>
    write(
      client,
      `/api/staff/reviews/${encodeURIComponent(id)}/${action}`,
      body,
      reviewMutationSchema,
      key,
    ),
  search: (client: QueryClient, query: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/search?q=${encodeURIComponent(query)}`,
      staffSearchSchema,
      signal,
    ),
  buyerRefunds: (client: QueryClient, cursor: string | null, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/buyer-refunds${cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
      staffBuyerRefundListSchema,
      signal,
    ),
  buyerRefund: (client: QueryClient, id: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/buyer-refunds/${encodeURIComponent(id)}`,
      staffBuyerRefundSchema,
      signal,
    ),
  recordRefundPayment: (client: QueryClient, id: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/buyer-refunds/${encodeURIComponent(id)}/payments`,
      body,
      refundPaymentMutationSchema,
      key,
    ),
  reverseRefundPayment: (
    client: QueryClient,
    id: string,
    paymentId: string,
    body: unknown,
    key: string,
  ) =>
    write(
      client,
      `/api/staff/buyer-refunds/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/reversals`,
      body,
      refundReversalMutationSchema,
      key,
    ),
  settlementSummary: (client: QueryClient, organizationId: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/summary`,
      settlementSummarySchema,
      signal,
    ),
  settlementPayables: (client: QueryClient, organizationId: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/payables?limit=25`,
      settlementPayablesSchema,
      signal,
    ),
  settlementPayments: (client: QueryClient, organizationId: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/payments?limit=25`,
      settlementPaymentsSchema,
      signal,
    ),
  recordSellerPayment: (client: QueryClient, organizationId: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/payments`,
      body,
      settlementPaymentMutationSchema,
      key,
    ),
  allocateSellerPayment: (client: QueryClient, paymentId: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/seller-payments/${encodeURIComponent(paymentId)}/allocations`,
      body,
      settlementPaymentMutationSchema,
      key,
    ),
  reverseSellerPayment: (client: QueryClient, paymentId: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/seller-payments/${encodeURIComponent(paymentId)}/reverse`,
      body,
      settlementPaymentMutationSchema,
      key,
    ),
  invitation: (client: QueryClient, id: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/customer-security/buyer-invitations/${encodeURIComponent(id)}`,
      invitationViewSchema,
      signal,
    ),
  revokeInvitation: (client: QueryClient, id: string, version: number, key: string) =>
    write(
      client,
      `/api/staff/customer-security/buyer-invitations/${encodeURIComponent(id)}/revoke`,
      { expected_version: version },
      invitationViewSchema,
      key,
    ),
  adminDashboardSummary: (
    client: QueryClient,
    window: 'TODAY' | 'WEEK' | 'MONTH',
    signal?: AbortSignal,
  ) =>
    read(
      client,
      `/api/staff/admin-business-dashboard/summary?window=${window}`,
      adminDashboardSummarySchema,
      signal,
    ),
});
