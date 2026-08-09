import type {
  ConfirmFormalOrderResult,
  FormalOrderFinancialSnapshotProjection,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  canonicalJson,
  chinaBusinessDate,
  convertJpyToCnyFen,
  fixedIntegerString,
  formatBuyerCustomerNumber,
  hashCanonicalJson,
  parseCnyFen,
  parseCnyPerJpyE8,
  parseJpyInteger,
  toD1SafeInteger,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  calculateBuyerFormalFinancials,
  completeFormalInstructionStatements,
  finalizeOrderNumberClaimStatement,
  requireProvisionalOrderNumberClaim,
  requireFormalInstructionSource,
} from '../order-instructions/formal-order-integration';
import { createOutboxStatements, prepareOutboxEvent } from '../foundation/outbox';
import { resolveBuyerDailyExchangeRate } from '../pricing/buyer-daily-exchange-rates';
import { resolveSellerAgreementRate } from '../pricing/seller-agreement-rates';
import {
  insertSellerPrincipalRateSnapshotStatement,
  resolveSellerPrincipalRateSnapshot,
} from '../pricing/seller-principal-rate-policy';
import { resolveSellerServiceFee } from '../pricing/seller-service-fees';
import { prepareSellerPayableCreation } from '../seller-settlements/payable-statements';
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
} from './formal-order-shared';

interface FormalOrderSourceRow {
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
  existing_formal_order_id: string | null;
}

interface BuyerNumberPlan {
  buyerCustomerNo: string;
  allocated: boolean;
  sequence: number;
  firstValidOrderBusinessDate: string;
  statements: readonly SqlStatement[];
}

export async function confirmFormalOrder(
  database: SqlDatabase,
  input: {
    orderEvidenceSubmissionId: string;
    expectedVersion: number;
  },
  command: {
    actor: FormalOrderStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
    sellerPrincipalRateEnforcementEnabled?: boolean;
  },
): Promise<ConfirmFormalOrderResult> {
  requireFormalOrderConfirmationPermission(command.actor);
  const submissionId = cleanFormalOrderIdentifier(input.orderEvidenceSubmissionId);
  const expectedVersion = cleanFormalOrderExpectedVersion(input.expectedVersion);
  const now = cleanFormalOrderTimestamp(command.now ?? Date.now());
  const businessDate = chinaBusinessDate(now);
  const requestHash = await hashCanonicalJson({
    action: 'CONFIRM_FORMAL_ORDER',
    order_evidence_submission_id: submissionId,
    expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<ConfirmFormalOrderResult>(database, {
    actorType: 'STAFF',
    actorId: command.actor.staffId,
    action: 'CONFIRM_FORMAL_ORDER',
    targetType: 'ORDER_EVIDENCE_SUBMISSION',
    targetId: submissionId,
    idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const source = await requireFormalOrderSource(database, submissionId);
    validateFormalOrderSource(source, expectedVersion);
    if (source.amazon_order_date === null) {
      throw new FormalOrderError('ORDER_EVIDENCE_STATE_CONFLICT', 409);
    }
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
    const buyerRate = await resolveBuyerDailyExchangeRate(database, {
      businessDate,
      asOf: now,
    });
    const sellerRate = await resolveSellerAgreementRate(database, {
      sellerOrganizationId: source.seller_organization_id,
      at: now,
    });
    const sellerPrincipalRateSnapshot = command.sellerPrincipalRateEnforcementEnabled === true
      ? await resolveSellerPrincipalRateSnapshot(database, {
          sellerOrganizationId: source.seller_organization_id,
          platformOrderDate: source.amazon_order_date,
          paymentAmountMinor: source.final_paid_jpy,
          paymentCurrencyCode: 'JPY',
          at: now,
        })
      : null;
    const serviceFee = await resolveSellerServiceFee(database, {
      sellerOrganizationId: source.seller_organization_id,
      reviewType,
      at: now,
    });
    const finalPaidJpy = parseJpyInteger(String(source.final_paid_jpy));
    const buyerRateValue = parseCnyPerJpyE8(buyerRate.cny_per_jpy_e8);
    const sellerRateValue = parseCnyPerJpyE8(sellerRate.cny_per_jpy_e8);
    const serviceFeeValue = parseCnyFen(serviceFee.fee_cny_fen);
    const buyerFinancial = calculateBuyerFormalFinancials({
      finalPaidJpy: Number(source.final_paid_jpy),
      buyerRefundablePrincipalJpy: Number(instruction.buyer_refundable_principal_jpy),
      buyerCnyPerJpyE8: buyerRate.cny_per_jpy_e8,
    });
    const buyerExpectedPrincipal = BigInt(buyerFinancial.buyerExpectedPrincipalCnyFen);
    const sellerExpectedPrincipal = sellerPrincipalRateSnapshot
      ? parseCnyFen(sellerPrincipalRateSnapshot.seller_expected_principal_amount_minor)
      : convertJpyToCnyFen(finalPaidJpy, sellerRateValue, 'HALF_UP');
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
      seller_rate_version_id: sellerRate.rate_version_id,
      seller_rate_version_no: sellerRate.version_no,
      seller_rate_effective_from: sellerRate.effective_from,
      seller_rate_confirmed_at: sellerRate.confirmed_at,
      seller_cny_per_jpy_e8: fixedIntegerString(sellerRateValue),
      service_fee_version_id: serviceFee.fee_version_id,
      service_fee_version_no: serviceFee.version_no,
      service_fee_effective_from: serviceFee.effective_from,
      service_fee_confirmed_at: serviceFee.confirmed_at,
      service_fee_cny_fen: fixedIntegerString(serviceFeeValue),
      buyer_self_pay_bps: instruction.buyer_self_pay_bps,
      buyer_self_pay_jpy: String(instruction.buyer_self_pay_jpy),
      buyer_refundable_principal_jpy: String(instruction.buyer_refundable_principal_jpy),
      buyer_gross_principal_cny_fen: String(buyerFinancial.buyerGrossPrincipalCnyFen),
      buyer_self_pay_contribution_cny_fen: String(
        buyerFinancial.buyerSelfPayContributionCnyFen,
      ),
      buyer_expected_principal_cny_fen: fixedIntegerString(buyerExpectedPrincipal),
      seller_expected_principal_cny_fen: fixedIntegerString(sellerExpectedPrincipal),
      rounding_rule: 'HALF_UP',
      ...(sellerPrincipalRateSnapshot
        ? { seller_principal_rate_snapshot: sellerPrincipalRateSnapshot }
        : {}),
    };
    const response: ConfirmFormalOrderResult = {
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
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `formal-order-confirmed:${formalOrderId}`,
      eventType: 'FORMAL_ORDER_CONFIRMED',
      aggregateType: 'FORMAL_ORDER',
      aggregateId: formalOrderId,
      payload: response,
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

    const statements: SqlStatement[] = [
      ...buyerNumber.statements,
      database.prepare(`
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
      `).bind(
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
      database.prepare(`
        INSERT INTO formal_order_financial_snapshots (
          id, formal_order_id, snapshot_version,
          buyer_rate_version_id, buyer_rate_version_no,
          buyer_rate_business_date, buyer_rate_confirmed_at,
          buyer_cny_per_jpy_e8, seller_rate_version_id,
          seller_rate_version_no, seller_rate_effective_from,
          seller_rate_confirmed_at, seller_cny_per_jpy_e8,
          service_fee_version_id, service_fee_version_no,
          service_fee_effective_from, service_fee_confirmed_at,
          service_fee_cny_fen, buyer_self_pay_bps, buyer_self_pay_jpy,
          buyer_refundable_principal_jpy, buyer_gross_principal_cny_fen,
          buyer_self_pay_contribution_cny_fen,
          buyer_expected_principal_cny_fen,
          seller_expected_principal_cny_fen, rounding_rule, created_at
        ) VALUES (
          ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'HALF_UP', ?
        )
      `).bind(
        snapshotId,
        formalOrderId,
        buyerRate.rate_id,
        buyerRate.version_no,
        buyerRate.business_date,
        buyerRate.confirmed_at,
        toD1SafeInteger(buyerRateValue),
        sellerRate.rate_version_id,
        sellerRate.version_no,
        sellerRate.effective_from,
        sellerRate.confirmed_at,
        toD1SafeInteger(sellerRateValue),
        serviceFee.fee_version_id,
        serviceFee.version_no,
        serviceFee.effective_from,
        serviceFee.confirmed_at,
        toD1SafeInteger(serviceFeeValue),
        instruction.buyer_self_pay_bps,
        instruction.buyer_self_pay_jpy,
        instruction.buyer_refundable_principal_jpy,
        buyerFinancial.buyerGrossPrincipalCnyFen,
        buyerFinancial.buyerSelfPayContributionCnyFen,
        toD1SafeInteger(buyerExpectedPrincipal),
        toD1SafeInteger(sellerExpectedPrincipal),
        now,
      ),
      assertPreviousStatementChangedOnce(database),
      ...(sellerPrincipalRateSnapshot
        ? [
            insertSellerPrincipalRateSnapshotStatement(
              database,
              formalOrderId,
              sellerPrincipalRateSnapshot,
              now,
            ),
            assertPreviousStatementChangedOnce(database),
          ]
        : []),
      ...principalPayable.statements,
      database.prepare(`
        INSERT INTO formal_order_events (
          id, formal_order_id, order_evidence_submission_id,
          reservation_id, event_type, actor_staff_id,
          previous_status, next_status, order_version,
          metadata_json, idempotency_key, created_at
        ) VALUES (
          ?, ?, ?, ?, 'FORMAL_ORDER_CONFIRMED', ?,
          NULL, 'CONFIRMED', 1, ?, ?, ?
        )
      `).bind(
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
          order_evidence_version: expectedVersion,
        },
        nextState: response,
        metadata: {
          financial_snapshot_id: snapshotId,
          seller_principal_payable_id: principalPayable.payableId,
          buyer_number_allocated: buyerNumber.allocated,
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      ...completeFormalInstructionStatements(database, {
        source: instruction,
        reservationId: source.reservation_id,
        formalOrderId,
        now,
      }),
      database.prepare(`
        UPDATE order_evidence_submissions
        SET status='CONSUMED', version=version+1,
          updated_at=MAX(?, updated_at+1), consumed_at=?
        WHERE id=? AND status='VERIFIED' AND version=?
          AND current_version_no=?
      `).bind(
        now,
        now,
        source.submission_id,
        expectedVersion,
        source.evidence_current_version_no,
      ),
      assertPreviousStatementChangedOnce(database),
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
      assertPreviousStatementChangedOnce(database),
      assertFormalOrderConfirmedStatement(
        database,
        acquired.claim,
        source,
        response,
        buyerNumber,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeFormalOrderError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

async function requireFormalOrderSource(
  database: SqlDatabase,
  submissionId: string,
): Promise<FormalOrderSourceRow> {
  const row = await database.prepare(`
    SELECT
      submission.id AS submission_id,
      submission.reservation_id,
      submission.buyer_customer_id,
      submission.marketplace_code,
      submission.status AS evidence_status,
      submission.current_version_no AS evidence_current_version_no,
      submission.version AS evidence_aggregate_version,
      evidence.id AS evidence_version_id,
      evidence.amazon_order_number_raw,
      evidence.amazon_order_number_normalized,
      evidence.amazon_order_date,
      evidence.final_paid_jpy,
      reservation.status AS reservation_status,
      reservation.version AS reservation_version,
      reservation.demand_batch_id,
      reservation.organization_id AS seller_organization_id,
      reservation.store_id,
      reservation.product_id,
      reservation.product_version_no,
      demand.task_type AS review_type,
      product.asin_display,
      product.asin_normalized,
      product_version.id AS product_version_id,
      product_version.product_name,
      buyer.access_status AS buyer_access_status,
      buyer.buyer_customer_no,
      buyer.buyer_sequence,
      buyer.first_valid_order_business_date,
      buyer.buyer_channel_id,
      buyer.version AS buyer_version,
      channel.code AS channel_code,
      channel.status AS channel_status,
      channel.next_sequence AS channel_next_sequence,
      channel.version AS channel_version,
      existing.id AS existing_formal_order_id
    FROM order_evidence_submissions submission
    JOIN order_evidence_versions evidence
      ON evidence.submission_id=submission.id
      AND evidence.version_no=submission.current_version_no
    JOIN product_reservations reservation ON reservation.id=submission.reservation_id
    JOIN demand_batches demand ON demand.id=reservation.demand_batch_id
    JOIN products product ON product.id=reservation.product_id
    JOIN product_versions product_version
      ON product_version.product_id=reservation.product_id
      AND product_version.version_no=reservation.product_version_no
    JOIN buyer_customers buyer ON buyer.id=submission.buyer_customer_id
    JOIN buyer_channels channel ON channel.id=buyer.buyer_channel_id
    LEFT JOIN formal_orders existing
      ON existing.order_evidence_submission_id=submission.id
      OR existing.reservation_id=reservation.id
    WHERE submission.id=?
    LIMIT 1
  `).bind(submissionId).first<FormalOrderSourceRow>();
  if (!row) throw new FormalOrderError('ORDER_EVIDENCE_NOT_FOUND', 404);
  return normalizeSource(row);
}

function validateFormalOrderSource(
  source: FormalOrderSourceRow,
  expectedVersion: number,
): void {
  if (source.existing_formal_order_id !== null) {
    throw new FormalOrderError('FORMAL_ORDER_ALREADY_EXISTS', 409);
  }
  if (source.evidence_aggregate_version !== expectedVersion) {
    throw new FormalOrderError('VERSION_CONFLICT', 409);
  }
  if (source.evidence_status !== 'VERIFIED') {
    throw new FormalOrderError('ORDER_EVIDENCE_STATE_CONFLICT', 409);
  }
  if (source.reservation_status !== 'APPROVED') {
    throw new FormalOrderError('FORMAL_ORDER_STATE_CONFLICT', 409);
  }
  if (source.buyer_access_status !== 'ACTIVE') {
    throw new FormalOrderError('CUSTOMER_NOT_ACTIVE', 409);
  }
  if (source.marketplace_code !== 'JP'
    || !Number.isSafeInteger(source.final_paid_jpy)
    || source.final_paid_jpy < 0) {
    throw new FormalOrderError('FORMAL_ORDER_STATE_CONFLICT', 409);
  }
}

function prepareBuyerNumberPlan(
  database: SqlDatabase,
  source: FormalOrderSourceRow,
  businessDate: string,
  actorStaffId: string,
  idempotencyKey: string,
  now: number,
): BuyerNumberPlan {
  const hasNumber = source.buyer_customer_no !== null;
  const hasSequence = source.buyer_sequence !== null;
  const hasDate = source.first_valid_order_business_date !== null;
  if (hasNumber || hasSequence || hasDate) {
    if (!hasNumber || !hasSequence || !hasDate
      || !Number.isSafeInteger(source.buyer_sequence)
      || source.buyer_sequence! < 1) {
      throw new FormalOrderError('DEPENDENCY_UNAVAILABLE', 503);
    }
    return {
      buyerCustomerNo: source.buyer_customer_no!,
      allocated: false,
      sequence: source.buyer_sequence!,
      firstValidOrderBusinessDate: source.first_valid_order_business_date!,
      statements: [],
    };
  }
  if (source.channel_status !== 'ACTIVE') {
    throw new FormalOrderError('FORMAL_ORDER_STATE_CONFLICT', 409);
  }
  const sequence = source.channel_next_sequence;
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new FormalOrderError('DEPENDENCY_UNAVAILABLE', 503);
  }
  const buyerCustomerNo = formatBuyerCustomerNumber({
    businessDate,
    channelCode: source.channel_code,
    sequence,
  });
  const statements: SqlStatement[] = [
    database.prepare(`
      UPDATE buyer_channels SET
        next_sequence=next_sequence+1,
        version=version+1,
        updated_at=MAX(?, updated_at+1)
      WHERE id=? AND status='ACTIVE' AND next_sequence=? AND version=?
    `).bind(now, source.buyer_channel_id, sequence, source.channel_version),
    assertPreviousStatementChangedOnce(database),
    database.prepare(`
      UPDATE buyer_customers SET
        buyer_customer_no=?, buyer_sequence=?,
        first_valid_order_business_date=?, version=version+1,
        updated_at=MAX(?, updated_at+1)
      WHERE id=? AND access_status='ACTIVE'
        AND buyer_customer_no IS NULL AND buyer_sequence IS NULL
        AND first_valid_order_business_date IS NULL AND version=?
    `).bind(
      buyerCustomerNo,
      sequence,
      businessDate,
      now,
      source.buyer_customer_id,
      source.buyer_version,
    ),
    assertPreviousStatementChangedOnce(database),
    database.prepare(`
      INSERT INTO buyer_number_allocation_events (
        id, buyer_customer_id, buyer_channel_id, buyer_customer_no,
        buyer_sequence, first_valid_order_business_date,
        actor_staff_id, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
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
  ];
  return {
    buyerCustomerNo,
    allocated: true,
    sequence,
    firstValidOrderBusinessDate: businessDate,
    statements,
  };
}

function assertFormalOrderConfirmedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  source: FormalOrderSourceRow,
  response: ConfirmFormalOrderResult,
  buyerNumber: BuyerNumberPlan,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1 FROM formal_orders formal_order
        WHERE formal_order.id=?
          AND formal_order.order_evidence_submission_id=?
          AND formal_order.order_evidence_version_id=?
          AND formal_order.reservation_id=?
          AND formal_order.buyer_customer_no=?
          AND formal_order.status='CONFIRMED'
          AND formal_order.version=1
          AND formal_order.confirmed_at=?
          AND formal_order.confirmed_business_date=?
      )
      AND EXISTS (
        SELECT 1 FROM formal_order_financial_snapshots snapshot
        WHERE snapshot.id=? AND snapshot.formal_order_id=?
          AND snapshot.snapshot_version=1
          AND snapshot.buyer_rate_version_id=?
          AND snapshot.seller_rate_version_id=?
          AND snapshot.service_fee_version_id=?
          AND snapshot.buyer_expected_principal_cny_fen=?
          AND snapshot.seller_expected_principal_cny_fen=?
          AND snapshot.service_fee_cny_fen=?
          AND snapshot.rounding_rule='HALF_UP'
      )
      AND EXISTS (
        SELECT 1 FROM seller_payables payable
        WHERE payable.formal_order_id=?
          AND payable.payable_type='SELLER_PRINCIPAL'
          AND payable.amount_cny_fen=?
          AND payable.financial_snapshot_id=?
      )
      AND EXISTS (
        SELECT 1 FROM formal_order_events event
        WHERE event.formal_order_id=?
          AND event.event_type='FORMAL_ORDER_CONFIRMED'
          AND event.order_version=1
      )
      AND EXISTS (
        SELECT 1 FROM order_evidence_submissions submission
        WHERE submission.id=? AND submission.status='CONSUMED'
          AND submission.version=? AND submission.consumed_at=?
      )
      AND EXISTS (
        SELECT 1 FROM buyer_customers buyer
        WHERE buyer.id=? AND buyer.buyer_customer_no=?
          AND buyer.buyer_sequence=?
          AND buyer.first_valid_order_business_date=?
          AND buyer.version=?
      )
      AND (
        ?=0 OR EXISTS (
          SELECT 1 FROM buyer_channels channel
          JOIN buyer_number_allocation_events event
            ON event.buyer_channel_id=channel.id
          WHERE channel.id=? AND channel.next_sequence=?
            AND channel.version=? AND event.buyer_customer_id=?
            AND event.buyer_customer_no=? AND event.buyer_sequence=?
        )
      )
      AND EXISTS (
        SELECT 1 FROM command_idempotency_records command
        WHERE command.actor_type=? AND command.actor_id=?
          AND command.idempotency_key=? AND command.status='COMMITTED'
          AND command.lease_token=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    response.formal_order_id,
    response.order_evidence_submission_id,
    response.order_evidence_version_id,
    response.reservation_id,
    response.buyer_customer_no,
    response.confirmed_at,
    response.confirmed_business_date,
    response.financial_snapshot.snapshot_id,
    response.formal_order_id,
    response.financial_snapshot.buyer_rate_version_id,
    response.financial_snapshot.seller_rate_version_id,
    response.financial_snapshot.service_fee_version_id,
    Number(response.financial_snapshot.buyer_expected_principal_cny_fen),
    Number(response.financial_snapshot.seller_expected_principal_cny_fen),
    Number(response.financial_snapshot.service_fee_cny_fen),
    response.formal_order_id,
    Number(response.financial_snapshot.seller_expected_principal_cny_fen),
    response.financial_snapshot.snapshot_id,
    response.formal_order_id,
    response.order_evidence_submission_id,
    source.evidence_aggregate_version + 1,
    response.confirmed_at,
    source.buyer_customer_id,
    response.buyer_customer_no,
    buyerNumber.sequence,
    buyerNumber.firstValidOrderBusinessDate,
    buyerNumber.allocated ? source.buyer_version + 1 : source.buyer_version,
    buyerNumber.allocated ? 1 : 0,
    source.buyer_channel_id,
    source.channel_next_sequence + 1,
    source.channel_version + 1,
    source.buyer_customer_id,
    response.buyer_customer_no,
    buyerNumber.sequence,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}

function normalizeSource(row: FormalOrderSourceRow): FormalOrderSourceRow {
  return {
    ...row,
    evidence_current_version_no: Number(row.evidence_current_version_no),
    evidence_aggregate_version: Number(row.evidence_aggregate_version),
    final_paid_jpy: Number(row.final_paid_jpy),
    reservation_version: Number(row.reservation_version),
    product_version_no: Number(row.product_version_no),
    buyer_sequence: row.buyer_sequence === null ? null : Number(row.buyer_sequence),
    buyer_version: Number(row.buyer_version),
    channel_next_sequence: Number(row.channel_next_sequence),
    channel_version: Number(row.channel_version),
  };
}
