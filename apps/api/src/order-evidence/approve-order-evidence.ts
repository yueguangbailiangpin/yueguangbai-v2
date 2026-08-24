import type {
  ApproveStaffOrderEvidenceResult,
  ConfirmFormalOrderResult,
  FormalOrderFinancialSnapshotProjection,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  canonicalJson,
  chinaBusinessDate,
  fixedIntegerString,
  formatBuyerCustomerNumber,
  hashCanonicalJson,
  parseCnyFen,
  parseCnyPerJpyE8,
  parseJpyInteger,
  toD1SafeInteger,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import type { ObjectStorageAdapter } from '@ygb/contracts';
import {
  buildExplicitAudienceFileLinkStatements,
} from '../files/explicit-audience-links';
import {
  prepareFileObjectClone,
  readVerifiedFileObject,
} from '../files/file-object-clone';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import { createOutboxStatements, prepareOutboxEvent } from '../foundation/outbox';
import {
  assertPreviousStatementChangedOnce,
  cleanFormalOrderExpectedVersion,
  cleanFormalOrderIdentifier,
  cleanFormalOrderTimestamp,
  FormalOrderError,
  normalizeFormalOrderError,
  requireFormalOrderConfirmationPermission,
  requireFormalOrderReviewType,
  type FormalOrderStaffActor,
} from '../formal-order-shared/formal-order-shared';
import {
  calculateBuyerFormalFinancials,
  completeFormalInstructionStatements,
  finalizeOrderNumberClaimStatement,
  requireFormalInstructionSource,
  requireProvisionalOrderNumberClaim,
} from '../order-instructions/formal-order-integration';
import { resolveBuyerDailyExchangeRate } from '../pricing/buyer-daily-exchange-rates';
import {
  insertSellerPrincipalRateSnapshotStatement,
  readSellerPrincipalRatePolicies,
  resolveSellerPrincipalRateSnapshot,
} from '../pricing/seller-principal-rate-policy';
import { resolveSellerServiceFee } from '../pricing/seller-service-fees';
import { prepareSellerPayableCreation } from '../seller-settlements/payable-statements';
import {
  prepareWorkItemCompletionStatements,
  requireAssignedWorkflowActor,
} from '../staff-assignment';
import {
  cleanOptionalOrderEvidenceText,
  insertOrderEvidenceEventStatement,
} from './order-evidence-shared';

interface AtomicApprovalSource {
  submission_id: string;
  reservation_id: string;
  buyer_customer_id: string;
  marketplace_code: string;
  evidence_status: string;
  evidence_current_version_no: number;
  evidence_aggregate_version: number;
  evidence_version_id: string;
  amazon_order_number_raw: string;
  amazon_order_number_normalized: string;
  amazon_order_date: string | null;
  final_paid_jpy: number;
  reference_order_amount_jpy: number;
  price_difference_jpy: number;
  price_mismatch: number;
  evidence_file_object_id: string | null;
  evidence_file_count: number;
  file_status: string | null;
  file_purpose: string | null;
  file_visibility: string | null;
  file_version: number | null;
  file_owner_actor_type: string | null;
  file_owner_actor_id: string | null;
  reservation_status: string;
  reservation_version: number;
  demand_batch_id: string;
  seller_organization_id: string;
  store_id: string;
  product_id: string;
  product_version_no: number;
  review_type: string;
  asin_display: string;
  asin_normalized: string;
  product_version_id: string;
  product_name: string;
  buyer_access_status: string;
  buyer_customer_no: string | null;
  buyer_sequence: number | null;
  first_valid_order_business_date: string | null;
  buyer_channel_id: string;
  buyer_version: number;
  channel_code: string;
  channel_status: string;
  channel_next_sequence: number;
  channel_version: number;
  preorder_buyer_customer_no: string | null;
  preorder_buyer_sequence: number | null;
  existing_formal_order_id: string | null;
}

interface BuyerNumberPlan {
  buyerCustomerNo: string;
  allocated: boolean;
  sequence: number;
  firstValidOrderBusinessDate: string;
  statements: readonly SqlStatement[];
}

export interface AtomicOrderEvidenceApprovalResult {
  approval: ApproveStaffOrderEvidenceResult;
  formalOrder: ConfirmFormalOrderResult;
}

export interface OrderEvidenceApprovalPreflight {
  submission_id: string;
  amazon_order_date: string | null;
  ready: boolean;
  checks: readonly {
    code: 'ORDER_DAY_BASE_RATE' | 'SELLER_PRINCIPAL_MARKUP' | 'SELLER_SERVICE_FEE';
    status: 'READY' | 'MISSING';
    message: string;
    action_path: string;
    required_access: string;
  }[];
}

export class AtomicOrderEvidenceApprovalError extends Error {
  constructor(
    readonly code:
      | 'PRICE_MISMATCH'
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'STATE_CONFLICT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND'
      | 'PRICING_RULE_NOT_FOUND'
      | 'SELLER_PRINCIPAL_RATE_NOT_FOUND'
      | 'DEPENDENCY_UNAVAILABLE',
    readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
  }
}

export async function approveOrderEvidenceAtomically(
  database: SqlDatabase,
  input: {
    submissionId: string;
    expectedVersion: number;
    internalNote?: string | null;
    priceMismatchAcknowledged?: boolean;
    priceMismatchReason?: string | null;
  },
  command: {
    actor: FormalOrderStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
    deps?: { storage?: ObjectStorageAdapter };
  },
): Promise<AtomicOrderEvidenceApprovalResult> {
  requireFormalOrderConfirmationPermission(command.actor);
  const submissionId = cleanFormalOrderIdentifier(input.submissionId);
  const expectedVersion = cleanFormalOrderExpectedVersion(input.expectedVersion);
  const internalNote = cleanOptionalOrderEvidenceText(input.internalNote, 4000);
  const normalizedReason = cleanOptionalOrderEvidenceText(input.priceMismatchReason, 2000);
  const acknowledged = input.priceMismatchAcknowledged;
  if (acknowledged !== undefined && typeof acknowledged !== 'boolean') {
    throw new AtomicOrderEvidenceApprovalError('VALIDATION_ERROR', 400);
  }
  const now = cleanFormalOrderTimestamp(command.now ?? Date.now());
  const businessDate = chinaBusinessDate(now);
  const requestHash = await hashCanonicalJson({
    action: 'APPROVE_ORDER_EVIDENCE',
    submission_id: submissionId,
    expected_version: expectedVersion,
    internal_note: internalNote,
    price_mismatch_acknowledged: acknowledged ?? null,
    price_mismatch_reason: normalizedReason,
  });
  const acquired = await acquireIdempotency<AtomicOrderEvidenceApprovalResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'APPROVE_ORDER_EVIDENCE',
      targetType: 'ORDER_EVIDENCE_SUBMISSION',
      targetId: submissionId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return {
      approval: { ...acquired.response.approval, replayed: true },
      formalOrder: { ...acquired.response.formalOrder, replayed: true },
    };
  }

  try {
    const source = await requireAtomicApprovalSource(database, submissionId);
    validateSource(source, expectedVersion);
    if (source.amazon_order_date === null) {
      throw new AtomicOrderEvidenceApprovalError('STATE_CONFLICT', 409);
    }
    const mismatch = source.price_difference_jpy !== 0;
    validateMismatchDecision({
      mismatch,
      acknowledged,
      reason: normalizedReason,
    });
    await requireAssignedWorkflowActor(database, {
      staffId: command.actor.staffId,
      workType: 'ORDER_EVIDENCE_REVIEW',
      sourceEntityType: 'ORDER_EVIDENCE',
      sourceEntityId: submissionId,
    });
    const reviewType = requireFormalOrderReviewType(source.review_type);
    const instruction = await requireFormalInstructionSource(database, {
      reservationId: source.reservation_id,
      evidenceVersionId: source.evidence_version_id,
    });
    await requireProvisionalOrderNumberClaim(database, {
      marketplaceCode: 'JP',
      amazonOrderNumberNormalized: source.amazon_order_number_normalized,
      evidenceSubmissionId: source.submission_id,
      evidenceVersionId: source.evidence_version_id,
    });
    // Confirmation day is retained only for buyer numbering/audit.  Both
    // financial sides resolve the same immutable base rate by Amazon order
    // date; no financial result may depend on the later Staff confirmation day.
    const buyerRate = await resolveBuyerDailyExchangeRate(database, {
      businessDate: source.amazon_order_date,
      asOf: now,
    });
    const sellerPrincipalRateSnapshot = await resolveSellerPrincipalRateSnapshot(database, {
      sellerOrganizationId: source.seller_organization_id,
      platformOrderDate: source.amazon_order_date,
      paymentAmountMinor: source.final_paid_jpy,
      paymentCurrencyCode: 'JPY',
      at: now,
    });
    const serviceFee = await resolveSellerServiceFee(database, {
      sellerOrganizationId: source.seller_organization_id,
      reviewType,
      at: now,
    });
    if (
      sellerPrincipalRateSnapshot.base_rate_version_id !== `currency-${buyerRate.rate_id}` ||
      sellerPrincipalRateSnapshot.base_rate_business_date !== buyerRate.business_date
    ) {
      throw new AtomicOrderEvidenceApprovalError('SELLER_PRINCIPAL_RATE_NOT_FOUND', 404);
    }
    const finalPaidJpy = parseJpyInteger(String(source.final_paid_jpy));
    const buyerRateValue = parseCnyPerJpyE8(buyerRate.cny_per_jpy_e8);
    const serviceFeeValue = parseCnyFen(serviceFee.fee_cny_fen);
    const buyerFinancial = calculateBuyerFormalFinancials({
      finalPaidJpy: source.final_paid_jpy,
      buyerRefundablePrincipalJpy: Number(instruction.buyer_refundable_principal_jpy),
      buyerCnyPerJpyE8: buyerRate.cny_per_jpy_e8,
    });
    const buyerExpectedPrincipal = BigInt(buyerFinancial.buyerExpectedPrincipalCnyFen);
    const sellerExpectedPrincipal = parseCnyFen(
      sellerPrincipalRateSnapshot.seller_expected_principal_amount_minor,
    );
    const buyerNumber = prepareBuyerNumberPlan(
      database,
      source,
      businessDate,
      command.actor.staffId,
      acquired.claim.idempotencyKey,
      now,
    );
    const formalOrderId = crypto.randomUUID();
    const snapshotId = crypto.randomUUID();
    const financialSnapshot: FormalOrderFinancialSnapshotProjection = {
      snapshot_id: snapshotId,
      snapshot_version: 1,
      buyer_rate_version_id: buyerRate.rate_id,
      buyer_rate_version_no: buyerRate.version_no,
      buyer_rate_business_date: buyerRate.business_date,
      buyer_rate_confirmed_at: buyerRate.confirmed_at,
      buyer_cny_per_jpy_e8: fixedIntegerString(buyerRateValue),
      service_fee_version_id: serviceFee.fee_version_id,
      service_fee_version_no: serviceFee.version_no,
      service_fee_effective_from: serviceFee.effective_from,
      service_fee_confirmed_at: serviceFee.confirmed_at,
      service_fee_cny_fen: fixedIntegerString(serviceFeeValue),
      buyer_self_pay_bps: instruction.buyer_self_pay_bps,
      buyer_self_pay_jpy: String(instruction.buyer_self_pay_jpy),
      buyer_refundable_principal_jpy: String(instruction.buyer_refundable_principal_jpy),
      buyer_gross_principal_cny_fen: String(buyerFinancial.buyerGrossPrincipalCnyFen),
      buyer_self_pay_contribution_cny_fen: String(buyerFinancial.buyerSelfPayContributionCnyFen),
      buyer_expected_principal_cny_fen: fixedIntegerString(buyerExpectedPrincipal),
      seller_expected_principal_cny_fen: fixedIntegerString(sellerExpectedPrincipal),
      rounding_rule: 'HALF_UP',
      seller_principal_rate_snapshot: sellerPrincipalRateSnapshot,
    };
    const formalOrder: ConfirmFormalOrderResult = {
      formal_order_id: formalOrderId,
      status: 'CONFIRMED',
      version: 1,
      order_evidence_submission_id: source.submission_id,
      order_evidence_version_id: source.evidence_version_id,
      reservation_id: source.reservation_id,
      demand_batch_id: source.demand_batch_id,
      buyer_customer_id: source.buyer_customer_id,
      buyer_customer_no: buyerNumber.buyerCustomerNo,
      buyer_number_allocated: buyerNumber.allocated,
      seller_organization_id: source.seller_organization_id,
      store_id: source.store_id,
      marketplace_code: 'JP',
      product_id: source.product_id,
      product_version_id: source.product_version_id,
      product_version_no: source.product_version_no,
      asin: source.asin_normalized,
      product_name: source.product_name,
      review_type: reviewType,
      amazon_order_number: source.amazon_order_number_normalized,
      amazon_order_date: source.amazon_order_date,
      final_paid_jpy: fixedIntegerString(finalPaidJpy),
      confirmed_at: now,
      confirmed_business_date: businessDate,
      financial_snapshot: financialSnapshot,
      replayed: false,
    };
    const approval: ApproveStaffOrderEvidenceResult = {
      formal_order_id: formalOrderId,
      order_evidence_submission_id: source.submission_id,
      status: 'CONFIRMED',
      version: 1,
      reference_order_amount_jpy: String(source.reference_order_amount_jpy),
      final_paid_jpy: String(source.final_paid_jpy),
      price_difference_jpy: String(source.price_difference_jpy),
      price_mismatch_acknowledged: mismatch,
      confirmed_at: now,
      replayed: false,
    };
    const response: AtomicOrderEvidenceApprovalResult = {
      approval,
      formalOrder,
    };
    const mismatchFacts = {
      reference_order_amount_jpy: source.reference_order_amount_jpy,
      final_paid_jpy: source.final_paid_jpy,
      price_difference_jpy: source.price_difference_jpy,
      price_mismatch_acknowledged: mismatch,
      price_mismatch_reason: mismatch ? normalizedReason : null,
      confirmed_by_staff_id: command.actor.staffId,
    };
    const formalOutbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `formal-order-confirmed:${formalOrderId}`,
      eventType: 'FORMAL_ORDER_CONFIRMED',
      aggregateType: 'FORMAL_ORDER',
      aggregateId: formalOrderId,
      payload: formalOrder,
      createdAt: now,
    });
    const evidenceOutbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `order-evidence-approved:${submissionId}:${expectedVersion}`,
      eventType: 'ORDER_EVIDENCE_VERIFIED',
      aggregateType: 'ORDER_EVIDENCE',
      aggregateId: submissionId,
      payload: {
        submission_id: submissionId,
        evidence_version_id: source.evidence_version_id,
        formal_order_id: formalOrderId,
        ...mismatchFacts,
      },
      createdAt: now,
    });
    const principalPayable = await prepareSellerPayableCreation(database, {
      sellerOrganizationId: source.seller_organization_id,
      formalOrderId,
      payableType: 'SELLER_PRINCIPAL',
      amountCnyFen: toD1SafeInteger(sellerExpectedPrincipal),
      financialSnapshotId: snapshotId,
      sourceType: 'FORMAL_ORDER',
      sourceId: formalOrderId,
      dueAt: now,
      createdAt: now,
      actor: {
        type: 'STAFF',
        id: command.actor.staffId,
        roles: command.actor.roles,
      },
      requestId: command.requestId ?? null,
      idempotencyKey: acquired.claim.idempotencyKey,
    });
    const workItemStatements = await prepareWorkItemCompletionStatements(database, {
      workType: 'ORDER_EVIDENCE_REVIEW',
      sourceEntityType: 'ORDER_EVIDENCE',
      sourceEntityId: submissionId,
      outcome: 'COMPLETED',
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      requestId: command.requestId ?? null,
      idempotencyKey: acquired.claim.idempotencyKey,
      now,
    });

    // 卖家订单截图分发（用户拍板：审核通过后卖家可见）。克隆买家截图为
    // SELLER_VISIBLE 副本挂正式订单 + 卖家组织授权；原件与买家链路不动。
    // 未提供 storage（历史测试夹具）时跳过。
    let sellerCopyStatements: readonly SqlStatement[] = [];
    if (command.deps?.storage !== undefined) {
      sellerCopyStatements = await prepareSellerScreenshotCopy(
        database,
        command.deps.storage,
        {
          evidenceVersionId: source.evidence_version_id,
          submissionId,
          formalOrderId,
          sellerOrganizationId: source.seller_organization_id,
          staffId: command.actor.staffId,
          staffRoles: command.actor.roles,
          idempotencyKey: acquired.claim.idempotencyKey,
          requestId: command.requestId ?? null,
          now,
        },
      );
    }

    const statements: SqlStatement[] = [
      ...buyerNumber.statements,
      verifyEvidenceStatement(
        database,
        source,
        expectedVersion,
        internalNote,
        command.actor.staffId,
        now,
      ),
      assertPreviousStatementChangedOnce(database),
      insertOrderEvidenceEventStatement(database, {
        submissionId,
        reservationId: source.reservation_id,
        buyerCustomerId: source.buyer_customer_id,
        evidenceVersionId: source.evidence_version_id,
        eventType: 'ORDER_EVIDENCE_VERIFIED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousStatus: 'PENDING_VERIFICATION',
        nextStatus: 'VERIFIED',
        aggregateVersion: expectedVersion + 1,
        internalNote,
        metadata: mismatchFacts,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ORDER_EVIDENCE',
        aggregateId: submissionId,
        eventType: 'ORDER_EVIDENCE_VERIFIED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: 'PENDING_VERIFICATION',
          version: expectedVersion,
        },
        nextState: {
          status: 'VERIFIED',
          version: expectedVersion + 1,
        },
        metadata: { ...mismatchFacts, internal_review_note: internalNote },
        createdAt: now,
      }),
      database
        .prepare(
          `
        INSERT INTO formal_orders (
          id, order_evidence_submission_id, order_evidence_version_id,
          order_instruction_id, order_instruction_version_id,
          reservation_id, demand_batch_id, buyer_customer_id,
          buyer_customer_no, seller_organization_id, store_id,
          marketplace_code, product_id, product_version_id,
          product_version_no, asin_display, asin_normalized,
          product_name_snapshot, review_type, amazon_order_number_raw,
          amazon_order_number_normalized, amazon_order_date,
          final_paid_jpy, status, version,
          confirmed_by_staff_id, confirmed_at, confirmed_business_date, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'JP',
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', 1, ?, ?, ?, ?
        )
      `,
        )
        .bind(
          formalOrderId,
          source.submission_id,
          source.evidence_version_id,
          instruction.instruction_id,
          instruction.instruction_version_id,
          source.reservation_id,
          source.demand_batch_id,
          source.buyer_customer_id,
          buyerNumber.buyerCustomerNo,
          source.seller_organization_id,
          source.store_id,
          source.product_id,
          source.product_version_id,
          source.product_version_no,
          source.asin_display,
          source.asin_normalized,
          source.product_name,
          reviewType,
          source.amazon_order_number_raw,
          source.amazon_order_number_normalized,
          source.amazon_order_date,
          toD1SafeInteger(finalPaidJpy),
          command.actor.staffId,
          now,
          businessDate,
          now,
        ),
      assertPreviousStatementChangedOnce(database),
      finalizeOrderNumberClaimStatement(database, {
        marketplaceCode: 'JP',
        amazonOrderNumberNormalized: source.amazon_order_number_normalized,
        evidenceSubmissionId: source.submission_id,
        evidenceVersionId: source.evidence_version_id,
        formalOrderId,
        now,
      }),
      assertPreviousStatementChangedOnce(database),
      financialSnapshotStatement(database, formalOrderId, financialSnapshot, instruction, now),
      assertPreviousStatementChangedOnce(database),
      insertSellerPrincipalRateSnapshotStatement(
        database,
        formalOrderId,
        sellerPrincipalRateSnapshot,
        now,
      ),
      assertPreviousStatementChangedOnce(database),
      marketplaceMoneySnapshotStatement(database, formalOrderId, source, financialSnapshot, now),
      assertPreviousStatementChangedOnce(database),
      ...principalPayable.statements,
      database
        .prepare(
          `
        INSERT INTO formal_order_events (
          id, formal_order_id, order_evidence_submission_id,
          reservation_id, event_type, actor_staff_id,
          previous_status, next_status, order_version,
          metadata_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'FORMAL_ORDER_CONFIRMED', ?,
          NULL, 'CONFIRMED', 1, ?, ?, ?)
      `,
        )
        .bind(
          crypto.randomUUID(),
          formalOrderId,
          source.submission_id,
          source.reservation_id,
          command.actor.staffId,
          canonicalJson({
            financial_snapshot_id: snapshotId,
            seller_principal_payable_id: principalPayable.payableId,
            buyer_number_allocated: buyerNumber.allocated,
            order_evidence_version_id: source.evidence_version_id,
            ...mismatchFacts,
          }),
          acquired.claim.idempotencyKey,
          now,
        ),
      assertPreviousStatementChangedOnce(database),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'FORMAL_ORDER',
        aggregateId: formalOrderId,
        eventType: 'FORMAL_ORDER_CONFIRMED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          order_evidence_status: 'VERIFIED',
          order_evidence_version: expectedVersion + 1,
        },
        nextState: formalOrder,
        metadata: {
          financial_snapshot_id: snapshotId,
          seller_principal_payable_id: principalPayable.payableId,
          buyer_number_allocated: buyerNumber.allocated,
          ...mismatchFacts,
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, evidenceOutbox),
      ...createOutboxStatements(database, formalOutbox),
      ...completeFormalInstructionStatements(database, {
        source: instruction,
        reservationId: source.reservation_id,
        formalOrderId,
        now,
      }),
      consumeVerifiedEvidenceStatement(database, source, expectedVersion + 1, now),
      assertPreviousStatementChangedOnce(database),
      ...workItemStatements,
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          formal_order_id: formalOrderId,
          financial_snapshot_id: snapshotId,
          seller_principal_payable_id: principalPayable.payableId,
          order_evidence_submission_id: source.submission_id,
          reservation_id: source.reservation_id,
        },
        now,
      }),
      assertAtomicApprovalStatement(
        database,
        acquired.claim,
        source,
        formalOrder,
        buyerNumber,
        principalPayable.payableId,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch([...statements, ...sellerCopyStatements]);
    return response;
  } catch (error) {
    const normalized = normalizeAtomicApprovalError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now).catch(() => false);
    throw normalized;
  }
}

/**
 * Read-only approval preparation.  It deliberately uses the same order-date
 * rate and policy resolvers as approval, but it does not reserve numbers,
 * write idempotency records, or advance any business fact.  The command still
 * repeats all checks atomically at approval time to avoid a TOCTOU success.
 */
export async function readOrderEvidenceApprovalPreflight(
  database: SqlDatabase,
  input: { submissionId: string; at?: number },
): Promise<OrderEvidenceApprovalPreflight> {
  const submissionId = cleanFormalOrderIdentifier(input.submissionId);
  const now = cleanFormalOrderTimestamp(input.at ?? Date.now());
  const source = await requireAtomicApprovalSource(database, submissionId);
  const orderDate = source.amazon_order_date;
  const path = (section: string) =>
    `/staff/finance?section=${section}` +
    (orderDate === null ? '' : `&business_date=${encodeURIComponent(orderDate)}`) +
    `&seller_organization_id=${encodeURIComponent(source.seller_organization_id)}`;
  if (orderDate === null) {
    return {
      submission_id: source.submission_id,
      amazon_order_date: null,
      ready: false,
      checks: [
        {
          code: 'ORDER_DAY_BASE_RATE',
          status: 'MISSING',
          message: '订单资料缺少 Amazon 订单日期，无法确定唯一订单日基础汇率。',
          action_path: path('base-rate'),
          required_access: '订单资料复核权限',
        },
      ],
    };
  }
  const checks: OrderEvidenceApprovalPreflight['checks'][number][] = [];
  let baseReady = false;
  try {
    const resolvedRate = await resolveBuyerDailyExchangeRate(database, {
      businessDate: orderDate,
      asOf: now,
    });
    baseReady = true;
    checks.push({
      code: 'ORDER_DAY_BASE_RATE',
      status: 'READY',
      message: resolvedRate.business_date === orderDate
        ? `已确认 ${orderDate} 的订单日基础汇率。`
        : `订单日 ${orderDate} 无当日汇率，确认时将回退采用 ${resolvedRate.business_date} 的已确认汇率（快照记录实际采用日期）。`,
      action_path: path('base-rate'),
      required_access: 'Owner + SELLER_MANAGE + FINANCIAL_CORRECT',
    });
  } catch {
    checks.push({
      code: 'ORDER_DAY_BASE_RATE',
      status: 'MISSING',
      message: `缺少 ${orderDate} 及此前任一日的 JPY → CNY 已确认订单日基础汇率。`,
      action_path: path('base-rate'),
      required_access: 'Owner + SELLER_MANAGE + FINANCIAL_CORRECT',
    });
  }
  const policy = await readSellerPrincipalRatePolicies(database, {
    sourceCurrencyCode: 'JPY',
    sellerOrganizationId: source.seller_organization_id,
    at: now,
  });
  checks.push(
    policy.selected_policy === null
      ? {
          code: 'SELLER_PRINCIPAL_MARKUP',
          status: 'MISSING',
          message: '缺少已确认且已生效的卖家本金汇率加点（组织覆盖优先于默认加点）。',
          action_path: path('seller-markup'),
          required_access: 'seller_ops + SELLER_MANAGE（提交） / Owner + FINANCIAL_CORRECT（确认）',
        }
      : {
          code: 'SELLER_PRINCIPAL_MARKUP',
          status: 'READY',
          message:
            policy.selected_policy.scope_type === 'SELLER_ORGANIZATION'
              ? '已使用卖家组织专属加点。'
              : '已使用币种对默认加点。',
          action_path: path('seller-markup'),
          required_access: '已确认快照将冻结所选策略版本',
        },
  );
  // The seller-principal calculation reads the canonical projection of the
  // same base-rate row.  Surface a broken projection as a base-rate gap before
  // any approval command can create partial financial facts.
  if (baseReady && policy.selected_policy !== null) {
    try {
      await resolveSellerPrincipalRateSnapshot(database, {
        sellerOrganizationId: source.seller_organization_id,
        platformOrderDate: orderDate,
        paymentAmountMinor: source.final_paid_jpy,
        paymentCurrencyCode: 'JPY',
        at: now,
      });
    } catch {
      baseReady = false;
      const index = checks.findIndex((check) => check.code === 'ORDER_DAY_BASE_RATE');
      checks[index] = {
        code: 'ORDER_DAY_BASE_RATE',
        status: 'MISSING',
        message: `订单日基础汇率 ${orderDate} 的 JPY → CNY 权威投影尚未形成，暂不能确认订单。`,
        action_path: path('base-rate'),
        required_access: 'Owner + SELLER_MANAGE + FINANCIAL_CORRECT',
      };
    }
  }
  try {
    const reviewType = requireFormalOrderReviewType(source.review_type);
    await resolveSellerServiceFee(database, {
      sellerOrganizationId: source.seller_organization_id,
      reviewType,
      at: now,
    });
    checks.push({
      code: 'SELLER_SERVICE_FEE',
      status: 'READY',
      message: '已找到已确认且已生效的卖家服务费。',
      action_path: path('service-fee'),
      required_access: '财务配置权限',
    });
  } catch {
    checks.push({
      code: 'SELLER_SERVICE_FEE',
      status: 'MISSING',
      message: '缺少已确认且已生效的卖家服务费；请完成服务费财务配置后再通过。',
      action_path: path('service-fee'),
      required_access: '财务配置权限',
    });
  }
  return {
    submission_id: source.submission_id,
    amazon_order_date: orderDate,
    ready: baseReady && checks.every((check) => check.status === 'READY'),
    checks,
  };
}

async function requireAtomicApprovalSource(
  database: SqlDatabase,
  submissionId: string,
): Promise<AtomicApprovalSource> {
  const row = await database
    .prepare(
      `
    SELECT submission.id AS submission_id,
      submission.reservation_id, submission.buyer_customer_id,
      submission.marketplace_code, submission.status AS evidence_status,
      submission.current_version_no AS evidence_current_version_no,
      submission.version AS evidence_aggregate_version,
      evidence.id AS evidence_version_id,
      evidence.amazon_order_number_raw,
      evidence.amazon_order_number_normalized,
      evidence.amazon_order_date,
      evidence.final_paid_jpy,
      evidence.reference_order_amount_jpy_snapshot AS reference_order_amount_jpy,
      evidence.price_difference_jpy, evidence.price_mismatch,
      evidence.evidence_file_object_id,
      (SELECT COUNT(*) FROM order_evidence_version_files version_file
        WHERE version_file.version_id=evidence.id) AS evidence_file_count,
      file.status AS file_status, file.purpose AS file_purpose,
      file.visibility AS file_visibility, file.version AS file_version,
      intent.owner_actor_type AS file_owner_actor_type,
      intent.owner_actor_id AS file_owner_actor_id,
      reservation.status AS reservation_status,
      reservation.version AS reservation_version,
      reservation.demand_batch_id,
      reservation.organization_id AS seller_organization_id,
      reservation.store_id, reservation.product_id,
      reservation.product_version_no,
      demand.task_type AS review_type,
      product.asin_display, product.asin_normalized,
      product_version.id AS product_version_id,
      product_version.product_name,
      buyer.access_status AS buyer_access_status,
      buyer.buyer_customer_no, buyer.buyer_sequence,
      buyer.first_valid_order_business_date,
      buyer.buyer_channel_id, buyer.version AS buyer_version,
      channel.code AS channel_code, channel.status AS channel_status,
      channel.next_sequence AS channel_next_sequence,
      channel.version AS channel_version,
      preorder.buyer_customer_no AS preorder_buyer_customer_no,
      preorder.buyer_sequence AS preorder_buyer_sequence,
      existing.id AS existing_formal_order_id
    FROM order_evidence_submissions submission
    JOIN order_evidence_versions evidence
      ON evidence.submission_id=submission.id
      AND evidence.version_no=submission.current_version_no
    LEFT JOIN file_objects file ON file.id=evidence.evidence_file_object_id
    LEFT JOIN file_upload_intents intent ON intent.id=file.upload_intent_id
    JOIN product_reservations reservation ON reservation.id=submission.reservation_id
    JOIN demand_batches demand ON demand.id=reservation.demand_batch_id
    JOIN products product ON product.id=reservation.product_id
    JOIN product_versions product_version
      ON product_version.product_id=reservation.product_id
      AND product_version.version_no=reservation.product_version_no
    JOIN buyer_customers buyer ON buyer.id=submission.buyer_customer_id
    JOIN buyer_channels channel ON channel.id=buyer.buyer_channel_id
    LEFT JOIN buyer_preorder_number_allocations preorder
      ON preorder.buyer_customer_id=buyer.id
    LEFT JOIN formal_orders existing
      ON existing.order_evidence_submission_id=submission.id
      OR existing.reservation_id=reservation.id
    WHERE submission.id=?
    LIMIT 1
  `,
    )
    .bind(submissionId)
    .first<AtomicApprovalSource>();
  if (!row) throw new AtomicOrderEvidenceApprovalError('NOT_FOUND', 404);
  return normalizeSource(row);
}

function validateSource(source: AtomicApprovalSource, expectedVersion: number): void {
  if (source.existing_formal_order_id !== null) {
    throw new AtomicOrderEvidenceApprovalError('STATE_CONFLICT', 409);
  }
  if (source.evidence_aggregate_version !== expectedVersion) {
    throw new AtomicOrderEvidenceApprovalError('VERSION_CONFLICT', 409);
  }
  if (
    source.evidence_status !== 'PENDING_VERIFICATION' ||
    source.reservation_status !== 'APPROVED' ||
    source.buyer_access_status !== 'ACTIVE' ||
    source.marketplace_code !== 'JP'
  ) {
    throw new AtomicOrderEvidenceApprovalError('STATE_CONFLICT', 409);
  }
  if (
    !Number.isSafeInteger(source.final_paid_jpy) ||
    source.final_paid_jpy < 0 ||
    !Number.isSafeInteger(source.reference_order_amount_jpy) ||
    source.reference_order_amount_jpy < 0 ||
    source.price_difference_jpy !== source.final_paid_jpy - source.reference_order_amount_jpy ||
    source.price_mismatch !== (source.price_difference_jpy === 0 ? 0 : 1)
  ) {
    throw new AtomicOrderEvidenceApprovalError('DEPENDENCY_UNAVAILABLE', 503);
  }
  if (
    source.evidence_file_count !== 1 ||
    !source.evidence_file_object_id ||
    source.file_status !== 'VERIFIED' ||
    source.file_purpose !== 'ORDER_EVIDENCE' ||
    source.file_visibility !== 'BUYER_VISIBLE' ||
    source.file_owner_actor_type !== 'BUYER_CUSTOMER' ||
    source.file_owner_actor_id !== source.buyer_customer_id ||
    !Number.isSafeInteger(source.file_version) ||
    Number(source.file_version) < 1
  ) {
    throw new AtomicOrderEvidenceApprovalError('STATE_CONFLICT', 409);
  }
}

function validateMismatchDecision(input: {
  mismatch: boolean;
  acknowledged: boolean | undefined;
  reason: string | null;
}): void {
  if (input.mismatch) {
    if (input.acknowledged !== true) {
      throw new AtomicOrderEvidenceApprovalError('PRICE_MISMATCH', 409);
    }
    if (!input.reason) {
      throw new AtomicOrderEvidenceApprovalError('VALIDATION_ERROR', 400);
    }
    return;
  }
  if (input.acknowledged === true || input.reason !== null) {
    throw new AtomicOrderEvidenceApprovalError('VALIDATION_ERROR', 400);
  }
}

function verifyEvidenceStatement(
  database: SqlDatabase,
  source: AtomicApprovalSource,
  expectedVersion: number,
  internalNote: string | null,
  staffId: string,
  now: number,
): SqlStatement {
  return database
    .prepare(
      `
    UPDATE order_evidence_submissions
    SET status='VERIFIED', version=version+1,
      public_change_reason=NULL, internal_review_note=?,
      updated_at=MAX(?, updated_at+1),
      verified_by_staff_id=?, verified_at=?,
      withdrawn_at=NULL, consumed_at=NULL,
      resubmission_deadline_at=NULL
    WHERE id=? AND status='PENDING_VERIFICATION'
      AND version=? AND current_version_no=?
      AND EXISTS (
        SELECT 1 FROM order_evidence_versions evidence
        JOIN file_objects file ON file.id=evidence.evidence_file_object_id
        JOIN file_upload_intents intent ON intent.id=file.upload_intent_id
        WHERE evidence.id=? AND evidence.submission_id=?
          AND evidence.version_no=?
          AND file.status='VERIFIED'
          AND file.purpose='ORDER_EVIDENCE'
          AND intent.status='VERIFIED'
          AND intent.owner_actor_type='BUYER_CUSTOMER'
          AND intent.owner_actor_id=?
          AND (SELECT COUNT(*) FROM order_evidence_version_files vf
            WHERE vf.version_id=evidence.id)=1
      )
  `,
    )
    .bind(
      internalNote,
      now,
      staffId,
      now,
      source.submission_id,
      expectedVersion,
      source.evidence_current_version_no,
      source.evidence_version_id,
      source.submission_id,
      source.evidence_current_version_no,
      source.buyer_customer_id,
    );
}

function consumeVerifiedEvidenceStatement(
  database: SqlDatabase,
  source: AtomicApprovalSource,
  verifiedVersion: number,
  now: number,
): SqlStatement {
  return database
    .prepare(
      `
    UPDATE order_evidence_submissions
    SET status='CONSUMED', version=version+1,
      updated_at=MAX(?, updated_at+1), consumed_at=?
    WHERE id=? AND status='VERIFIED' AND version=?
      AND current_version_no=? AND verified_at=?
  `,
    )
    .bind(now, now, source.submission_id, verifiedVersion, source.evidence_current_version_no, now);
}

function financialSnapshotStatement(
  database: SqlDatabase,
  formalOrderId: string,
  snapshot: FormalOrderFinancialSnapshotProjection,
  instruction: {
    buyer_self_pay_bps: number;
    buyer_self_pay_jpy: number;
    buyer_refundable_principal_jpy: number;
  },
  now: number,
): SqlStatement {
  return database
    .prepare(
      `
    INSERT INTO formal_order_financial_snapshots (
      id, formal_order_id, snapshot_version,
      buyer_rate_version_id, buyer_rate_version_no,
      buyer_rate_business_date, buyer_rate_confirmed_at,
      buyer_cny_per_jpy_e8,
      service_fee_version_id, service_fee_version_no,
      service_fee_effective_from, service_fee_confirmed_at,
      service_fee_cny_fen, buyer_self_pay_bps, buyer_self_pay_jpy,
      buyer_refundable_principal_jpy, buyer_gross_principal_cny_fen,
      buyer_self_pay_contribution_cny_fen,
      buyer_expected_principal_cny_fen,
      seller_expected_principal_cny_fen, rounding_rule, created_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, 'HALF_UP', ?)
  `,
    )
    .bind(
      snapshot.snapshot_id,
      formalOrderId,
      snapshot.buyer_rate_version_id,
      snapshot.buyer_rate_version_no,
      snapshot.buyer_rate_business_date,
      snapshot.buyer_rate_confirmed_at,
      Number(snapshot.buyer_cny_per_jpy_e8),
      snapshot.service_fee_version_id,
      snapshot.service_fee_version_no,
      snapshot.service_fee_effective_from,
      snapshot.service_fee_confirmed_at,
      Number(snapshot.service_fee_cny_fen),
      instruction.buyer_self_pay_bps,
      instruction.buyer_self_pay_jpy,
      instruction.buyer_refundable_principal_jpy,
      Number(snapshot.buyer_gross_principal_cny_fen),
      Number(snapshot.buyer_self_pay_contribution_cny_fen),
      Number(snapshot.buyer_expected_principal_cny_fen),
      Number(snapshot.seller_expected_principal_cny_fen),
      now,
    );
}

function marketplaceMoneySnapshotStatement(
  database: SqlDatabase,
  formalOrderId: string,
  source: AtomicApprovalSource,
  snapshot: FormalOrderFinancialSnapshotProjection,
  now: number,
): SqlStatement {
  return database
    .prepare(
      `
    INSERT INTO formal_order_marketplace_money_snapshots (
      formal_order_id,buyer_customer_id,seller_organization_id,store_id,
      marketplace_code,review_type,platform_order_identifier,
      platform_product_identifier,platform_order_date,payment_amount_minor,
      payment_currency_code,payment_currency_exponent,buyer_rate_version_id,
      buyer_rate_version_no,buyer_rate_confirmed_at,buyer_rate_value,
      buyer_rate_scale,source_currency_code,quote_currency_code,
      source_currency_exponent,quote_currency_exponent,rounding_rule,
      service_fee_rule_version_id,service_fee_rule_version_no,
      service_fee_effective_from,service_fee_confirmed_at,
      service_fee_amount_minor,service_fee_currency_code,
      buyer_expected_principal_amount_minor,
      seller_expected_principal_amount_minor,created_at
    ) VALUES (
      ?,?,?,?,'AMAZON_JP',?,?,?,?,?,'JPY',0,?,?,?, ?,100000000,
      'JPY','CNY',0,2,'HALF_UP',?,?,?,?,?,'CNY',?,?,?
    )
  `,
    )
    .bind(
      formalOrderId,
      source.buyer_customer_id,
      source.seller_organization_id,
      source.store_id,
      source.review_type,
      source.amazon_order_number_normalized,
      source.asin_normalized,
      source.amazon_order_date,
      source.final_paid_jpy,
      `currency-${snapshot.buyer_rate_version_id}`,
      snapshot.buyer_rate_version_no,
      snapshot.buyer_rate_confirmed_at,
      Number(snapshot.buyer_cny_per_jpy_e8),
      `marketplace-${snapshot.service_fee_version_id}`,
      snapshot.service_fee_version_no,
      snapshot.service_fee_effective_from,
      snapshot.service_fee_confirmed_at,
      Number(snapshot.service_fee_cny_fen),
      Number(snapshot.buyer_expected_principal_cny_fen),
      Number(snapshot.seller_expected_principal_cny_fen),
      now,
    );
}

function prepareBuyerNumberPlan(
  database: SqlDatabase,
  source: AtomicApprovalSource,
  businessDate: string,
  actorStaffId: string,
  idempotencyKey: string,
  now: number,
): BuyerNumberPlan {
  const hasNumber = source.buyer_customer_no !== null;
  const hasSequence = source.buyer_sequence !== null;
  const hasDate = source.first_valid_order_business_date !== null;
  if (hasNumber || hasSequence || hasDate) {
    if (
      !hasNumber ||
      !hasSequence ||
      !hasDate ||
      !Number.isSafeInteger(source.buyer_sequence) ||
      Number(source.buyer_sequence) < 1
    ) {
      throw new AtomicOrderEvidenceApprovalError('DEPENDENCY_UNAVAILABLE', 503);
    }
    return {
      buyerCustomerNo: source.buyer_customer_no as string,
      allocated: false,
      sequence: Number(source.buyer_sequence),
      firstValidOrderBusinessDate: source.first_valid_order_business_date as string,
      statements: [],
    };
  }
  // D2：注册时预分配（preorder）的编号在首单确认时转正——沿用预分配的
  // 编号与序号写入主表三字段，不推进渠道计数器（号已在注册时预占）。
  if (
    source.preorder_buyer_customer_no !== null &&
    Number.isSafeInteger(source.preorder_buyer_sequence) &&
    Number(source.preorder_buyer_sequence) >= 1
  ) {
    const preorderSequence = Number(source.preorder_buyer_sequence);
    return {
      buyerCustomerNo: source.preorder_buyer_customer_no,
      allocated: false,
      sequence: preorderSequence,
      firstValidOrderBusinessDate: businessDate,
      statements: [
        database
          .prepare(
            `
        UPDATE buyer_customers SET buyer_customer_no=?, buyer_sequence=?,
          first_valid_order_business_date=?, version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=? AND access_status='ACTIVE'
          AND buyer_customer_no IS NULL AND buyer_sequence IS NULL
          AND first_valid_order_business_date IS NULL AND version=?
      `,
          )
          .bind(
            source.preorder_buyer_customer_no,
            preorderSequence,
            businessDate,
            now,
            source.buyer_customer_id,
            source.buyer_version,
          ),
        assertPreviousStatementChangedOnce(database),
        database
          .prepare(
            `
        INSERT INTO buyer_number_allocation_events (
          id, buyer_customer_id, buyer_channel_id, buyer_customer_no,
          buyer_sequence, first_valid_order_business_date,
          actor_staff_id, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
          )
          .bind(
            crypto.randomUUID(),
            source.buyer_customer_id,
            source.buyer_channel_id,
            source.preorder_buyer_customer_no,
            preorderSequence,
            businessDate,
            actorStaffId,
            idempotencyKey,
            now,
          ),
        assertPreviousStatementChangedOnce(database),
      ],
    };
  }
  if (
    source.channel_status !== 'ACTIVE' ||
    !Number.isSafeInteger(source.channel_next_sequence) ||
    source.channel_next_sequence < 1
  ) {
    throw new AtomicOrderEvidenceApprovalError('STATE_CONFLICT', 409);
  }
  const sequence = source.channel_next_sequence;
  const buyerCustomerNo = formatBuyerCustomerNumber({
    businessDate,
    channelCode: source.channel_code,
    sequence,
  });
  return {
    buyerCustomerNo,
    allocated: true,
    sequence,
    firstValidOrderBusinessDate: businessDate,
    statements: [
      database
        .prepare(
          `
        UPDATE buyer_channels SET next_sequence=next_sequence+1,
          version=version+1, updated_at=MAX(?, updated_at+1)
        WHERE id=? AND status='ACTIVE' AND next_sequence=? AND version=?
      `,
        )
        .bind(now, source.buyer_channel_id, sequence, source.channel_version),
      assertPreviousStatementChangedOnce(database),
      database
        .prepare(
          `
        UPDATE buyer_customers SET buyer_customer_no=?, buyer_sequence=?,
          first_valid_order_business_date=?, version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=? AND access_status='ACTIVE'
          AND buyer_customer_no IS NULL AND buyer_sequence IS NULL
          AND first_valid_order_business_date IS NULL AND version=?
      `,
        )
        .bind(
          buyerCustomerNo,
          sequence,
          businessDate,
          now,
          source.buyer_customer_id,
          source.buyer_version,
        ),
      assertPreviousStatementChangedOnce(database),
      database
        .prepare(
          `
        INSERT INTO buyer_number_allocation_events (
          id, buyer_customer_id, buyer_channel_id, buyer_customer_no,
          buyer_sequence, first_valid_order_business_date,
          actor_staff_id, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .bind(
          crypto.randomUUID(),
          source.buyer_customer_id,
          source.buyer_channel_id,
          buyerCustomerNo,
          sequence,
          businessDate,
          actorStaffId,
          idempotencyKey,
          now,
        ),
      assertPreviousStatementChangedOnce(database),
    ],
  };
}

function assertAtomicApprovalStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  source: AtomicApprovalSource,
  formalOrder: ConfirmFormalOrderResult,
  buyerNumber: BuyerNumberPlan,
  payableId: string,
): SqlStatement {
  return database
    .prepare(
      `
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (SELECT 1 FROM formal_orders
        WHERE id=? AND order_evidence_submission_id=?
          AND order_evidence_version_id=? AND status='CONFIRMED'
          AND final_paid_jpy=? AND confirmed_by_staff_id=?)
      AND EXISTS (SELECT 1 FROM formal_order_financial_snapshots
        WHERE id=? AND formal_order_id=?
          AND buyer_gross_principal_cny_fen=?
          AND seller_expected_principal_cny_fen=?)
      AND EXISTS (SELECT 1 FROM seller_principal_rate_snapshots
        WHERE formal_order_id=? AND policy_version_id=?
          AND seller_expected_principal_amount_minor=?)
      AND EXISTS (SELECT 1 FROM formal_order_marketplace_money_snapshots
        WHERE formal_order_id=?
          AND buyer_expected_principal_amount_minor=?
          AND seller_expected_principal_amount_minor=?)
      AND EXISTS (SELECT 1 FROM seller_payables
        WHERE id=? AND formal_order_id=? AND payable_type='SELLER_PRINCIPAL')
      AND EXISTS (SELECT 1 FROM order_evidence_submissions
        WHERE id=? AND status='CONSUMED' AND version=?
          AND verified_by_staff_id=? AND verified_at=? AND consumed_at=?)
      AND EXISTS (SELECT 1 FROM formal_order_number_claims
        WHERE formal_order_id=? AND status='FINAL')
      AND EXISTS (SELECT 1 FROM command_idempotency_records
        WHERE actor_type=? AND actor_id=? AND idempotency_key=?
          AND status='COMMITTED' AND lease_token=?)
      AND EXISTS (SELECT 1 FROM buyer_customers
        WHERE id=? AND buyer_customer_no=? AND buyer_sequence=?)
      AND (?=0 OR EXISTS (SELECT 1 FROM buyer_number_allocation_events
        WHERE buyer_customer_id=? AND buyer_customer_no=?
          AND buyer_sequence=?))
    THEN 1 ELSE 0 END
  `,
    )
    .bind(
      formalOrder.formal_order_id,
      source.submission_id,
      source.evidence_version_id,
      source.final_paid_jpy,
      claim.actorId,
      formalOrder.financial_snapshot.snapshot_id,
      formalOrder.formal_order_id,
      Number(formalOrder.financial_snapshot.buyer_gross_principal_cny_fen),
      Number(formalOrder.financial_snapshot.seller_expected_principal_cny_fen),
      formalOrder.formal_order_id,
      formalOrder.financial_snapshot.seller_principal_rate_snapshot.policy_version_id,
      Number(formalOrder.financial_snapshot.seller_expected_principal_cny_fen),
      formalOrder.formal_order_id,
      Number(formalOrder.financial_snapshot.buyer_expected_principal_cny_fen),
      Number(formalOrder.financial_snapshot.seller_expected_principal_cny_fen),
      payableId,
      formalOrder.formal_order_id,
      source.submission_id,
      source.evidence_aggregate_version + 2,
      claim.actorId,
      formalOrder.confirmed_at,
      formalOrder.confirmed_at,
      formalOrder.formal_order_id,
      claim.actorType,
      claim.actorId,
      claim.idempotencyKey,
      claim.leaseToken,
      source.buyer_customer_id,
      buyerNumber.buyerCustomerNo,
      buyerNumber.sequence,
      buyerNumber.allocated ? 1 : 0,
      source.buyer_customer_id,
      buyerNumber.buyerCustomerNo,
      buyerNumber.sequence,
    );
}

function normalizeSource(row: AtomicApprovalSource): AtomicApprovalSource {
  return {
    ...row,
    evidence_current_version_no: Number(row.evidence_current_version_no),
    evidence_aggregate_version: Number(row.evidence_aggregate_version),
    final_paid_jpy: Number(row.final_paid_jpy),
    reference_order_amount_jpy: Number(row.reference_order_amount_jpy),
    price_difference_jpy: Number(row.price_difference_jpy),
    price_mismatch: Number(row.price_mismatch),
    evidence_file_count: Number(row.evidence_file_count),
    file_version: row.file_version === null ? null : Number(row.file_version),
    reservation_version: Number(row.reservation_version),
    product_version_no: Number(row.product_version_no),
    buyer_sequence: row.buyer_sequence === null ? null : Number(row.buyer_sequence),
    buyer_version: Number(row.buyer_version),
    channel_next_sequence: Number(row.channel_next_sequence),
    channel_version: Number(row.channel_version),
  };
}

function normalizeAtomicApprovalError(error: unknown): AtomicOrderEvidenceApprovalError {
  if (error instanceof AtomicOrderEvidenceApprovalError) return error;
  if (error instanceof FormalOrderError) {
    const code =
      error.code === 'ORDER_EVIDENCE_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'FORMAL_ORDER_ALREADY_EXISTS' ||
            error.code === 'ORDER_EVIDENCE_STATE_CONFLICT' ||
            error.code === 'FORMAL_ORDER_STATE_CONFLICT' ||
            error.code === 'ORDER_NUMBER_ALREADY_CLAIMED' ||
            error.code === 'ORDER_NUMBER_CONFLICT_REQUIRES_REVIEW'
          ? 'STATE_CONFLICT'
          : error.code;
    if (
      code === 'VALIDATION_ERROR' ||
      code === 'FORBIDDEN' ||
      code === 'VERSION_CONFLICT' ||
      code === 'IDEMPOTENCY_CONFLICT' ||
      code === 'REQUEST_IN_PROGRESS' ||
      code === 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND' ||
      code === 'PRICING_RULE_NOT_FOUND' ||
      code === 'SELLER_PRINCIPAL_RATE_NOT_FOUND' ||
      code === 'DEPENDENCY_UNAVAILABLE'
    ) {
      return new AtomicOrderEvidenceApprovalError(code, error.status);
    }
    if (code === 'NOT_FOUND' || code === 'STATE_CONFLICT') {
      return new AtomicOrderEvidenceApprovalError(code, error.status);
    }
  }
  const formal = normalizeFormalOrderError(error);
  if (
    formal.code === 'VALIDATION_ERROR' ||
    formal.code === 'FORBIDDEN' ||
    formal.code === 'VERSION_CONFLICT' ||
    formal.code === 'IDEMPOTENCY_CONFLICT' ||
    formal.code === 'REQUEST_IN_PROGRESS' ||
    formal.code === 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND' ||
    formal.code === 'PRICING_RULE_NOT_FOUND' ||
    formal.code === 'SELLER_PRINCIPAL_RATE_NOT_FOUND' ||
    formal.code === 'DEPENDENCY_UNAVAILABLE'
  ) {
    return new AtomicOrderEvidenceApprovalError(formal.code, formal.status);
  }
  if (formal.status === 404) {
    return new AtomicOrderEvidenceApprovalError('NOT_FOUND', 404);
  }
  if (formal.status === 409) {
    return new AtomicOrderEvidenceApprovalError('STATE_CONFLICT', 409);
  }
  return new AtomicOrderEvidenceApprovalError('DEPENDENCY_UNAVAILABLE', 503);
}


async function prepareSellerScreenshotCopy(
  database: SqlDatabase,
  storage: ObjectStorageAdapter,
  input: {
    evidenceVersionId: string;
    submissionId: string;
    formalOrderId: string;
    sellerOrganizationId: string;
    staffId: string;
    staffRoles: readonly string[];
    idempotencyKey: string;
    requestId: string | null;
    now: number;
  },
): Promise<readonly SqlStatement[]> {
  const shot = await database.prepare(`
    SELECT link.file_object_id
    FROM order_evidence_version_files version_file
    JOIN file_entity_links link
      ON link.id=version_file.file_entity_link_id
      AND link.purpose='ORDER_EVIDENCE'
      AND link.revoked_at IS NULL
    JOIN file_objects object
      ON object.id=link.file_object_id
      AND object.status='VERIFIED'
      AND object.detected_mime IN ('image/jpeg', 'image/png', 'image/webp')
    WHERE version_file.version_id=?
      AND version_file.submission_id=?
    ORDER BY version_file.created_at, version_file.id
    LIMIT 1
  `).bind(input.evidenceVersionId, input.submissionId)
    .first<{ file_object_id: string }>();
  if (!shot) return [];

  const source = await readVerifiedFileObject(database, shot.file_object_id);
  const clone = await prepareFileObjectClone(database, storage, source, {
    ownerActorType: 'STAFF',
    ownerActorId: input.staffId,
    idempotencyKey: input.idempotencyKey,
    now: input.now,
    purpose: 'ORDER_EVIDENCE',
  });
  const preparedLink = await buildExplicitAudienceFileLinkStatements(
    database,
    { assertCanCreateUpload() {}, assertCanUpload() {}, assertCanCompleteUpload() {}, assertCanLink() {}, assertCanRead() {} },
    {
      upload_intent_id: clone.cloneIntentId,
      purpose: 'ORDER_EVIDENCE',
      visibility: 'SELLER_VISIBLE',
      version: 1,
      owner_actor_type: 'STAFF',
      owner_actor_id: input.staffId,
    },
    {
      fileObjectId: clone.cloneFileObjectId,
      expectedFileVersion: 1,
      entityType: 'ORDER',
      entityId: input.formalOrderId,
      expiresAt: null,
      grants: [
        {
          subjectType: 'SELLER_ORGANIZATION',
          sellerOrganizationId: input.sellerOrganizationId,
        },
        {
          subjectType: 'STAFF_INTERNAL',
          permissionCode: 'ORDER_VIEW',
          scope: { type: 'GLOBAL' },
        },
      ],
    },
    {
      actor: {
        type: 'STAFF',
        id: input.staffId,
        roles: input.staffRoles,
      },
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId,
      now: input.now,
    },
  );
  return [...clone.statements, ...preparedLink.statements];
}
