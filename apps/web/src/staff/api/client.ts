import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import {
  invitationViewSchema, refundPaymentMutationSchema, refundReversalMutationSchema,
  settlementPayablesSchema, settlementPaymentMutationSchema, settlementPaymentsSchema,
  settlementSummarySchema,
  staffBuyerRefundSchema, staffOrderEvidenceSchema, staffReviewSchema,
  staffReviewValueSchema, staffWorkItemsSchema,
  acquisitionAssignmentSchema, acquisitionChannelSchema,
  acquisitionConsultationEventSchema, acquisitionConsultationSchema,
  acquisitionFunnelSchema, acquisitionLeadSchema,
  adminDashboardSummarySchema,
  demandReviewContextSchema, demandReviewMutationSchema,
  demandScheduleConfirmationSchema, demandSchedulePreviewSchema,
  productVersionMutationSchema, staffProductDetailSchema,
  staffProductPageSchema, staffReservationSchedulePageSchema,
  staffAccessOverviewSchema, staffAccessMutationSchema,
  staffSellerPrincipalRatePoliciesResponseSchema, staffSellerPrincipalRatePolicyMutationSchema,
} from '../contracts/runtime';

const acquisitionChannelResultSchema = z.object({ channel: acquisitionChannelSchema, replayed: z.boolean() }).strict();
const acquisitionAssignmentResultSchema = z.object({ assignment: acquisitionAssignmentSchema, replayed: z.boolean() }).strict();
const acquisitionConsultationResultSchema = z.object({ consultation: acquisitionConsultationSchema, replayed: z.boolean() }).strict();
const acquisitionLeadResultSchema = z.object({ lead: acquisitionLeadSchema, replayed: z.boolean() }).strict();

const orderMutationSchema = z.union([
  z.object({ submission_id: z.string(), reservation_id: z.string(), buyer_customer_id: z.string(),
    marketplace: z.literal('JP'), status: z.literal('CHANGES_REQUESTED'), version: z.number().int(),
    current_evidence_version_no: z.number().int(), current_evidence_version_id: z.string(),
    replayed: z.boolean(), public_change_reason: z.string() }).strict(),
  z.object({ formal_order_id: z.string(), order_evidence_submission_id: z.string(),
    status: z.literal('CONFIRMED'), version: z.number().int(), reference_order_amount_jpy: z.string(),
    final_paid_jpy: z.string(), price_difference_jpy: z.string(), price_mismatch_acknowledged: z.boolean(),
    confirmed_at: z.number().int(), replayed: z.boolean() }).strict(),
]);
const reviewMutationSchema = z.object({ review: z.union([
  staffReviewValueSchema,
  z.object({ review_case_id: z.string(), formal_order_id: z.string(),
    status: z.enum(['CHANGES_REQUESTED', 'REJECTED']), version: z.number().int(),
    current_evidence_version_no: z.number().int(), current_evidence_version_id: z.string(), replayed: z.boolean() }).strict(),
  z.object({ review_case_id: z.string(), formal_order_id: z.string(), status: z.literal('APPROVED'),
    version: z.number().int(), current_evidence_version_no: z.number().int(), current_evidence_version_id: z.string(),
    approved_event_id: z.string(), financial_events: z.array(z.object({ event_id: z.string(),
      event_type: z.enum(['BUYER_REFUND_BECAME_DUE', 'SELLER_SERVICE_FEE_ACCRUED']),
      amount_cny_fen: z.string(), formal_order_financial_snapshot_id: z.string() }).strict()), replayed: z.boolean() }).strict(),
]) }).strict();

function read<T extends z.ZodType>(client: QueryClient, path: string, schema: T, signal?: AbortSignal) {
  return identityApiRequest('staff', client, { path, method: 'GET', schema, ...(signal ? { signal } : {}) });
}
function write<T extends z.ZodType>(client: QueryClient, path: string, body: unknown, schema: T, key: string, signal?: AbortSignal) {
  return identityApiRequest('staff', client, { path, method: 'POST', schema, body,
    headers: operationHeaders({ key, body }), ...(signal ? { signal } : {}) });
}

export const staffApi = Object.freeze({
  accessManagement: (client: QueryClient, signal?: AbortSignal) => read(
    client, '/api/staff/access-management', staffAccessOverviewSchema, signal,
  ),
  changeStaffAccessStatus: (
    client: QueryClient, staffId: string, body: unknown, key: string,
  ) => write(client,
    `/api/staff/access-management/employees/${encodeURIComponent(staffId)}/status`,
    body, staffAccessMutationSchema, key),
  changeStaffRole: (
    client: QueryClient, staffId: string, body: unknown, key: string,
  ) => write(client,
    `/api/staff/access-management/employees/${encodeURIComponent(staffId)}/role`,
    body, staffAccessMutationSchema, key),
  products: (client: QueryClient, input: { search: string; cursor: string|null }, signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: '25' });
    if (input.search) query.set('search', input.search);
    if (input.cursor) query.set('cursor', input.cursor);
    return read(client, `/api/staff/catalog/products?${query}`, staffProductPageSchema, signal);
  },
  product: (client: QueryClient, id: string, signal?: AbortSignal) => read(client,
    `/api/staff/catalog/products/${encodeURIComponent(id)}`, staffProductDetailSchema, signal),
  addProductVersion: (client: QueryClient, id: string, body: unknown, key: string) => write(client,
    `/api/staff/catalog/products/${encodeURIComponent(id)}/versions`, body,
    productVersionMutationSchema, key),
  reservationSchedule: (client: QueryClient, id: string, cursor: string|null, signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: '50' });
    if (cursor) query.set('cursor', cursor);
    return read(client, `/api/staff/demand-batches/${encodeURIComponent(id)}/reservation-schedule?${query}`,
      staffReservationSchedulePageSchema, signal);
  },
  previewDemandSchedule: (client: QueryClient, id: string, body: unknown, signal?: AbortSignal) =>
    identityApiRequest('staff', client, {
      path: `/api/staff/demand-batches/${encodeURIComponent(id)}/schedule/preview`,
      method: 'POST', schema: demandSchedulePreviewSchema, body,
      ...(signal ? { signal } : {}),
    }),
  confirmDemandSchedule: (client: QueryClient, id: string, body: unknown, key: string) => write(
    client, `/api/staff/demand-batches/${encodeURIComponent(id)}/schedule/confirm`,
    body, demandScheduleConfirmationSchema, key,
  ),
  demandReviewContext: (client: QueryClient, id: string, signal?: AbortSignal) => read(
    client, `/api/staff/demand-batches/${encodeURIComponent(id)}/review-context`,
    demandReviewContextSchema, signal,
  ),
  reviewDemand: (client: QueryClient, id: string, body: unknown, key: string) => write(
    client, `/api/staff/demand-batches/${encodeURIComponent(id)}/review`,
    body, demandReviewMutationSchema, key,
  ),
  workItems: (client: QueryClient, query: { status: string; workType: string | null; cursor: string | null }, signal?: AbortSignal) => {
    const parameters = new URLSearchParams({ status: query.status, limit: '25' });
    if (query.workType) parameters.set('work_type', query.workType);
    if (query.cursor) parameters.set('cursor', query.cursor);
    return read(client, `/api/staff/me/work-items?${parameters}`, staffWorkItemsSchema, signal);
  },
  sellerPrincipalRatePolicies: (client: QueryClient, sourceCurrencyCode: string,
    sellerOrganizationId: string | null, signal?: AbortSignal) => {
    const parameters = new URLSearchParams({ source_currency_code: sourceCurrencyCode });
    if (sellerOrganizationId !== null) {
      parameters.set('seller_organization_id', sellerOrganizationId);
    }
    return read(client,
      `/api/staff/seller-principal-rate-policies?${parameters}`,
      staffSellerPrincipalRatePoliciesResponseSchema, signal)
      .then((response) => ({
        data: response.data.policies,
        requestId: response.requestId,
      }));
  },
  submitSellerPrincipalRatePolicy: (client: QueryClient, body: unknown, key: string) => write(
    client, '/api/staff/seller-principal-rate-policies/submit', body,
    staffSellerPrincipalRatePolicyMutationSchema, key),
  confirmSellerPrincipalRatePolicy: (client: QueryClient, id: string, body: unknown, key: string) => write(
    client, `/api/staff/seller-principal-rate-policies/${encodeURIComponent(id)}/confirm`, body,
    staffSellerPrincipalRatePolicyMutationSchema, key),
  rejectSellerPrincipalRatePolicy: (client: QueryClient, id: string, body: unknown, key: string) => write(
    client, `/api/staff/seller-principal-rate-policies/${encodeURIComponent(id)}/reject`, body,
    staffSellerPrincipalRatePolicyMutationSchema, key),
  orderEvidence: (client: QueryClient, id: string, signal?: AbortSignal) => read(client, `/api/staff/order-evidence/${encodeURIComponent(id)}`, staffOrderEvidenceSchema, signal),
  mutateOrderEvidence: (client: QueryClient, id: string, action: 'approve' | 'request-changes', body: unknown, key: string) => write(client, `/api/staff/order-evidence/${encodeURIComponent(id)}/${action}`, body, orderMutationSchema, key),
  review: (client: QueryClient, id: string, signal?: AbortSignal) => read(client, `/api/staff/reviews/${encodeURIComponent(id)}`, staffReviewSchema, signal),
  mutateReview: (client: QueryClient, id: string, action: 'approve' | 'reject' | 'request-changes', body: unknown, key: string) => write(client, `/api/staff/reviews/${encodeURIComponent(id)}/${action}`, body, reviewMutationSchema, key),
  buyerRefund: (client: QueryClient, id: string, signal?: AbortSignal) => read(client, `/api/staff/buyer-refunds/${encodeURIComponent(id)}`, staffBuyerRefundSchema, signal),
  recordRefundPayment: (client: QueryClient, id: string, body: unknown, key: string) => write(client, `/api/staff/buyer-refunds/${encodeURIComponent(id)}/payments`, body, refundPaymentMutationSchema, key),
  reverseRefundPayment: (client: QueryClient, id: string, paymentId: string, body: unknown, key: string) => write(client, `/api/staff/buyer-refunds/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/reversals`, body, refundReversalMutationSchema, key),
  settlementSummary: (client: QueryClient, organizationId: string, signal?: AbortSignal) => read(client, `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/summary`, settlementSummarySchema, signal),
  settlementPayables: (client: QueryClient, organizationId: string, signal?: AbortSignal) => read(client, `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/payables?limit=25`, settlementPayablesSchema, signal),
  settlementPayments: (client: QueryClient, organizationId: string, signal?: AbortSignal) => read(client, `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/payments?limit=25`, settlementPaymentsSchema, signal),
  recordSellerPayment: (client: QueryClient, organizationId: string, body: unknown, key: string) => write(client, `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/payments`, body, settlementPaymentMutationSchema, key),
  allocateSellerPayment: (client: QueryClient, paymentId: string, body: unknown, key: string) => write(client, `/api/staff/seller-payments/${encodeURIComponent(paymentId)}/allocations`, body, settlementPaymentMutationSchema, key),
  reverseSellerPayment: (client: QueryClient, paymentId: string, body: unknown, key: string) => write(client, `/api/staff/seller-payments/${encodeURIComponent(paymentId)}/reverse`, body, settlementPaymentMutationSchema, key),
  invitation: (client: QueryClient, id: string, signal?: AbortSignal) => read(client, `/api/staff/customer-security/buyer-invitations/${encodeURIComponent(id)}`, invitationViewSchema, signal),
  revokeInvitation: (client: QueryClient, id: string, version: number, key: string) => write(client, `/api/staff/customer-security/buyer-invitations/${encodeURIComponent(id)}/revoke`, { expected_version: version }, invitationViewSchema, key),
  acquisitionChannels: (client: QueryClient, signal?: AbortSignal) => read(client,
    '/api/staff/acquisition/channels', z.object({ channels: z.array(acquisitionChannelSchema) }).strict(), signal),
  createAcquisitionChannel: (client: QueryClient, body: unknown, key: string) => write(client,
    '/api/staff/acquisition/channels', body, acquisitionChannelResultSchema, key),
  disableAcquisitionChannel: (client: QueryClient, id: string, body: unknown, key: string) => write(client,
    `/api/staff/acquisition/channels/${encodeURIComponent(id)}/disable`, body, acquisitionChannelResultSchema, key),
  acquisitionAssignments: (client: QueryClient, signal?: AbortSignal) => read(client,
    '/api/staff/acquisition/channel-assignments', z.object({ assignments: z.array(acquisitionAssignmentSchema) }).strict(), signal),
  createAcquisitionAssignment: (client: QueryClient, body: unknown, key: string) => write(client,
    '/api/staff/acquisition/channel-assignments', body, acquisitionAssignmentResultSchema, key),
  revokeAcquisitionAssignment: (client: QueryClient, id: string, body: unknown, key: string) => write(client,
    `/api/staff/acquisition/channel-assignments/${encodeURIComponent(id)}/revoke`, body, acquisitionAssignmentResultSchema, key),
  acquisitionConsultations: (client: QueryClient, from: string, to: string, signal?: AbortSignal) => read(client,
    `/api/staff/acquisition/consultations?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`,
    z.object({ consultations: z.array(acquisitionConsultationSchema) }).strict(), signal),
  acquisitionConsultationHistory: (client: QueryClient, id: string, signal?: AbortSignal) => read(client,
    `/api/staff/acquisition/consultations/${encodeURIComponent(id)}/history`,
    z.object({ history: z.array(acquisitionConsultationEventSchema) }).strict(), signal),
  recordAcquisitionConsultation: (client: QueryClient, body: unknown, key: string) => write(client,
    '/api/staff/acquisition/consultations', body, acquisitionConsultationResultSchema, key),
  acquisitionLeads: (client: QueryClient, leadType: 'BUYER'|'SELLER'|null, signal?: AbortSignal) => {
    const parameters = new URLSearchParams({ limit: '50' });
    if (leadType) parameters.set('lead_type', leadType);
    return read(client, `/api/staff/acquisition/leads?${parameters}`,
      z.object({ items: z.array(acquisitionLeadSchema), next_cursor: z.string().nullable() }).strict(), signal);
  },
  createAcquisitionLead: (client: QueryClient, body: unknown, key: string) => write(client,
    '/api/staff/acquisition/leads', body, acquisitionLeadResultSchema, key),
  invalidateAcquisitionLead: (client: QueryClient, id: string, body: unknown, key: string) => write(client,
    `/api/staff/acquisition/leads/${encodeURIComponent(id)}/invalidate`, body, acquisitionLeadResultSchema, key),
  acquisitionFunnel: (client: QueryClient, from: string, to: string, signal?: AbortSignal) => read(client,
    `/api/staff/acquisition/funnel?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`,
    z.object({ funnel: acquisitionFunnelSchema }).strict(), signal),
  adminDashboardSummary: (client: QueryClient, window: 'TODAY'|'WEEK'|'MONTH', signal?: AbortSignal) => read(client,
    `/api/staff/admin-business-dashboard/summary?window=${window}`,
    adminDashboardSummarySchema, signal),
});
