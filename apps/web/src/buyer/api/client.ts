import type { QueryClient } from '@tanstack/react-query';
import { operationHeaders } from '../../api/idempotency';
import { identityApiRequest } from '../../api/identity-request';
import {
  buyerMeSchema,
  demandDetailSchema,
  demandsPageSchema,
  eligibleEvidencePageSchema,
  eligibleReviewOrdersPageSchema,
  formalOrderDetailSchema,
  formalOrdersPageSchema,
  instructionResponseSchema,
  instructionStateResponseSchema,
  orderEvidenceDetailSchema,
  orderEvidenceMutationSchema,
  orderEvidencePageSchema,
  refundDetailSchema,
  refundReminderMutationSchema,
  refundsPageSchema,
  reservationDetailSchema,
  reservationMutationSchema,
  reservationsPageSchema,
  reviewDetailSchema,
  reviewMutationSchema,
  reviewsPageSchema,
} from '../contracts/runtime';

type Signal = AbortSignal | undefined;

function get<T extends Parameters<typeof identityApiRequest>[2]['schema']>(
  client: QueryClient,
  path: string,
  schema: T,
  signal?: Signal,
) {
  return identityApiRequest('buyer', client, {
    path,
    method: 'GET',
    schema,
    ...(signal ? { signal } : {}),
  });
}

function post<T extends Parameters<typeof identityApiRequest>[2]['schema']>(
  client: QueryClient,
  path: string,
  schema: T,
  body: unknown,
  idempotencyKey: string,
  signal?: Signal,
) {
  return identityApiRequest('buyer', client, {
    path,
    method: 'POST',
    schema,
    body,
    headers: operationHeaders({ key: idempotencyKey, body }),
    ...(signal ? { signal } : {}),
  });
}

function patch<T extends Parameters<typeof identityApiRequest>[2]['schema']>(
  client: QueryClient,
  path: string,
  schema: T,
  body: unknown,
) {
  return identityApiRequest('buyer', client, {
    path,
    method: 'PATCH',
    schema,
    body,
  });
}

export const buyerApi = Object.freeze({
  me: (client: QueryClient, signal?: Signal) =>
    get(client, '/api/buyer-portal/me', buyerMeSchema, signal),
  updateRefundAccount: (
    client: QueryClient,
    accountName: string,
    accountIdentifier: string,
  ) =>
    patch(client, '/api/buyer-portal/me/refund-account', buyerMeSchema, {
      account_name: accountName,
      account_identifier: accountIdentifier,
    }),
  demands: (client: QueryClient, query = 'limit=20', signal?: Signal) =>
    get(client, `/api/buyer-portal/demands?${query}`, demandsPageSchema, signal),
  demand: (client: QueryClient, id: string, signal?: Signal) =>
    get(client, `/api/buyer-portal/demands/${encodeURIComponent(id)}`, demandDetailSchema, signal),
  reservations: (client: QueryClient, query = 'limit=20', signal?: Signal) =>
    get(client, `/api/buyer-portal/reservations?${query}`, reservationsPageSchema, signal),
  reservation: (client: QueryClient, id: string, signal?: Signal) =>
    get(
      client,
      `/api/buyer-portal/reservations/${encodeURIComponent(id)}`,
      reservationDetailSchema,
      signal,
    ),
  createReservation: (
    client: QueryClient,
    id: string,
    body: { expected_demand_version: number; accepted_buyer_self_pay_bps: number },
    key: string,
    signal?: Signal,
  ) =>
    post(
      client,
      `/api/buyer-portal/demands/${encodeURIComponent(id)}/reservations`,
      reservationMutationSchema,
      body,
      key,
      signal,
    ),
  cancelReservation: (
    client: QueryClient,
    id: string,
    expectedVersion: number,
    key: string,
    signal?: Signal,
  ) =>
    post(
      client,
      `/api/buyer-portal/reservations/${encodeURIComponent(id)}/cancel`,
      reservationMutationSchema,
      { expected_version: expectedVersion },
      key,
      signal,
    ),
  instructionState: (client: QueryClient, id: string, signal?: Signal) =>
    get(
      client,
      `/api/buyer-portal/reservations/${encodeURIComponent(id)}/order-instruction/state`,
      instructionStateResponseSchema,
      signal,
    ),
  instruction: (client: QueryClient, id: string, signal?: Signal) =>
    get(
      client,
      `/api/buyer-portal/reservations/${encodeURIComponent(id)}/order-instruction`,
      instructionResponseSchema,
      signal,
    ),
  evidenceEligible: (client: QueryClient, query = 'limit=20', signal?: Signal) =>
    get(
      client,
      `/api/buyer-portal/order-evidence/eligible-reservations?${query}`,
      eligibleEvidencePageSchema,
      signal,
    ),
  evidenceList: (client: QueryClient, query = 'limit=20', signal?: Signal) =>
    get(client, `/api/buyer-portal/order-evidence?${query}`, orderEvidencePageSchema, signal),
  evidence: (client: QueryClient, id: string, signal?: Signal) =>
    get(
      client,
      `/api/buyer-portal/order-evidence/${encodeURIComponent(id)}`,
      orderEvidenceDetailSchema,
      signal,
    ),
  submitEvidence: (client: QueryClient, body: unknown, key: string, signal?: Signal) =>
    post(
      client,
      '/api/buyer-portal/order-evidence',
      orderEvidenceMutationSchema,
      body,
      key,
      signal,
    ),
  resubmitEvidence: (
    client: QueryClient,
    id: string,
    body: unknown,
    key: string,
    signal?: Signal,
  ) =>
    post(
      client,
      `/api/buyer-portal/order-evidence/${encodeURIComponent(id)}/resubmit`,
      orderEvidenceMutationSchema,
      body,
      key,
      signal,
    ),
  withdrawEvidence: (
    client: QueryClient,
    id: string,
    version: number,
    key: string,
    signal?: Signal,
  ) =>
    post(
      client,
      `/api/buyer-portal/order-evidence/${encodeURIComponent(id)}/withdraw`,
      orderEvidenceMutationSchema,
      { expected_version: version },
      key,
      signal,
    ),
  formalOrders: (client: QueryClient, query = 'limit=20', signal?: Signal) =>
    get(client, `/api/buyer-portal/formal-orders?${query}`, formalOrdersPageSchema, signal),
  formalOrder: (client: QueryClient, id: string, signal?: Signal) =>
    get(
      client,
      `/api/buyer-portal/formal-orders/${encodeURIComponent(id)}`,
      formalOrderDetailSchema,
      signal,
    ),
  reviewEligible: (client: QueryClient, query = 'limit=20', signal?: Signal) =>
    get(
      client,
      `/api/buyer-portal/reviews/eligible-orders?${query}`,
      eligibleReviewOrdersPageSchema,
      signal,
    ),
  reviews: (client: QueryClient, query = 'limit=20', signal?: Signal) =>
    get(client, `/api/buyer-portal/reviews?${query}`, reviewsPageSchema, signal),
  review: (client: QueryClient, id: string, signal?: Signal) =>
    get(client, `/api/buyer-portal/reviews/${encodeURIComponent(id)}`, reviewDetailSchema, signal),
  submitReview: (client: QueryClient, body: unknown, key: string, signal?: Signal) =>
    post(client, '/api/buyer-portal/reviews', reviewMutationSchema, body, key, signal),
  resubmitReview: (client: QueryClient, id: string, body: unknown, key: string, signal?: Signal) =>
    post(
      client,
      `/api/buyer-portal/reviews/${encodeURIComponent(id)}/resubmit`,
      reviewMutationSchema,
      body,
      key,
      signal,
    ),
  withdrawReview: (
    client: QueryClient,
    id: string,
    version: number,
    key: string,
    signal?: Signal,
  ) =>
    post(
      client,
      `/api/buyer-portal/reviews/${encodeURIComponent(id)}/withdraw`,
      reviewMutationSchema,
      { expected_version: version },
      key,
      signal,
    ),
  refunds: (client: QueryClient, query = 'limit=20', signal?: Signal) =>
    get(client, `/api/buyer-portal/refunds?${query}`, refundsPageSchema, signal),
  refund: (client: QueryClient, id: string, signal?: Signal) =>
    get(client, `/api/buyer-portal/refunds/${encodeURIComponent(id)}`, refundDetailSchema, signal),
  remindRefund: (client: QueryClient, id: string, key: string, signal?: Signal) =>
    post(
      client,
      `/api/buyer-portal/refunds/${encodeURIComponent(id)}/remind`,
      refundReminderMutationSchema,
      {},
      key,
      signal,
    ),
});
