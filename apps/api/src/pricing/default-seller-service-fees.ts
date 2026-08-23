import {
  DEFAULT_SELLER_SERVICE_FEES,
  type PricingReviewType,
  type SqlDatabase,
  type SqlStatement,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import { createOutboxStatements, prepareOutboxEvent } from '../foundation/outbox';
import {
  assertPreviousStatementChangedOnce,
  cleanPricingIdentifier,
  insertPricingEventStatement,
  normalizePricingError,
  PricingError,
  pricingAuditState,
  requireSellerOpsSubmitter,
  type PricingStaffActor,
} from './pricing-shared';
import { readSellerServiceFeeOverview } from './seller-service-fees';

const KIND = 'SELLER_SERVICE_FEE';
const EVENT_TABLE = 'seller_service_fee_events';
// The table CHECK demands effective_from > confirmed_at for CONFIRMED rows,
// so seeded defaults become effective one minute after the seeding instant —
// long before any order of a brand-new organization can be approved.
const SEED_EFFECTIVE_OFFSET_MS = 60_000;

function auditActor(actor: PricingStaffActor) {
  return { type: 'STAFF' as const, id: actor.staffId, roles: actor.roles };
}

/**
 * Statements that seed one review type's default fee as an immediately
 * CONFIRMED version: the row is born SUBMITTED (the trigger state machine
 * demands it) and is decided CONFIRMED within the same transaction, with both
 * events, audit rows, and outbox messages — the same in-transaction
 * auto-confirm pattern the currency-pair default markup uses.
 */
async function seedStatements(
  database: SqlDatabase,
  input: {
    organizationId: string;
    reviewType: PricingReviewType;
    feeCnyFen: string;
    versionNo: number;
    actor: PricingStaffActor;
    idempotencyKey: string;
    now: number;
  },
): Promise<SqlStatement[]> {
  const versionId = crypto.randomUUID();
  const effectiveFrom = input.now + SEED_EFFECTIVE_OFFSET_MS;
  const versionPayload = (status: 'SUBMITTED' | 'CONFIRMED', decisionVersion: 1 | 2) => ({
    version_id: versionId,
    seller_organization_id: input.organizationId,
    review_type: input.reviewType,
    version_no: input.versionNo,
    decision_version: decisionVersion,
    status,
    fee_cny_fen: input.feeCnyFen,
    effective_from: effectiveFrom,
    rejection_reason: null,
    confirmed_at: status === 'CONFIRMED' ? input.now : null,
    replayed: false,
  });
  const submittedState = pricingAuditState({
    status: 'SUBMITTED',
    versionNo: input.versionNo,
    decisionVersion: 1,
    valueName: 'fee_cny_fen',
    value: input.feeCnyFen,
    effectiveFrom: effectiveFrom,
    reviewType: input.reviewType,
  });
  const confirmedState = pricingAuditState({
    status: 'CONFIRMED',
    versionNo: input.versionNo,
    decisionVersion: 2,
    valueName: 'fee_cny_fen',
    value: input.feeCnyFen,
    effectiveFrom: effectiveFrom,
    reviewType: input.reviewType,
  });
  const submittedOutbox = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: `seller-service-fee-submitted:${input.organizationId}:${input.reviewType}:${input.versionNo}`,
    eventType: 'SELLER_SERVICE_FEE_SUBMITTED',
    aggregateType: KIND,
    aggregateId: versionId,
    payload: versionPayload('SUBMITTED', 1),
    createdAt: input.now,
  });
  const confirmedOutbox = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: `seller-service-fee-confirmed:${input.organizationId}:${input.reviewType}:${input.versionNo}`,
    eventType: 'SELLER_SERVICE_FEE_CONFIRMED',
    aggregateType: KIND,
    aggregateId: versionId,
    payload: versionPayload('CONFIRMED', 2),
    createdAt: input.now,
  });
  return [
    database.prepare(`
      INSERT INTO seller_service_fee_versions (
        id, organization_id, review_type, version_no,
        status, fee_cny_fen, effective_from,
        submitted_by_staff_id, submitted_at,
        decision_version,
        confirmed_by_staff_id, confirmed_at,
        rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, 1, NULL, NULL, NULL, NULL, NULL)
    `).bind(
      versionId,
      input.organizationId,
      input.reviewType,
      input.versionNo,
      Number(input.feeCnyFen),
      effectiveFrom,
      input.actor.staffId,
      input.now,
    ),
    insertPricingEventStatement(database, {
      table: EVENT_TABLE,
      versionId,
      organizationId: input.organizationId,
      reviewType: input.reviewType,
      versionNo: input.versionNo,
      eventType: 'SELLER_SERVICE_FEE_SUBMITTED',
      actorId: input.actor.staffId,
      previousStatus: null,
      nextStatus: 'SUBMITTED',
      valueColumn: 'fee_cny_fen',
      value: Number(input.feeCnyFen),
      effectiveFrom: effectiveFrom,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.now,
    }),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: KIND,
      aggregateId: versionId,
      eventType: 'SELLER_SERVICE_FEE_SUBMITTED',
      actor: auditActor(input.actor),
      requestId: null,
      idempotencyKey: input.idempotencyKey,
      nextState: submittedState,
      createdAt: input.now,
    }),
    ...createOutboxStatements(database, submittedOutbox),
    database.prepare(`
      UPDATE seller_service_fee_versions
      SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id=?, confirmed_at=?
      WHERE id=? AND status='SUBMITTED' AND decision_version=1
    `).bind(input.actor.staffId, input.now, versionId),
    assertPreviousStatementChangedOnce(database),
    insertPricingEventStatement(database, {
      table: EVENT_TABLE,
      versionId,
      organizationId: input.organizationId,
      reviewType: input.reviewType,
      versionNo: input.versionNo,
      eventType: 'SELLER_SERVICE_FEE_CONFIRMED',
      actorId: input.actor.staffId,
      previousStatus: 'SUBMITTED',
      nextStatus: 'CONFIRMED',
      valueColumn: 'fee_cny_fen',
      value: Number(input.feeCnyFen),
      effectiveFrom: effectiveFrom,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.now,
    }),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: KIND,
      aggregateId: versionId,
      eventType: 'SELLER_SERVICE_FEE_CONFIRMED',
      actor: auditActor(input.actor),
      requestId: null,
      idempotencyKey: input.idempotencyKey,
      previousState: submittedState,
      nextState: confirmedState,
      reason: 'DEFAULT_SERVICE_FEE_SEED',
      createdAt: input.now,
    }),
    ...createOutboxStatements(database, confirmedOutbox),
  ];
}

/**
 * Seed every review type that has neither an effective fee nor a pending
 * submission. Returns raw statements so the seller-organization creation
 * transaction can stay atomic (org + default fees commit or roll back
 * together). Types already configured — or awaiting a decision — are left
 * untouched.
 */
export async function defaultSellerServiceFeeStatements(
  database: SqlDatabase,
  input: { organizationId: string; actor: PricingStaffActor; now: number },
): Promise<SqlStatement[]> {
  const overview = await readSellerServiceFeeOverview(database, {
    sellerOrganizationId: input.organizationId,
    at: input.now,
  });
  const missing = overview.filter(
    (entry) =>
      entry.effective_fee === null && entry.pending_fee === null && entry.upcoming_fee === null,
  );
  const statements: SqlStatement[] = [];
  for (const entry of missing) {
    const preset = DEFAULT_SELLER_SERVICE_FEES.find(
      (candidate) => candidate.review_type === entry.review_type,
    );
    if (!preset) continue;
    statements.push(
      ...(await seedStatements(database, {
        organizationId: input.organizationId,
        reviewType: entry.review_type,
        feeCnyFen: preset.fee_cny_fen,
        versionNo: entry.next_version,
        actor: input.actor,
        idempotencyKey: `default-fee-seed:${input.organizationId}:${entry.review_type}`,
        now: input.now,
      })),
    );
  }
  return statements;
}

/**
 * One-click backfill for existing organizations: fill every unconfigured
 * review type with the business default, auto-confirmed in one transaction.
 */
export async function applyDefaultSellerServiceFees(
  database: SqlDatabase,
  input: { sellerOrganizationId: string },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{ applied: PricingReviewType[] }> {
  requireSellerOpsSubmitter(command.actor);
  const organizationId = cleanPricingIdentifier(input.sellerOrganizationId);
  const now = command.now ?? Date.now();
  const organization = await database
    .prepare(`SELECT status FROM seller_organizations WHERE id=?`)
    .bind(organizationId)
    .first<{ status: string }>();
  if (!organization || organization.status !== 'ACTIVE') {
    throw new PricingError('NOT_FOUND', 404);
  }
  // Nothing to write when every type is configured or pending: return before
  // claiming command idempotency so retries stay cheap.
  const before = await readSellerServiceFeeOverview(database, {
    sellerOrganizationId: organizationId,
    at: now,
  });
  if (
    before.every(
      (entry) =>
        entry.effective_fee !== null || entry.pending_fee !== null || entry.upcoming_fee !== null,
    )
  ) {
    return { applied: [] };
  }
  const action = 'APPLY_DEFAULT_SELLER_SERVICE_FEES';
  const requestHash = await hashCanonicalJson({
    action,
    seller_organization_id: organizationId,
  });
  const acquired = await acquireIdempotency<{ applied: PricingReviewType[] }>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action,
      targetType: KIND,
      targetId: organizationId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') return acquired.response;

  try {
    const overview = await readSellerServiceFeeOverview(database, {
      sellerOrganizationId: organizationId,
      at: now,
    });
    const missing = overview.filter(
      (entry) =>
        entry.effective_fee === null && entry.pending_fee === null && entry.upcoming_fee === null,
    );
    const applied: PricingReviewType[] = missing.map((entry) => entry.review_type);
    const statements: SqlStatement[] = [];
    for (const entry of missing) {
      const preset = DEFAULT_SELLER_SERVICE_FEES.find(
        (candidate) => candidate.review_type === entry.review_type,
      );
      if (!preset) continue;
      statements.push(
        ...(await seedStatements(database, {
          organizationId,
          reviewType: entry.review_type,
          feeCnyFen: preset.fee_cny_fen,
          versionNo: entry.next_version,
          actor: command.actor,
          idempotencyKey: command.idempotencyKey,
          now,
        })),
      );
    }
    statements.push(
      completeIdempotencyStatement(database, acquired.claim, { applied }, { now }),
    );
    await database.batch(statements);
    return { applied };
  } catch (error) {
    const normalized = normalizePricingError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}
