import {
  isPricingReviewType,
  type PricingReviewType,
  type SqlDatabase,
  type SqlStatement,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import {
  assertPreviousStatementChangedOnce,
  cleanEpochMilliseconds,
  cleanExpectedVersion,
  cleanFeeFen,
  cleanPricingIdentifier,
  cleanPricingReason,
  cleanRateE8,
  insertPricingEventStatement,
  normalizePricingError,
  PricingError,
  pricingAuditState,
  requireOwnerConfirmer,
  requireSellerOpsSubmitter,
  type PricingStaffActor,
} from './pricing-shared';

export interface SellerRuleConfiguration {
  kind: 'SELLER_AGREEMENT_RATE' | 'SELLER_SERVICE_FEE';
  table:
    | 'seller_agreement_rate_versions'
    | 'seller_service_fee_versions';
  eventTable:
    | 'seller_agreement_rate_events'
    | 'seller_service_fee_events';
  valueColumn: 'cny_per_jpy_e8' | 'fee_cny_fen';
  submittedEvent: string;
  confirmedEvent: string;
  rejectedEvent: string;
  usesReviewType: boolean;
}

export interface SellerRuleVersionResult {
  version_id: string;
  seller_organization_id: string;
  review_type: PricingReviewType | null;
  version_no: number;
  decision_version: number;
  status: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED';
  value: string;
  effective_from: number;
  rejection_reason: string | null;
  confirmed_at: number | null;
  replayed: boolean;
}

interface SellerRuleRow {
  id: string;
  organization_id: string;
  review_type: PricingReviewType | null;
  version_no: number;
  status: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED';
  value: number;
  effective_from: number;
  submitted_by_staff_id: string;
  submitted_at: number;
  decision_version: number;
  confirmed_at: number | null;
}

export async function submitSellerRuleVersion(
  database: SqlDatabase,
  config: SellerRuleConfiguration,
  input: {
    sellerOrganizationId: string;
    reviewType: PricingReviewType | null;
    rawValue: string;
    effectiveFrom: number;
    expectedVersion: number;
  },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<SellerRuleVersionResult> {
  requireSellerOpsSubmitter(command.actor);
  const organizationId = cleanPricingIdentifier(
    input.sellerOrganizationId,
  );
  const reviewType = normalizeReviewType(config, input.reviewType);
  const parsed = config.valueColumn === 'cny_per_jpy_e8'
    ? cleanRateE8(input.rawValue)
    : cleanFeeFen(input.rawValue);
  const effectiveFrom = cleanEpochMilliseconds(input.effectiveFrom);
  const expectedVersion = cleanExpectedVersion(
    input.expectedVersion,
    { allowZero: true },
  );
  const now = cleanEpochMilliseconds(command.now ?? Date.now());

  const targetId = sellerRuleTargetId(
    config,
    organizationId,
    reviewType,
  );
  const action = `SUBMIT_${config.kind}_VERSION`;
  const requestHash = await hashCanonicalJson({
    action,
    seller_organization_id: organizationId,
    review_type: reviewType,
    [config.valueColumn]: parsed.serialized,
    effective_from: effectiveFrom,
    expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<SellerRuleVersionResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action,
      targetType: config.kind,
      targetId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    await requireActiveSellerOrganization(database, organizationId);
    const latest = await database.prepare(`
      SELECT
        COALESCE(MAX(version_no), 0) AS latest_version,
        COALESCE(SUM(status='SUBMITTED'), 0) AS pending_count
      FROM ${config.table}
      WHERE organization_id=?
        AND review_type IS ?
    `).bind(
      organizationId,
      reviewType,
    ).first<{
      latest_version: number;
      pending_count: number;
    }>();
    if (Number(latest?.latest_version ?? 0) !== expectedVersion) {
      throw new PricingError('VERSION_CONFLICT', 409);
    }
    if (Number(latest?.pending_count ?? 0) > 0) {
      throw new PricingError('PRICING_RULE_PENDING_CONFLICT', 409);
    }

    const versionId = crypto.randomUUID();
    const versionNo = expectedVersion + 1;
    const response: SellerRuleVersionResult = {
      version_id: versionId,
      seller_organization_id: organizationId,
      review_type: reviewType,
      version_no: versionNo,
      decision_version: 1,
      status: 'SUBMITTED',
      value: parsed.serialized,
      effective_from: effectiveFrom,
      rejection_reason: null,
      confirmed_at: null,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `${config.kind.toLowerCase()}-submitted:${targetId}:${versionNo}`,
      eventType: config.submittedEvent,
      aggregateType: config.kind,
      aggregateId: versionId,
      payload: sellerRulePayload(config, response),
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO ${config.table} (
          id, organization_id, review_type, version_no,
          status, ${config.valueColumn}, effective_from,
          submitted_by_staff_id, submitted_at,
          decision_version,
          confirmed_by_staff_id, confirmed_at,
          rejected_by_staff_id, rejected_at,
          rejection_reason
        ) VALUES (
          ?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, 1,
          NULL, NULL, NULL, NULL, NULL
        )
      `).bind(
        versionId,
        organizationId,
        reviewType,
        versionNo,
        parsed.databaseValue,
        effectiveFrom,
        command.actor.staffId,
        now,
      ),
      insertPricingEventStatement(database, {
        table: config.eventTable,
        versionId,
        organizationId,
        reviewType,
        versionNo,
        eventType: config.submittedEvent,
        actorId: command.actor.staffId,
        previousStatus: null,
        nextStatus: 'SUBMITTED',
        valueColumn: config.valueColumn,
        value: parsed.databaseValue,
        effectiveFrom,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: config.kind,
        aggregateId: versionId,
        eventType: config.submittedEvent,
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: pricingAuditState({
          status: 'SUBMITTED',
          versionNo,
          decisionVersion: 1,
          valueName: config.valueColumn,
          value: parsed.serialized,
          effectiveFrom,
          reviewType,
        }),
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        { resultReferences: { version_id: versionId }, now },
      ),
      assertSellerRuleVersion(
        database,
        config,
        acquired.claim,
        response,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizePricingError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

export async function decideSellerRuleVersion(
  database: SqlDatabase,
  config: SellerRuleConfiguration,
  input: {
    versionId: string;
    expectedVersion: number;
    decision: 'CONFIRM' | 'REJECT';
    rejectionReason?: string | null;
  },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<SellerRuleVersionResult> {
  requireOwnerConfirmer(command.actor);
  const versionId = cleanPricingIdentifier(input.versionId);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion);
  const reason = input.decision === 'REJECT'
    ? cleanPricingReason(input.rejectionReason ?? '')
    : null;
  const now = cleanEpochMilliseconds(command.now ?? Date.now());
  const action = `${input.decision}_${config.kind}_VERSION`;
  const requestHash = await hashCanonicalJson({
    action,
    version_id: versionId,
    expected_version: expectedVersion,
    rejection_reason: reason,
  });
  const acquired = await acquireIdempotency<SellerRuleVersionResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action,
      targetType: config.kind,
      targetId: versionId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const source = await requireSellerRuleRow(
      database,
      config,
      versionId,
    );
    if (source.decision_version !== expectedVersion) {
      throw new PricingError('VERSION_CONFLICT', 409);
    }
    if (source.status !== 'SUBMITTED') {
      throw new PricingError('PRICING_RULE_ALREADY_DECIDED', 409);
    }
    if (input.decision === 'CONFIRM'
      && source.effective_from <= now) {
      throw new PricingError(
        'PRICING_RULE_EFFECTIVE_TIME_CONFLICT',
        409,
      );
    }

    const nextStatus = input.decision === 'CONFIRM'
      ? 'CONFIRMED' as const
      : 'REJECTED' as const;
    const eventType = input.decision === 'CONFIRM'
      ? config.confirmedEvent
      : config.rejectedEvent;
    const response: SellerRuleVersionResult = {
      version_id: versionId,
      seller_organization_id: source.organization_id,
      review_type: source.review_type,
      version_no: source.version_no,
      decision_version: expectedVersion + 1,
      status: nextStatus,
      value: String(source.value),
      effective_from: source.effective_from,
      rejection_reason: reason,
      confirmed_at: input.decision === 'CONFIRM' ? now : null,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `${config.kind.toLowerCase()}-${nextStatus.toLowerCase()}:${versionId}`,
      eventType,
      aggregateType: config.kind,
      aggregateId: versionId,
      payload: sellerRulePayload(config, response),
      createdAt: now,
    });

    const decisionStatement = input.decision === 'CONFIRM'
      ? database.prepare(`
          UPDATE ${config.table}
          SET
            status='CONFIRMED',
            decision_version=decision_version+1,
            confirmed_by_staff_id=?,
            confirmed_at=?
          WHERE id=?
            AND status='SUBMITTED'
            AND decision_version=?
        `).bind(command.actor.staffId, now, versionId, expectedVersion)
      : database.prepare(`
          UPDATE ${config.table}
          SET
            status='REJECTED',
            decision_version=decision_version+1,
            rejected_by_staff_id=?,
            rejected_at=?,
            rejection_reason=?
          WHERE id=?
            AND status='SUBMITTED'
            AND decision_version=?
        `).bind(
          command.actor.staffId,
          now,
          reason,
          versionId,
          expectedVersion,
        );

    await database.batch([
      decisionStatement,
      assertPreviousStatementChangedOnce(database),
      insertPricingEventStatement(database, {
        table: config.eventTable,
        versionId,
        organizationId: source.organization_id,
        reviewType: source.review_type,
        versionNo: source.version_no,
        eventType,
        actorId: command.actor.staffId,
        previousStatus: 'SUBMITTED',
        nextStatus,
        valueColumn: config.valueColumn,
        value: source.value,
        effectiveFrom: source.effective_from,
        reason,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: config.kind,
        aggregateId: versionId,
        eventType,
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: pricingAuditState({
          status: 'SUBMITTED',
          versionNo: source.version_no,
          decisionVersion: source.decision_version,
          valueName: config.valueColumn,
          value: String(source.value),
          effectiveFrom: source.effective_from,
          reviewType: source.review_type,
        }),
        nextState: sellerRulePayload(config, response),
        reason,
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        { resultReferences: { version_id: versionId }, now },
      ),
      assertSellerRuleVersion(
        database,
        config,
        acquired.claim,
        response,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizePricingError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

export async function resolveSellerRuleVersion(
  database: SqlDatabase,
  config: SellerRuleConfiguration,
  input: {
    sellerOrganizationId: string;
    reviewType: PricingReviewType | null;
    at: number;
  },
): Promise<SellerRuleVersionResult> {
  const organizationId = cleanPricingIdentifier(
    input.sellerOrganizationId,
  );
  const reviewType = normalizeReviewType(config, input.reviewType);
  const at = cleanEpochMilliseconds(input.at);
  const row = await database.prepare(`
    SELECT
      id,
      organization_id,
      review_type,
      version_no,
      status,
      ${config.valueColumn} AS value,
      effective_from,
      submitted_by_staff_id,
      submitted_at,
      decision_version,
      confirmed_at
    FROM ${config.table}
    WHERE organization_id=?
      AND review_type IS ?
      AND status='CONFIRMED'
      AND effective_from<=?
      AND confirmed_at<=?
    ORDER BY effective_from DESC, version_no DESC
    LIMIT 1
  `).bind(
    organizationId,
    reviewType,
    at,
    at,
  ).first<SellerRuleRow>();
  if (!row) throw new PricingError('PRICING_RULE_NOT_FOUND', 404);
  const source = normalizeSellerRuleRow(row);
  return {
    version_id: source.id,
    seller_organization_id: source.organization_id,
    review_type: source.review_type,
    version_no: source.version_no,
    decision_version: source.decision_version,
    status: 'CONFIRMED',
    value: String(source.value),
    effective_from: source.effective_from,
    rejection_reason: null,
    confirmed_at: source.confirmed_at,
    replayed: false,
  };
}

function normalizeReviewType(
  config: SellerRuleConfiguration,
  reviewType: PricingReviewType | null,
): PricingReviewType | null {
  if (config.usesReviewType) {
    if (!isPricingReviewType(reviewType)) {
      throw new PricingError('VALIDATION_ERROR', 400);
    }
    return reviewType;
  }
  if (reviewType !== null) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  return null;
}

async function requireActiveSellerOrganization(
  database: SqlDatabase,
  organizationId: string,
): Promise<void> {
  const row = await database.prepare(`
    SELECT status
    FROM seller_organizations
    WHERE id=?
  `).bind(organizationId).first<{ status: string }>();
  if (!row || row.status !== 'ACTIVE') {
    throw new PricingError('NOT_FOUND', 404);
  }
}

async function requireSellerRuleRow(
  database: SqlDatabase,
  config: SellerRuleConfiguration,
  versionId: string,
): Promise<SellerRuleRow> {
  const row = await database.prepare(`
    SELECT
      id,
      organization_id,
      review_type,
      version_no,
      status,
      ${config.valueColumn} AS value,
      effective_from,
      submitted_by_staff_id,
      submitted_at,
      decision_version,
      confirmed_at
    FROM ${config.table}
    WHERE id=?
  `).bind(versionId).first<SellerRuleRow>();
  if (!row) throw new PricingError('PRICING_RULE_NOT_FOUND', 404);
  return normalizeSellerRuleRow(row);
}

function normalizeSellerRuleRow(row: SellerRuleRow): SellerRuleRow {
  return {
    ...row,
    version_no: Number(row.version_no),
    value: Number(row.value),
    effective_from: Number(row.effective_from),
    submitted_at: Number(row.submitted_at),
    decision_version: Number(row.decision_version),
    confirmed_at: row.confirmed_at === null
      ? null
      : Number(row.confirmed_at),
  };
}

function sellerRuleTargetId(
  config: SellerRuleConfiguration,
  organizationId: string,
  reviewType: PricingReviewType | null,
): string {
  return config.usesReviewType
    ? `${organizationId}:${reviewType}`
    : organizationId;
}

function sellerRulePayload(
  config: SellerRuleConfiguration,
  response: SellerRuleVersionResult,
): Record<string, unknown> {
  return {
    version_id: response.version_id,
    seller_organization_id: response.seller_organization_id,
    review_type: response.review_type,
    version_no: response.version_no,
    decision_version: response.decision_version,
    status: response.status,
    [config.valueColumn]: response.value,
    effective_from: response.effective_from,
    rejection_reason: response.rejection_reason,
    confirmed_at: response.confirmed_at,
    replayed: response.replayed,
  };
}

function assertSellerRuleVersion(
  database: SqlDatabase,
  config: SellerRuleConfiguration,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: SellerRuleVersionResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1 FROM ${config.table}
        WHERE id=? AND status=? AND decision_version=?
      )
      AND EXISTS (
        SELECT 1 FROM command_idempotency_records
        WHERE actor_type=? AND actor_id=? AND idempotency_key=?
          AND status='COMMITTED' AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    response.version_id,
    response.status,
    response.decision_version,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
