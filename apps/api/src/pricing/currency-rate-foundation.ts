import type {
  CurrencyCode,
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
import {
  cleanBusinessDate,
  cleanEpochMilliseconds,
  cleanExpectedVersion,
  cleanPricingIdentifier,
  normalizePricingError,
  PricingError,
  requireOwnerConfirmer,
  requireSellerOpsSubmitter,
  type PricingStaffActor,
} from './pricing-shared';

const MAX_SAFE = 9_007_199_254_740_991n;

export interface CurrencyRateVersionResult {
  rate_version_id: string;
  source_currency_code: CurrencyCode;
  quote_currency_code: 'CNY';
  version_no: number;
  decision_version: number;
  status: 'SUBMITTED' | 'CONFIRMED';
  rate_value: string;
  rate_scale: string;
  rounding_rule: 'HALF_UP';
  business_date: string | null;
  seller_organization_id: string | null;
  effective_from: number | null;
  confirmed_at: number | null;
  replayed: boolean;
}

const RATE_KIND = 'BUYER_DAILY_CURRENCY_RATE';
const RATE_TABLE = 'buyer_daily_currency_rate_versions';

export function submitBuyerDailyCurrencyRate(
  database: SqlDatabase,
  input: {
    businessDate: string;
    sourceCurrencyCode: CurrencyCode;
    rateValue: string;
    rateScale: string;
    expectedVersion: number;
  },
  command: RateCommand,
): Promise<CurrencyRateVersionResult> {
  requireSellerOpsSubmitter(command.actor);
  return submitCurrencyRate(database, {
    businessDate: cleanBusinessDate(input.businessDate),
    sellerOrganizationId: null,
    sourceCurrencyCode: input.sourceCurrencyCode,
    rateValue: input.rateValue,
    rateScale: input.rateScale,
    effectiveFrom: null,
    expectedVersion: input.expectedVersion,
  }, command);
}

export function confirmBuyerDailyCurrencyRate(
  database: SqlDatabase,
  input: { rateVersionId: string; expectedVersion: number },
  command: RateCommand,
): Promise<CurrencyRateVersionResult> {
  return confirmCurrencyRate(database, input, command);
}

interface RateCommand {
  actor: PricingStaffActor;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
}

interface SubmitRateInput {
  businessDate: string | null;
  sellerOrganizationId: string | null;
  sourceCurrencyCode: CurrencyCode;
  rateValue: string;
  rateScale: string;
  effectiveFrom: number | null;
  expectedVersion: number;
}

async function submitCurrencyRate(
  database: SqlDatabase,
  input: SubmitRateInput,
  command: RateCommand,
): Promise<CurrencyRateVersionResult> {
  requireSellerOpsSubmitter(command.actor);
  const now = cleanEpochMilliseconds(command.now ?? Date.now());
  const expectedVersion = cleanExpectedVersion(input.expectedVersion, {
    allowZero: true,
  });
  const rateValue = positiveInteger(input.rateValue);
  const rateScale = positiveInteger(input.rateScale);
  await requireActiveSourceCurrency(database, input.sourceCurrencyCode);
  const targetId = `${input.businessDate}:${input.sourceCurrencyCode}:CNY`;
  const action = `SUBMIT_${RATE_KIND}`;
  const requestHash = await hashCanonicalJson({
    action,
    business_date: input.businessDate,
    seller_organization_id: input.sellerOrganizationId,
    source_currency_code: input.sourceCurrencyCode,
    quote_currency_code: 'CNY',
    rate_value: rateValue.serialized,
    rate_scale: rateScale.serialized,
    effective_from: input.effectiveFrom,
    expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<CurrencyRateVersionResult>(
    database,
    {
      actorType: 'STAFF', actorId: command.actor.staffId,
      action, targetType: RATE_KIND, targetId,
      idempotencyKey: command.idempotencyKey, requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const latest = await latestVersion(database, input);
    if (latest.latestVersion !== expectedVersion) {
      throw new PricingError('VERSION_CONFLICT', 409);
    }
    if (latest.pendingCount > 0) {
      throw new PricingError('PRICING_RULE_PENDING_CONFLICT', 409);
    }
    const id = crypto.randomUUID();
    const response: CurrencyRateVersionResult = {
      rate_version_id: id,
      source_currency_code: input.sourceCurrencyCode,
      quote_currency_code: 'CNY',
      version_no: expectedVersion + 1,
      decision_version: 1,
      status: 'SUBMITTED',
      rate_value: rateValue.serialized,
      rate_scale: rateScale.serialized,
      rounding_rule: 'HALF_UP',
      business_date: input.businessDate,
      seller_organization_id: input.sellerOrganizationId,
      effective_from: input.effectiveFrom,
      confirmed_at: null,
      replayed: false,
    };
    const insert = database.prepare(`
          INSERT INTO buyer_daily_currency_rate_versions (
            id, legacy_rate_id, business_date, source_currency_code,
            quote_currency_code, version_no, status, rate_value, rate_scale,
            rounding_rule, submitted_by_staff_id, submitted_at,
            decision_version, confirmed_by_staff_id, confirmed_at,
            rejected_by_staff_id, rejected_at, rejection_reason
          ) VALUES (?,NULL,?,?, 'CNY',?,'SUBMITTED',?,?,'HALF_UP',?,?,1,
            NULL,NULL,NULL,NULL,NULL)
        `).bind(id, input.businessDate, input.sourceCurrencyCode,
          response.version_no, rateValue.databaseValue,
          rateScale.databaseValue, command.actor.staffId, now);
    await database.batch([
      insert,
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: RATE_KIND,
        aggregateId: id, eventType: `${RATE_KIND}_SUBMITTED`,
        actor: { type: 'STAFF', id: command.actor.staffId,
          roles: command.actor.roles },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: response, createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { rate_version_id: id }, now,
      }),
      assertRateState(database, acquired.claim, response),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizePricingError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

async function confirmCurrencyRate(
  database: SqlDatabase,
  input: { rateVersionId: string; expectedVersion: number },
  command: RateCommand,
): Promise<CurrencyRateVersionResult> {
  requireOwnerConfirmer(command.actor);
  const id = cleanPricingIdentifier(input.rateVersionId);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion);
  const now = cleanEpochMilliseconds(command.now ?? Date.now());
  const action = `CONFIRM_${RATE_KIND}`;
  const requestHash = await hashCanonicalJson({
    action, rate_version_id: id, expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<CurrencyRateVersionResult>(
    database,
    {
      actorType: 'STAFF', actorId: command.actor.staffId,
      action, targetType: RATE_KIND, targetId: id,
      idempotencyKey: command.idempotencyKey, requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const source = await requireRate(database, id);
    if (source.decision_version !== expectedVersion) {
      throw new PricingError('VERSION_CONFLICT', 409);
    }
    if (source.status !== 'SUBMITTED') {
      throw new PricingError('PRICING_RULE_ALREADY_DECIDED', 409);
    }
    if (source.effective_from !== null && source.effective_from <= now) {
      throw new PricingError('PRICING_RULE_EFFECTIVE_TIME_CONFLICT', 409);
    }
    const response: CurrencyRateVersionResult = {
      rate_version_id: source.id,
      source_currency_code: source.source_currency_code,
      quote_currency_code: 'CNY',
      version_no: source.version_no,
      decision_version: expectedVersion + 1,
      status: 'CONFIRMED',
      rate_value: String(source.rate_value),
      rate_scale: String(source.rate_scale),
      rounding_rule: 'HALF_UP',
      business_date: source.business_date,
      seller_organization_id: source.seller_organization_id,
      effective_from: source.effective_from,
      confirmed_at: now,
      replayed: false,
    };
    const update = database.prepare(`
      UPDATE ${RATE_TABLE}
      SET status='CONFIRMED', decision_version=decision_version+1,
        confirmed_by_staff_id=?, confirmed_at=?
      WHERE id=? AND status='SUBMITTED' AND decision_version=?
    `).bind(command.actor.staffId, now, id, expectedVersion);
    await database.batch([
      update,
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
      `),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: RATE_KIND,
        aggregateId: id, eventType: `${RATE_KIND}_CONFIRMED`,
        actor: { type: 'STAFF', id: command.actor.staffId,
          roles: command.actor.roles },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: { status: 'SUBMITTED', decision_version: expectedVersion },
        nextState: response, createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { rate_version_id: id }, now,
      }),
      assertRateState(database, acquired.claim, response),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizePricingError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

interface CanonicalRateRow {
  id: string;
  business_date: string | null;
  seller_organization_id: string | null;
  source_currency_code: CurrencyCode;
  version_no: number;
  status: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED';
  rate_value: number;
  rate_scale: number;
  effective_from: number | null;
  decision_version: number;
}

async function requireRate(
  database: SqlDatabase,
  id: string,
): Promise<CanonicalRateRow> {
  const row = await database.prepare(`
    SELECT id, business_date, NULL AS seller_organization_id,
      NULL AS effective_from, source_currency_code, version_no, status,
      rate_value, rate_scale, decision_version
    FROM ${RATE_TABLE} WHERE id=?
  `).bind(id).first<CanonicalRateRow>();
  if (!row) throw new PricingError('PRICING_RULE_NOT_FOUND', 404);
  return {
    ...row,
    version_no: Number(row.version_no), rate_value: Number(row.rate_value),
    rate_scale: Number(row.rate_scale),
    effective_from: row.effective_from === null
      ? null : Number(row.effective_from),
    decision_version: Number(row.decision_version),
  };
}

async function latestVersion(
  database: SqlDatabase,
  input: SubmitRateInput,
): Promise<{ latestVersion: number; pendingCount: number }> {
  const row = await database.prepare(`
    SELECT COALESCE(MAX(version_no),0) AS latest_version,
      COALESCE(SUM(status='SUBMITTED'),0) AS pending_count
    FROM ${RATE_TABLE}
    WHERE business_date=? AND source_currency_code=?
      AND quote_currency_code='CNY'
  `).bind(input.businessDate, input.sourceCurrencyCode).first<{
    latest_version: number; pending_count: number;
  }>();
  return {
    latestVersion: Number(row?.latest_version ?? 0),
    pendingCount: Number(row?.pending_count ?? 0),
  };
}

function assertRateState(
  database: SqlDatabase,
  claim: { actorType: string; actorId: string; idempotencyKey: string;
    leaseToken: string },
  response: CurrencyRateVersionResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (SELECT 1 FROM ${RATE_TABLE}
        WHERE id=? AND status=? AND decision_version=?)
      AND EXISTS (SELECT 1 FROM command_idempotency_records
        WHERE actor_type=? AND actor_id=? AND idempotency_key=?
          AND status='COMMITTED' AND lease_token=?)
    THEN 1 ELSE 0 END
  `).bind(response.rate_version_id, response.status,
    response.decision_version, claim.actorType, claim.actorId,
    claim.idempotencyKey, claim.leaseToken);
}

async function requireActiveSourceCurrency(
  database: SqlDatabase,
  code: CurrencyCode,
): Promise<void> {
  if (code === 'CNY') throw new PricingError('VALIDATION_ERROR', 400);
  const row = await database.prepare(`
    SELECT status FROM currencies WHERE code=?
  `).bind(code).first<{ status: string }>();
  if (row?.status !== 'ACTIVE') {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
}

function positiveInteger(raw: string): {
  databaseValue: number; serialized: string;
} {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/u.test(raw)) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const value = BigInt(raw);
  if (value > MAX_SAFE) throw new PricingError('VALIDATION_ERROR', 400);
  return { databaseValue: Number(value), serialized: value.toString(10) };
}
