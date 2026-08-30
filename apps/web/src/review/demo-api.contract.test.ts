import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ApiRequest } from '../api/transport';
import {
  demoApiRequest,
  resetReviewDemoState,
  setReviewDemandCloseAccessForTests,
} from './demo-api';
import { STAFF_REVIEW_ROLES, chooseStaffRoleForTests } from './runtime';
import {
  sellerPortalSettlementBatchDetailResponseSchema,
  sellerPortalSettlementBatchPageSchema,
} from '@ygb/contracts';
import {
  sellerApplicationsSchema,
  sellerDemandsSchema,
  sellerFormalOrdersSchema,
  sellerMeSchema,
  sellerPayablesSchema,
  sellerPaymentsSchema,
  sellerProductsSchema,
  sellerReviewsSchema,
  sellerSettlementSummarySchema,
  sellerStoresSchema,
} from '../seller/contracts/runtime';
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
  orderEvidencePageSchema,
  refundDetailSchema,
  refundsPageSchema,
  reservationsPageSchema,
  reviewDetailSchema,
  reviewsPageSchema,
} from '../buyer/contracts/runtime';
import {
  adminDashboardSummarySchema,
  demandCloseMutationSchema,
  demandReviewContextSchema,
  internalFinanceOrderDetailSchema,
  settlementPayablesSchema,
  settlementPaymentsSchema,
  settlementSummarySchema,
  staffAccessOverviewSchema,
  staffBuyerRefundListSchema,
  staffBuyerRefundSchema,
  staffFormalOrderDetailSchema,
  staffOrderListPageSchema,
  staffProductDetailSchema,
  staffProductPageSchema,
  staffRateCenterSchema,
  staffReservationSchedulePageSchema,
  staffReviewSchema,
  staffSellerPrincipalRatePoliciesResponseSchema,
  staffSellerServiceFeesSchema,
  staffOrderEvidenceSchema,
  staffOrderEvidencePreflightSchema,
  staffSearchSchema,
  staffWorkItemsSchema,
  staffWorkbenchSummaryEnvelopeSchema,
} from '../staff/contracts/runtime';

/**
 * 评审运行时合同锁：对评审可达的每个读端点，用页面真实 strict schema 解析
 * demo 响应。fixture 漂移（缺字段/多字段/类型不符）在此直接失败，而不是
 * 到浏览器里变成 MALFORMED_RESPONSE。
 */

function get<T extends z.ZodType>(path: string, schema: T): Promise<unknown> {
  return demoApiRequest({ path, method: 'GET', schema } as ApiRequest<T>).then(
    (result) => result.data,
  );
}

const workItemDetailPassthrough = z
  .object({
    work_item: z
      .object({
        work_item_id: z.string(),
        work_type: z.string(),
        source_entity_id: z.string(),
        status: z.enum(['OPEN', 'COMPLETED', 'CANCELLED']),
      })
      .passthrough(),
  })
  .passthrough();

const settlementBatchList = z
  .object({
    batches: z.array(
      z
        .object({
          batch_id: z.string(),
          seller_organization_id: z.string(),
          status: z.enum(['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']),
          frozen_total_cny_fen: z.string(),
          frozen_payable_count: z.number().int().nonnegative(),
          paid_amount_cny_fen: z.string(),
          outstanding_amount_cny_fen: z.string(),
          version: z.number().int().positive(),
          created_at: z.number().int(),
          confirmed_at: z.number().int().nullable(),
          cancelled_at: z.number().int().nullable(),
          cancel_reason: z.string().nullable(),
        })
        .strict(),
    ),
    next_cursor: z.string().nullable(),
  })
  .strict();

const serviceChannels = z
  .object({
    channels: z.array(
      z
        .object({
          code: z.enum(['BUYER_PRE_SALES', 'BUYER_AFTER_SALES']),
          display_name: z.string(),
          wechat_id: z.string().nullable(),
          qr_file: z
            .object({
              file_object_id: z.string(),
              file_version: z.number().int().positive(),
              purpose: z.literal('SERVICE_CHANNEL_QR'),
              visibility: z.literal('BUYER_VISIBLE'),
            })
            .strict()
            .nullable(),
          version: z.number().int().positive(),
          updated_at: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

const sellerDirectory = z
  .object({
    items: z.array(
      z
        .object({
          seller_organization_id: z.string(),
          seller_code: z.string(),
          display_name: z.string(),
          wechat_masked: z.string(),
          marketplace_code: z.string(),
          source_status: z.enum(['HISTORICAL_FROZEN_IMPORT', 'CURRENT_OR_NEW']),
          source_file_count: z.number().int().nonnegative(),
          product_names: z.array(z.string()),
          active_offering_count: z.number().int().nonnegative(),
          has_portal_account: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

const identityCases = z
  .object({
    cases: z.array(
      z
        .object({
          id: z.string(),
          identity_masked: z.string(),
          customer_type: z.string(),
          marketplace_code: z.string(),
          reason_code: z.string(),
          staff_note: z.string().nullable(),
          status: z.string(),
          reported_by_staff_id: z.string(),
          resolved_subject_id: z.string().nullable(),
          resolution_note: z.string().nullable(),
          resolved_by_staff_id: z.string().nullable(),
          created_at: z.number().int(),
          resolved_at: z.number().int().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

const sellerInvitationCurrent = z
  .object({
    invitation: z
      .object({
        invitation_id: z.string(),
        wechat_id: z.string(),
        marketplace_code: z.string(),
        seller_organization_id: z.string(),
        seller_member_id: z.string().nullable(),
        onboarding_kind: z.enum(['NEW_CUSTOMER', 'HISTORICAL_ACCOUNT_ONLY']),
        issued_by_staff_id: z.string(),
        status: z.enum(['ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED']),
        version: z.number().int().positive(),
        issued_at: z.number().int(),
        expires_at: z.number().int(),
        consumed_at: z.number().int().nullable(),
        revoked_at: z.number().int().nullable(),
        registration_link_recoverable: z.literal(false),
      })
      .strict()
      .nullable(),
  })
  .strict();

const productApplicationContext = z
  .object({
    review_context: z
      .object({
        application_id: z.string(),
        store: z.object({ id: z.string(), display_name: z.string() }).strict(),
        marketplace_code: z.string(),
        asin: z.string(),
        product_name: z.string(),
        search_keywords: z.array(z.string()),
        product_url: z.string().nullable(),
        buyer_visible_notes: z.string().nullable(),
        seller_notes: z.string().nullable(),
        ordering_guide_expected_amount_jpy: z.string().nullable(),
        status: z.string(),
        version: z.number().int().positive(),
        submitted_at: z.number().int().nonnegative(),
        images: z
          .array(
            z
              .object({
                file_object_id: z.string(),
                file_version: z.number().int().positive(),
                client_file_name: z.string(),
              })
              .strict(),
          )
          .default([]),
      })
      .passthrough(),
  })
  .passthrough();

const reservationContext = z
  .object({
    review_context: z
      .object({
        reservation_id: z.string(),
        buyer: z
          .object({
            id: z.string(),
            customer_no: z.string().nullable(),
            name: z.string(),
            wechat: z.string().nullable(),
          })
          .strict(),
        store: z.object({ id: z.string(), display_name: z.string() }).strict(),
        marketplace_code: z.string(),
        status: z.string(),
        version: z.number().int().positive(),
        submitted_at: z.number().int().nonnegative(),
        hold_expires_at: z.number().int().nonnegative(),
        order_deadline_snapshot: z.number().int().nonnegative(),
        buyer_self_pay_bps_snapshot: z.number().int(),
        reference_order_amount_jpy_snapshot: z.string(),
        estimated_self_pay_jpy_snapshot: z.string(),
        estimated_refundable_principal_jpy_snapshot: z.string(),
        demand: z.object({
          demand_batch_id: z.string(),
          product_name: z.string(),
          task_type: z.string(),
          reservation_deadline: z.number().int().nonnegative(),
          order_deadline: z.number().int().nonnegative(),
          store_display_name: z.string(),
        }),
      })
      .passthrough(),
  })
  .passthrough();

const orderInstruction = z
  .object({
    order_instruction: z
      .object({
        instruction_id: z.string(),
        reservation_id: z.string(),
        status: z.string(),
        current_version_no: z.number().int().nonnegative(),
        version: z.number().int().positive(),
        published_at: z.number().int().nonnegative().nullable(),
        initial_deadline_at: z.number().int().nonnegative().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

const advanceEntries = z
  .object({ entries: z.array(z.unknown()) })
  .strict();

const sellerPaymentsPage = z.object({
  items: z.array(
    z
      .object({
        payment_id: z.string(),
        amount_cny_fen: z.string(),
        paid_at: z.number().int(),
        recorded_at: z.number().int(),
        allocated_amount_cny_fen: z.string(),
        unallocated_amount_cny_fen: z.string(),
        status: z.enum(['REVERSED', 'UNALLOCATED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED']),
        version: z.number().int().positive(),
        allocations: z.array(z.unknown()),
      })
      .strict(),
  ),
  page: z.object({ limit: z.number().int().positive(), next_cursor: z.string().nullable() }).strict(),
});

const buyerChannels = z.object({
  channels: z.array(
    z
      .object({
        code: z.enum(['BUYER_PRE_SALES', 'BUYER_AFTER_SALES']),
        display_name: z.string().min(1).max(200),
        wechat_id: z.string().max(200).nullable(),
        qr_file: z.unknown().nullable(),
      })
      .strict(),
  ),
});

const batchReadIntents = z.object({
  intents: z.array(
    z
      .object({
        read_intent_id: z.string(),
        file_object_id: z.string(),
        access_token: z.string().min(32).max(512).nullable(),
        access_token_available: z.boolean(),
        expires_at: z.number().int().nonnegative(),
        replayed: z.boolean(),
      })
      .strict(),
  ),
});

async function post<T extends z.ZodType>(
  path: string,
  schema: T,
  body: unknown,
  headers?: Readonly<Record<string, string>>,
): Promise<unknown> {
  return demoApiRequest({
    path,
    method: 'POST',
    schema,
    body,
    ...(headers === undefined ? {} : { headers }),
  } as ApiRequest<T>).then((result) => result.data);
}

async function demandCloseOutcome(
  body: unknown,
  key: string | null,
  role: (typeof STAFF_REVIEW_ROLES)[number] = 'owner',
  access: 'DEFAULT' | 'MISSING' | 'PERSONAL_DENY' = 'DEFAULT',
): Promise<unknown> {
  resetReviewDemoState();
  currentStaffReviewRoleChoose(role);
  setReviewDemandCloseAccessForTests(access);
  try {
    return {
      ok: true,
      data: await post(
        '/api/staff/demand-batches/review-seller-demand-1/close',
        demandCloseMutationSchema,
        body,
        key === null ? undefined : { 'Idempotency-Key': key },
      ),
    };
  } catch (error) {
    const candidate = error as { code?: unknown; httpStatus?: unknown };
    return {
      ok: false,
      code: candidate.code,
      status: candidate.httpStatus,
    };
  }
}

describe('review demo api satisfies current staff contract', () => {
  beforeEach(() => {
    resetReviewDemoState();
  });
  afterEach(() => {
    resetReviewDemoState();
  });

  it('serves workbench summary and SLA-enriched work items for every staff role', async () => {
    for (const role of STAFF_REVIEW_ROLES) {
      currentStaffReviewRoleChoose(role);
      const items = (await get(
        '/api/staff/me/work-items?status=OPEN&limit=25',
        staffWorkItemsSchema,
      )) as { work_items: { work_item_id: string; is_overdue: boolean; priority: string }[] };
      expect(items.work_items.length, `role=${role}`).toBeGreaterThan(0);
      const completed = (await get(
        '/api/staff/me/work-items?status=COMPLETED&limit=25',
        staffWorkItemsSchema,
      )) as { work_items: unknown[] };
      expect(completed.work_items.length, `role=${role}`).toBeGreaterThan(0);
      const summary = (await get(
        '/api/staff/me/work-items/summary',
        staffWorkbenchSummaryEnvelopeSchema,
      )) as { summary: { open_count: number; recent: unknown[] } };
      expect(summary.summary.open_count, `role=${role}`).toBe(items.work_items.length);
      expect(summary.summary.recent.length, `role=${role}`).toBeGreaterThan(0);
      // 工作项详情按角色可见范围解析；取该角色自己的第一个工作项。
      const detail = (await get(
        `/api/staff/me/work-items/${encodeURIComponent(items.work_items[0]!.work_item_id)}`,
        workItemDetailPassthrough,
      )) as { work_item: { work_item_id: string } };
      expect(detail.work_item.work_item_id).toBe(items.work_items[0]!.work_item_id);
    }
  });

  it('serves the staff order list in list mode and the aggregate in lookup mode', async () => {
    const list = (await get(
      '/api/staff/formal-orders?limit=20',
      staffOrderListPageSchema,
    )) as { items: { responsibility: { stage: string } }[] };
    expect(list.items.length).toBeGreaterThanOrEqual(5);
    expect(list.items[0]!.responsibility.stage).toBeTruthy();
    const filtered = (await get(
      '/api/staff/formal-orders?stage=BUYER_REFUND&limit=20',
      staffOrderListPageSchema,
    )) as { items: { responsibility: { stage: string } }[] };
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.every((item) => item.responsibility.stage === 'BUYER_REFUND')).toBe(true);
    const aggregate = (await get(
      '/api/staff/formal-orders?amazon_order_number=503-7770001-0003001',
      staffFormalOrderDetailSchema,
    )) as { order: { formal_order_id: string } };
    expect(aggregate.order.formal_order_id).toBe('review-seller-order-1');
    const byId = (await get(
      '/api/staff/formal-orders/review-seller-order-1',
      staffFormalOrderDetailSchema,
    )) as { responsibility: { next_action: string } };
    expect(byId.responsibility.next_action).toBe('PROCESS_BUYER_REFUND');
  });

  it('serves finance order detail, settlements, batches and payables', async () => {
    await get('/api/staff/finance/orders/review-seller-order-1', internalFinanceOrderDetailSchema);
    await get('/api/staff/seller-settlements/review-seller-org/summary', settlementSummarySchema);
    await get('/api/staff/seller-settlements/review-seller-org/payables?limit=25', settlementPayablesSchema);
    const payments = (await get(
      '/api/staff/seller-settlements/review-seller-org/payments?limit=25',
      settlementPaymentsSchema,
    )) as { items: { payment_id: string }[] };
    expect(payments.items.length).toBeGreaterThan(0);
    const batches = (await get(
      '/api/staff/seller-settlements/review-seller-org/batches',
      settlementBatchList,
    )) as { batches: { status: string }[] };
    expect(batches.batches.length).toBeGreaterThanOrEqual(4);
  });

  it('serves refunds, reviews, evidence and preflight', async () => {
    const refunds = (await get('/api/staff/buyer-refunds', staffBuyerRefundListSchema)) as {
      items: { obligation_id: string }[];
    };
    expect(refunds.items.length).toBeGreaterThan(0);
    const refund = (await get(
      '/api/staff/buyer-refunds/review-staff-refund-1',
      staffBuyerRefundSchema,
    )) as { buyer_refund: { payments: unknown[] } };
    expect(refund.buyer_refund.payments.length).toBeGreaterThan(0);
    const review = (await get('/api/staff/reviews/review-staff-review-1', staffReviewSchema)) as {
      review: { formal_order_id: string };
    };
    expect(review.review.formal_order_id).toBe('review-seller-order-1');
    await get('/api/staff/order-evidence/review-staff-evidence-1', staffOrderEvidenceSchema);
    const preflight = (await get(
      '/api/staff/order-evidence/review-staff-evidence-1/preflight',
      staffOrderEvidencePreflightSchema,
    )) as { preflight: { ready: boolean } };
    expect(preflight.preflight.ready).toBe(true);
  });

  it('serves catalog, scheduling, rate center, access management and settings', async () => {
    const products = (await get(
      '/api/staff/catalog/products?limit=25',
      staffProductPageSchema,
    )) as { page: { items: unknown[] } };
    expect(products.page.items.length).toBeGreaterThan(0);
    await get('/api/staff/catalog/products/review-product-1', staffProductDetailSchema);
    await get(
      '/api/staff/demand-batches/review-seller-demand-1/review-context',
      demandReviewContextSchema,
    );
    await get(
      '/api/staff/demand-batches/review-seller-demand-1/reservation-schedule?limit=50',
      staffReservationSchedulePageSchema,
    );
    await get('/api/staff/rate-center?business_date=2026-08-11', staffRateCenterSchema);
    await get(
      '/api/staff/seller-principal-rate-policies?source_currency_code=JPY',
      staffSellerPrincipalRatePoliciesResponseSchema,
    );
    await get(
      '/api/staff/seller-service-fees?seller_organization_id=review-seller-org',
      staffSellerServiceFeesSchema,
    );
    const access = (await get('/api/staff/access-management', staffAccessOverviewSchema)) as {
      employees: unknown[];
    };
    expect(access.employees.length).toBeGreaterThan(0);
    const channels = (await get('/api/staff/service-channels', serviceChannels)) as {
      channels: { code: string }[];
    };
    expect(channels.channels.map((channel) => channel.code)).toEqual([
      'BUYER_PRE_SALES',
      'BUYER_AFTER_SALES',
    ]);
    await get('/api/staff/admin-business-dashboard/summary?window=TODAY', adminDashboardSummarySchema);
    const search = (await get('/api/staff/search?q=%E5%BC%A0', staffSearchSchema)) as {
      buyers: unknown[];
    };
    expect(search.buyers.length).toBeGreaterThan(0);
  });

  it('serves the published demand close mutation and reflects the closed status', async () => {
    currentStaffReviewRoleChoose('owner');
    const result = (await post(
      '/api/staff/demand-batches/review-seller-demand-1/close',
      demandCloseMutationSchema,
      { expected_version: 1, close_reason: '演示需求已完成' },
      { 'Idempotency-Key': 'review-demand-close-success' },
    )) as { demand_close: { status: string; version: number; close_reason: string } };
    expect(result.demand_close).toMatchObject({
      status: 'CLOSED',
      version: 2,
      close_reason: '演示需求已完成',
    });
    const page = (await get(
      '/api/staff/demand-batches/review-seller-demand-1/reservation-schedule?limit=50',
      staffReservationSchedulePageSchema,
    )) as { page: { demand: { status: string; can_close: boolean; demand_version: number } } };
    expect(page.page.demand).toMatchObject({
      status: 'CLOSED',
      can_close: false,
      demand_version: 2,
    });
  });

  it('rejects incomplete or unauthorized Demo Demand CLOSE requests', async () => {
    const cases = [
      [
        'missing key',
        { expected_version: 1, close_reason: '必填原因' },
        null,
        'owner',
        'DEFAULT',
        { ok: false, code: 'VALIDATION_ERROR', status: 400 },
      ],
      [
        'missing reason',
        { expected_version: 1 },
        'review-demand-close-missing-reason',
        'owner',
        'DEFAULT',
        { ok: false, code: 'VALIDATION_ERROR', status: 400 },
      ],
      [
        'blank reason',
        { expected_version: 1, close_reason: '   ' },
        'review-demand-close-blank-reason',
        'owner',
        'DEFAULT',
        { ok: false, code: 'VALIDATION_ERROR', status: 400 },
      ],
      [
        'unknown body field',
        { expected_version: 1, close_reason: '原因', internal_note: '不允许' },
        'review-demand-close-unknown-field',
        'owner',
        'DEFAULT',
        { ok: false, code: 'VALIDATION_ERROR', status: 400 },
      ],
      [
        'invalid version',
        { expected_version: '1', close_reason: '原因' },
        'review-demand-close-invalid-version',
        'owner',
        'DEFAULT',
        { ok: false, code: 'VALIDATION_ERROR', status: 400 },
      ],
      [
        'stale version',
        { expected_version: 2, close_reason: '原因' },
        'review-demand-close-stale-version',
        'owner',
        'DEFAULT',
        { ok: false, code: 'VERSION_CONFLICT', status: 409 },
      ],
      [
        'pre-sales role',
        { expected_version: 1, close_reason: '原因' },
        'review-demand-close-pre-sales',
        'pre_sales',
        'DEFAULT',
        { ok: false, code: 'FORBIDDEN', status: 403 },
      ],
      [
        'buyer refund role',
        { expected_version: 1, close_reason: '原因' },
        'review-demand-close-buyer-refund',
        'buyer_refund',
        'DEFAULT',
        { ok: false, code: 'FORBIDDEN', status: 403 },
      ],
      [
        'missing DEMAND_PUBLISH',
        { expected_version: 1, close_reason: '原因' },
        'review-demand-close-missing-permission',
        'owner',
        'MISSING',
        { ok: false, code: 'FORBIDDEN', status: 403 },
      ],
      [
        'Personal DENY',
        { expected_version: 1, close_reason: '原因' },
        'review-demand-close-personal-deny',
        'seller_ops',
        'PERSONAL_DENY',
        { ok: false, code: 'FORBIDDEN', status: 403 },
      ],
    ] as const;
    const outcomes = [];
    for (const [label, body, key, role, access] of cases) {
      outcomes.push({ label, outcome: await demandCloseOutcome(body, key, role, access) });
    }
    expect(outcomes).toEqual(cases.map(([label, , , , , expected]) => ({
      label,
      outcome: expected,
    })));
  });

  it('projects Demo close capability from effective permission, not role labels alone', async () => {
    const cases = [
      ['pre_sales', 'DEFAULT'],
      ['buyer_refund', 'DEFAULT'],
      ['owner', 'MISSING'],
      ['seller_ops', 'PERSONAL_DENY'],
    ] as const;
    for (const [role, access] of cases) {
      resetReviewDemoState();
      currentStaffReviewRoleChoose(role);
      setReviewDemandCloseAccessForTests(access);
      const page = (await get(
        '/api/staff/demand-batches/review-seller-demand-1/reservation-schedule?limit=50',
        staffReservationSchedulePageSchema,
      )) as { page: { demand: { can_close: boolean } } };
      expect(page.page.demand.can_close, `${role}/${access}`).toBe(false);
    }
  });

  it('replays the exact Demo close response and rejects same-key payload mismatch', async () => {
    resetReviewDemoState();
    currentStaffReviewRoleChoose('owner');
    const key = 'review-demand-close-replay';
    const body = { expected_version: 1, close_reason: '演示需求已完成' };
    const first = await post(
      '/api/staff/demand-batches/review-seller-demand-1/close',
      demandCloseMutationSchema,
      body,
      { 'Idempotency-Key': key },
    );
    const replay = await post(
      '/api/staff/demand-batches/review-seller-demand-1/close',
      demandCloseMutationSchema,
      body,
      { 'Idempotency-Key': key },
    );
    expect(replay).toEqual({
      ...(first as object),
      demand_close: {
        ...((first as { demand_close: object }).demand_close),
        replayed: true,
      },
    });
    await expect(post(
      '/api/staff/demand-batches/review-seller-demand-1/close',
      demandCloseMutationSchema,
      { ...body, close_reason: '同键不同原因' },
      { 'Idempotency-Key': key },
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', httpStatus: 409 });
    const page = (await get(
      '/api/staff/demand-batches/review-seller-demand-1/reservation-schedule?limit=50',
      staffReservationSchedulePageSchema,
    )) as { page: { demand: { status: string; demand_version: number; can_close: boolean } } };
    expect(page.page.demand).toMatchObject({
      status: 'CLOSED',
      demand_version: 2,
      can_close: false,
    });
  });

  it('serves customer onboarding directory, invitations and identity cases', async () => {
    const directory = (await get(
      '/api/staff/customer-onboarding/seller-directory',
      sellerDirectory,
    )) as { items: unknown[] };
    expect(directory.items.length).toBeGreaterThan(0);
    const current = (await get(
      '/api/staff/customer-security/seller-invitations/current?seller_organization_id=review-seller-org-2',
      sellerInvitationCurrent,
    )) as { invitation: { invitation_id: string } | null };
    expect(current.invitation).not.toBeNull();
    const cases = (await get(
      '/api/staff/customer-identity-resolution/cases',
      identityCases,
    )) as { cases: unknown[] };
    expect(cases.cases.length).toBeGreaterThan(0);
  });

  it('serves work panel contexts (product application, reservation, instruction)', async () => {
    await get('/api/staff/product-applications/review-app-1/review-context', productApplicationContext);
    await get('/api/staff/reservations/review-buyer-reservation-001/review-context', reservationContext);
    await get('/api/staff/order-instructions/review-instruction-1', orderInstruction);
    await get('/api/staff/buyer-advance-principal/review-seller-order-1', advanceEntries);
  });

  it('serves batch file read intents for requested files', async () => {
    const body = {
      requests: [
        { file_object_id: 'review-file-a', expected_file_version: 1 },
        { file_object_id: 'review-file-b', expected_file_version: 2 },
      ],
    };
    const result = (await post('/api/staff/file-read-intents/batch', batchReadIntents, body)) as {
      intents: { file_object_id: string; access_token: string | null; replayed: boolean }[];
    };
    expect(result.intents.map((intent) => intent.file_object_id)).toEqual([
      'review-file-a',
      'review-file-b',
    ]);
    expect(result.intents.every((intent) => intent.access_token !== null && !intent.replayed)).toBe(
      true,
    );
  });

  it('serves seller settlement payments and read-only batches', async () => {
    const payments = (await get(
      '/api/seller-portal/settlement/payments',
      sellerPaymentsPage,
    )) as { items: { payment_id: string }[] };
    expect(payments.items.length).toBeGreaterThan(0);
    const batches = (await get(
      '/api/seller-portal/settlement/batches',
      sellerPortalSettlementBatchPageSchema,
    )) as { batches: { batch_id: string; status: string }[] };
    expect(batches.batches.length).toBeGreaterThan(0);
    expect(
      batches.batches.every(
        (batch) => batch.status !== 'DRAFT' && batch.status !== 'CANCELLED',
      ),
    ).toBe(true);
    const detail = (await get(
      `/api/seller-portal/settlement/batches/${batches.batches[0]!.batch_id}`,
      sellerPortalSettlementBatchDetailResponseSchema,
    )) as { batch: { members: unknown[] } };
    expect(detail.batch.members.length).toBeGreaterThan(0);
  });

  it('serves empty buyer service channels matching the unconfigured seed', async () => {
    const channels = (await get('/api/buyer-portal/service-channels', buyerChannels)) as {
      channels: unknown[];
    };
    expect(channels.channels).toEqual([]);
  });

  it('serves seller portal pages against the current strict schemas', async () => {
    await get('/api/seller-portal/me', sellerMeSchema);
    await get('/api/seller-portal/stores', sellerStoresSchema);
    const products = (await get('/api/seller-portal/products', sellerProductsSchema)) as {
      items: unknown[];
    };
    expect(products.items.length).toBeGreaterThan(0);
    const applications = (await get(
      '/api/seller-portal/product-applications',
      sellerApplicationsSchema,
    )) as { items: unknown[] };
    expect(applications.items.length).toBeGreaterThan(0);
    const demands = (await get('/api/seller-portal/demand-batches', sellerDemandsSchema)) as {
      items: unknown[];
    };
    expect(demands.items.length).toBeGreaterThan(0);
    const orders = (await get('/api/seller-portal/formal-orders', sellerFormalOrdersSchema)) as {
      items: unknown[];
    };
    expect(orders.items.length).toBeGreaterThan(0);
    const reviews = (await get('/api/seller-portal/reviews', sellerReviewsSchema)) as {
      items: unknown[];
    };
    expect(reviews.items.length).toBeGreaterThan(0);
    await get('/api/seller-portal/settlement/summary', sellerSettlementSummarySchema);
    await get('/api/seller-portal/settlement/payables', sellerPayablesSchema);
    await get('/api/seller-portal/settlement/payments', sellerPaymentsSchema);
  });

  it('serves buyer portal pages against the current strict schemas', async () => {
    await get('/api/buyer-portal/me', buyerMeSchema);
    const demands = (await get('/api/buyer-portal/demands?limit=6', demandsPageSchema)) as {
      items: unknown[];
    };
    expect(demands.items.length).toBeGreaterThan(0);
    await get('/api/buyer-portal/demands/review-buyer-demand-003', demandDetailSchema);
    const reservations = (await get(
      '/api/buyer-portal/reservations?limit=6',
      reservationsPageSchema,
    )) as { items: unknown[] };
    expect(reservations.items.length).toBeGreaterThan(0);
    await get(
      '/api/buyer-portal/reservations/review-buyer-reservation-002/order-instruction/state',
      instructionStateResponseSchema,
    );
    await get(
      '/api/buyer-portal/reservations/review-buyer-reservation-002/order-instruction',
      instructionResponseSchema,
    );
    await get('/api/buyer-portal/order-evidence/eligible-reservations', eligibleEvidencePageSchema);
    const evidence = (await get(
      '/api/buyer-portal/order-evidence?limit=6',
      orderEvidencePageSchema,
    )) as { items: unknown[] };
    expect(evidence.items.length).toBeGreaterThan(0);
    await get('/api/buyer-portal/order-evidence/review-buyer-evidence-001', orderEvidenceDetailSchema);
    await get('/api/buyer-portal/reviews/eligible-orders', eligibleReviewOrdersPageSchema);
    const reviews = (await get('/api/buyer-portal/reviews?limit=6', reviewsPageSchema)) as {
      items: unknown[];
    };
    expect(reviews.items.length).toBeGreaterThan(0);
    await get('/api/buyer-portal/reviews/review-buyer-review-001', reviewDetailSchema);
    const orders = (await get('/api/buyer-portal/formal-orders?limit=6', formalOrdersPageSchema)) as {
      items: unknown[];
    };
    expect(orders.items.length).toBeGreaterThan(0);
    await get('/api/buyer-portal/formal-orders/review-buyer-order-001', formalOrderDetailSchema);
    const refunds = (await get('/api/buyer-portal/refunds?limit=6', refundsPageSchema)) as {
      items: unknown[];
    };
    expect(refunds.items.length).toBeGreaterThan(0);
    await get('/api/buyer-portal/refunds/review-buyer-refund-001', refundDetailSchema);
  });
});

// runtime 模块的角色是模块级可变状态；测试通过重新选择角色驱动。
function currentStaffReviewRoleChoose(role: (typeof STAFF_REVIEW_ROLES)[number]): void {
  chooseStaffRoleForTests(role);
}
