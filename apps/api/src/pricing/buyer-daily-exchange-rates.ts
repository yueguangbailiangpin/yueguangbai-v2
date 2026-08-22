import type {
  BuyerDailyExchangeRateReadDto,
  BuyerDailyExchangeRateVersion,
  ResolvedBuyerDailyExchangeRate,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import { createOutboxStatements, prepareOutboxEvent } from '../foundation/outbox';
import {
  assertPreviousStatementChangedOnce,
  cleanBusinessDate,
  cleanEpochMilliseconds,
  cleanExpectedVersion,
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

interface LatestBuyerRateRow {
  latest_version: number;
  pending_count: number;
  confirmed_count: number;
}

interface BuyerRateRow {
  id: string;
  business_date: string;
  version_no: number;
  status: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED';
  cny_per_jpy_e8: number;
  submitted_by_staff_id: string;
  submitted_at: number;
  decision_version: number;
  confirmed_at: number | null;
}

export interface SubmitBuyerDailyExchangeRateResult {
  rate_id: string;
  business_date: string;
  version_no: number;
  decision_version: 1;
  status: 'SUBMITTED';
  cny_per_jpy_e8: string;
  replayed: boolean;
}

export interface DecideBuyerDailyExchangeRateResult {
  rate_id: string;
  business_date: string;
  version_no: number;
  decision_version: number;
  status: 'CONFIRMED' | 'REJECTED';
  cny_per_jpy_e8: string;
  rejection_reason: string | null;
  replayed: boolean;
}

export async function submitBuyerDailyExchangeRate(
  database: SqlDatabase,
  input: {
    businessDate: string;
    cnyPerJpyE8: string;
    expectedVersion: number;
  },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<SubmitBuyerDailyExchangeRateResult> {
  requireSellerOpsSubmitter(command.actor);
  const businessDate = cleanBusinessDate(input.businessDate);
  const rate = cleanRateE8(input.cnyPerJpyE8);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion, { allowZero: true });
  const now = cleanEpochMilliseconds(command.now ?? Date.now());

  const requestHash = await hashCanonicalJson({
    action: 'SUBMIT_BUYER_DAILY_EXCHANGE_RATE',
    business_date: businessDate,
    cny_per_jpy_e8: rate.serialized,
    expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<SubmitBuyerDailyExchangeRateResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'SUBMIT_BUYER_DAILY_EXCHANGE_RATE',
      targetType: 'BUYER_DAILY_EXCHANGE_RATE_DATE',
      targetId: businessDate,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const latest = await readLatestBuyerRate(database, businessDate);
    if (latest.latest_version !== expectedVersion) {
      throw new PricingError('VERSION_CONFLICT', 409);
    }
    if (latest.pending_count > 0) {
      throw new PricingError('PRICING_RULE_PENDING_CONFLICT', 409);
    }
    if (latest.confirmed_count > 0) {
      throw new PricingError('PRICING_RULE_ALREADY_DECIDED', 409);
    }

    const rateId = crypto.randomUUID();
    const versionNo = expectedVersion + 1;
    const response: SubmitBuyerDailyExchangeRateResult = {
      rate_id: rateId,
      business_date: businessDate,
      version_no: versionNo,
      decision_version: 1,
      status: 'SUBMITTED',
      cny_per_jpy_e8: rate.serialized,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `buyer-daily-rate-submitted:${businessDate}:${versionNo}`,
      eventType: 'BUYER_DAILY_EXCHANGE_RATE_SUBMITTED',
      aggregateType: 'BUYER_DAILY_EXCHANGE_RATE',
      aggregateId: rateId,
      payload: response,
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database
        .prepare(
          `
        INSERT INTO buyer_daily_exchange_rates (
          id, business_date, version_no, status,
          cny_per_jpy_e8, submitted_by_staff_id,
          submitted_at, decision_version,
          confirmed_by_staff_id, confirmed_at,
          rejected_by_staff_id, rejected_at,
          rejection_reason
        ) VALUES (
          ?, ?, ?, 'SUBMITTED', ?, ?, ?, 1,
          NULL, NULL, NULL, NULL, NULL
        )
      `,
        )
        .bind(rateId, businessDate, versionNo, rate.databaseValue, command.actor.staffId, now),
      insertPricingEventStatement(database, {
        table: 'buyer_daily_exchange_rate_events',
        versionId: rateId,
        businessDate,
        versionNo,
        eventType: 'BUYER_DAILY_EXCHANGE_RATE_SUBMITTED',
        actorId: command.actor.staffId,
        previousStatus: null,
        nextStatus: 'SUBMITTED',
        valueColumn: 'cny_per_jpy_e8',
        value: rate.databaseValue,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_DAILY_EXCHANGE_RATE',
        aggregateId: rateId,
        eventType: 'BUYER_DAILY_EXCHANGE_RATE_SUBMITTED',
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
          valueName: 'cny_per_jpy_e8',
          value: rate.serialized,
          businessDate,
        }),
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { rate_id: rateId },
        now,
      }),
      assertBuyerRateSubmitted(database, acquired.claim, response),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizePricingError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

export async function confirmBuyerDailyExchangeRate(
  database: SqlDatabase,
  input: { rateId: string; expectedVersion: number },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<DecideBuyerDailyExchangeRateResult> {
  return decideBuyerDailyExchangeRate(
    database,
    { ...input, decision: 'CONFIRM', rejectionReason: null },
    command,
  );
}

export async function rejectBuyerDailyExchangeRate(
  database: SqlDatabase,
  input: {
    rateId: string;
    expectedVersion: number;
    rejectionReason: string;
  },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<DecideBuyerDailyExchangeRateResult> {
  return decideBuyerDailyExchangeRate(database, { ...input, decision: 'REJECT' }, command);
}

export async function resolveBuyerDailyExchangeRate(
  database: SqlDatabase,
  input: {
    businessDate: string;
    asOf: number;
  },
): Promise<ResolvedBuyerDailyExchangeRate> {
  const businessDate = cleanBusinessDate(input.businessDate);
  const asOf = cleanEpochMilliseconds(input.asOf);
  const row = await database
    .prepare(
      `
    SELECT
      id,
      business_date,
      version_no,
      cny_per_jpy_e8,
      confirmed_at
    FROM buyer_daily_exchange_rates
    WHERE business_date=?
      AND status='CONFIRMED'
      AND confirmed_at<=?
    LIMIT 1
  `,
    )
    .bind(businessDate, asOf)
    .first<{
      id: string;
      business_date: string;
      version_no: number;
      cny_per_jpy_e8: number;
      confirmed_at: number;
    }>();

  if (!row) {
    throw new PricingError('BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND', 404);
  }
  return {
    rate_id: row.id,
    business_date: row.business_date,
    version_no: Number(row.version_no),
    cny_per_jpy_e8: String(row.cny_per_jpy_e8),
    confirmed_at: Number(row.confirmed_at),
  };
}

/**
 * Read the single authoritative JPY/CNY base-rate stream for an Amazon order
 * date.  The table retains its historic `buyer_` name because formal-order
 * financial snapshots reference it; new callers must treat this as the common
 * order-date base rate for both buyer refunds and seller principal.
 */
export async function readBuyerDailyExchangeRateVersions(
  database: SqlDatabase,
  input: { businessDate: string },
): Promise<BuyerDailyExchangeRateReadDto> {
  const businessDate = cleanBusinessDate(input.businessDate);
  const rows = await database
    .prepare(
      `
    SELECT id,business_date,version_no,decision_version,status,
      cny_per_jpy_e8,rejection_reason,confirmed_at
    FROM buyer_daily_exchange_rates
    WHERE business_date=?
    ORDER BY version_no DESC
  `,
    )
    .bind(businessDate)
    .all<{
      id: string;
      business_date: string;
      version_no: number;
      decision_version: number;
      status: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED';
      cny_per_jpy_e8: number;
      rejection_reason: string | null;
      confirmed_at: number | null;
    }>();
  const values = rows.results.map(
    (row): BuyerDailyExchangeRateVersion => ({
      rate_id: row.id,
      business_date: row.business_date,
      version_no: Number(row.version_no),
      decision_version: Number(row.decision_version),
      status: row.status,
      cny_per_jpy_e8: String(row.cny_per_jpy_e8),
      rejection_reason: row.rejection_reason,
      confirmed_at: row.confirmed_at === null ? null : Number(row.confirmed_at),
    }),
  );
  return {
    business_date: businessDate,
    confirmed_rate: values.find((value) => value.status === 'CONFIRMED') ?? null,
    pending_rate: values.find((value) => value.status === 'SUBMITTED') ?? null,
    next_version: (values.at(0)?.version_no ?? 0) + 1,
  };
}

async function decideBuyerDailyExchangeRate(
  database: SqlDatabase,
  input: {
    rateId: string;
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
): Promise<DecideBuyerDailyExchangeRateResult> {
  requireOwnerConfirmer(command.actor);
  const rateId = cleanPricingIdentifier(input.rateId);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion);
  const reason =
    input.decision === 'REJECT' ? cleanPricingReason(input.rejectionReason ?? '') : null;
  const now = cleanEpochMilliseconds(command.now ?? Date.now());
  const action =
    input.decision === 'CONFIRM'
      ? 'CONFIRM_BUYER_DAILY_EXCHANGE_RATE'
      : 'REJECT_BUYER_DAILY_EXCHANGE_RATE';

  const requestHash = await hashCanonicalJson({
    action,
    rate_id: rateId,
    expected_version: expectedVersion,
    rejection_reason: reason,
  });
  const acquired = await acquireIdempotency<DecideBuyerDailyExchangeRateResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action,
      targetType: 'BUYER_DAILY_EXCHANGE_RATE',
      targetId: rateId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const source = await requireBuyerRate(database, rateId);
    if (source.decision_version !== expectedVersion) {
      throw new PricingError('VERSION_CONFLICT', 409);
    }
    if (source.status !== 'SUBMITTED') {
      throw new PricingError('PRICING_RULE_ALREADY_DECIDED', 409);
    }

    const nextStatus =
      input.decision === 'CONFIRM' ? ('CONFIRMED' as const) : ('REJECTED' as const);
    const nextVersion = expectedVersion + 1;
    const response: DecideBuyerDailyExchangeRateResult = {
      rate_id: rateId,
      business_date: source.business_date,
      version_no: source.version_no,
      decision_version: nextVersion,
      status: nextStatus,
      cny_per_jpy_e8: String(source.cny_per_jpy_e8),
      rejection_reason: reason,
      replayed: false,
    };
    const eventType =
      input.decision === 'CONFIRM'
        ? 'BUYER_DAILY_EXCHANGE_RATE_CONFIRMED'
        : 'BUYER_DAILY_EXCHANGE_RATE_REJECTED';
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `buyer-daily-rate-${nextStatus.toLowerCase()}:${rateId}`,
      eventType,
      aggregateType: 'BUYER_DAILY_EXCHANGE_RATE',
      aggregateId: rateId,
      payload: response,
      createdAt: now,
    });

    const decisionStatement =
      input.decision === 'CONFIRM'
        ? database
            .prepare(
              `
          UPDATE buyer_daily_exchange_rates
          SET
            status='CONFIRMED',
            decision_version=decision_version+1,
            confirmed_by_staff_id=?,
            confirmed_at=?
          WHERE id=?
            AND status='SUBMITTED'
            AND decision_version=?
        `,
            )
            .bind(command.actor.staffId, now, rateId, expectedVersion)
        : database
            .prepare(
              `
          UPDATE buyer_daily_exchange_rates
          SET
            status='REJECTED',
            decision_version=decision_version+1,
            rejected_by_staff_id=?,
            rejected_at=?,
            rejection_reason=?
          WHERE id=?
            AND status='SUBMITTED'
            AND decision_version=?
        `,
            )
            .bind(command.actor.staffId, now, reason, rateId, expectedVersion);

    await database.batch([
      decisionStatement,
      assertPreviousStatementChangedOnce(database),
      insertPricingEventStatement(database, {
        table: 'buyer_daily_exchange_rate_events',
        versionId: rateId,
        businessDate: source.business_date,
        versionNo: source.version_no,
        eventType,
        actorId: command.actor.staffId,
        previousStatus: 'SUBMITTED',
        nextStatus,
        valueColumn: 'cny_per_jpy_e8',
        value: source.cny_per_jpy_e8,
        reason,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_DAILY_EXCHANGE_RATE',
        aggregateId: rateId,
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
          valueName: 'cny_per_jpy_e8',
          value: String(source.cny_per_jpy_e8),
          businessDate: source.business_date,
        }),
        nextState: response,
        reason,
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { rate_id: rateId },
        now,
      }),
      assertBuyerRateDecided(database, acquired.claim, response),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizePricingError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

async function readLatestBuyerRate(
  database: SqlDatabase,
  businessDate: string,
): Promise<LatestBuyerRateRow> {
  const row = await database
    .prepare(
      `
    SELECT
      COALESCE(MAX(version_no), 0) AS latest_version,
      COALESCE(SUM(status='SUBMITTED'), 0) AS pending_count,
      COALESCE(SUM(status='CONFIRMED'), 0) AS confirmed_count
    FROM buyer_daily_exchange_rates
    WHERE business_date=?
  `,
    )
    .bind(businessDate)
    .first<LatestBuyerRateRow>();
  return {
    latest_version: Number(row?.latest_version ?? 0),
    pending_count: Number(row?.pending_count ?? 0),
    confirmed_count: Number(row?.confirmed_count ?? 0),
  };
}

async function requireBuyerRate(database: SqlDatabase, rateId: string): Promise<BuyerRateRow> {
  const row = await database
    .prepare(
      `
    SELECT
      id, business_date, version_no, status,
      cny_per_jpy_e8, submitted_by_staff_id,
      submitted_at, decision_version, confirmed_at
    FROM buyer_daily_exchange_rates
    WHERE id=?
  `,
    )
    .bind(rateId)
    .first<BuyerRateRow>();
  if (!row) throw new PricingError('PRICING_RULE_NOT_FOUND', 404);
  return {
    ...row,
    version_no: Number(row.version_no),
    cny_per_jpy_e8: Number(row.cny_per_jpy_e8),
    submitted_at: Number(row.submitted_at),
    decision_version: Number(row.decision_version),
    confirmed_at: row.confirmed_at === null ? null : Number(row.confirmed_at),
  };
}

function assertBuyerRateSubmitted(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: SubmitBuyerDailyExchangeRateResult,
): SqlStatement {
  return database
    .prepare(
      `
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1 FROM buyer_daily_exchange_rates
        WHERE id=? AND business_date=? AND version_no=?
          AND status='SUBMITTED' AND decision_version=1
      )
      AND EXISTS (
        SELECT 1 FROM buyer_daily_exchange_rate_events
        WHERE version_id=?
          AND event_type='BUYER_DAILY_EXCHANGE_RATE_SUBMITTED'
      )
      AND EXISTS (
        SELECT 1 FROM command_idempotency_records
        WHERE actor_type=? AND actor_id=? AND idempotency_key=?
          AND status='COMMITTED' AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `,
    )
    .bind(
      response.rate_id,
      response.business_date,
      response.version_no,
      response.rate_id,
      claim.actorType,
      claim.actorId,
      claim.idempotencyKey,
      claim.leaseToken,
    );
}

function assertBuyerRateDecided(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: DecideBuyerDailyExchangeRateResult,
): SqlStatement {
  return database
    .prepare(
      `
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1 FROM buyer_daily_exchange_rates
        WHERE id=? AND status=? AND decision_version=?
      )
      AND EXISTS (
        SELECT 1 FROM command_idempotency_records
        WHERE actor_type=? AND actor_id=? AND idempotency_key=?
          AND status='COMMITTED' AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `,
    )
    .bind(
      response.rate_id,
      response.status,
      response.decision_version,
      claim.actorType,
      claim.actorId,
      claim.idempotencyKey,
      claim.leaseToken,
    );
}
