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

type RateKind = 'BUYER_DAILY_CURRENCY_RATE' | 'SELLER_AGREEMENT_CURRENCY_RATE';

interface RateConfiguration {
  kind: RateKind;
  table: 'buyer_daily_currency_rate_versions'
    | 'seller_agreement_currency_rate_versions';
}

const BUYER_CONFIG: RateConfiguration = {
  kind: 'BUYER_DAILY_CURRENCY_RATE',
  table: 'buyer_daily_currency_rate_versions',
};

const SELLER_CONFIG: RateConfiguration = {
  kind: 'SELLER_AGREEMENT_CURRENCY_RATE',
  table: 'seller_agreement_currency_rate_versions',
};

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
  return submitCurrencyRate(database, BUYER_CONFIG, {
    businessDate: cleanBusinessDate(input.businessDate),
    sellerOrganizationId: null,
    sourceCurrencyCode: input.sourceCurrencyCode,
    rateValue: input.rateValue,
    rateScale: input.rateScale,
    effectiveFrom: null,
    expectedVersion: input.expectedVersion,
  }, command);
}

export function submitSellerAgreementCurrencyRate(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    sourceCurrencyCode: CurrencyCode;
    rateValue: string;
    rateScale: string;
    effectiveFrom: number;
    expectedVersion: number;
  },
  command: RateCommand,
): Promise<CurrencyRateVersionResult> {
  requireSellerOpsSubmitter(command.actor);
  return submitCurrencyRate(database, SELLER_CONFIG, {
    businessDate: null,
    sellerOrganizationId: cleanPricingIdentifier(input.sellerOrganizationId),
    sourceCurrencyCode: input.sourceCurrencyCode,
    rateValue: input.rateValue,
    rateScale: input.rateScale,
    effectiveFrom: cleanEpochMilliseconds(input.effectiveFrom),
    expectedVersion: input.expectedVersion,
  }, command);
}

export function confirmBuyerDailyCurrencyRate(
  database: SqlDatabase,
  input: { rateVersionId: string; expectedVersion: number },
  command: RateCommand,
): Promise<CurrencyRateVersionResult> {
  return confirmCurrencyRate(database, BUYER_CONFIG, input, command);
}

export function confirmSellerAgreementCurrencyRate(
  database: SqlDatabase,
  input: { rateVersionId: string; expectedVersion: number },
  command: RateCommand,
): Promise<CurrencyRateVersionResult> {
  return confirmCurrencyRate(database, SELLER_CONFIG, input, command);
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
  config: RateConfiguration,
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
  if (input.sellerOrganizationId) {
    await requireActiveSeller(database, input.sellerOrganizationId);
  }
  const targetId = rateTarget(config, input);
  const action = `SUBMIT_${config.kind}`;
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
      action, targetType: config.kind, targetId,
      idempotencyKey: command.idempotencyKey, requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const latest = await latestVersion(database, config, input);
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
    const insert = config === BUYER_CONFIG
      ? database.prepare(`
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
          rateScale.databaseValue, command.actor.staffId, now)
      : database.prepare(`
          INSERT INTO seller_agreement_currency_rate_versions (
            id, legacy_rate_id, seller_organization_id,
            source_currency_code, quote_currency_code, version_no, status,
            rate_value, rate_scale, rounding_rule, effective_from,
            submitted_by_staff_id, submitted_at, decision_version,
            confirmed_by_staff_id, confirmed_at, rejected_by_staff_id,
            rejected_at, rejection_reason
          ) VALUES (?,NULL,?,?, 'CNY',?,'SUBMITTED',?,?,'HALF_UP',?,?,?,1,
            NULL,NULL,NULL,NULL,NULL)
        `).bind(id, input.sellerOrganizationId, input.sourceCurrencyCode,
          response.version_no, rateValue.databaseValue,
          rateScale.databaseValue, input.effectiveFrom,
          command.actor.staffId, now);
    await database.batch([
      insert,
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: config.kind,
        aggregateId: id, eventType: `${config.kind}_SUBMITTED`,
        actor: { type: 'STAFF', id: command.actor.staffId,
          roles: command.actor.roles },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: response, createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { rate_version_id: id }, now,
      }),
      assertRateState(database, config, acquired.claim, response),
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
  config: RateConfiguration,
  input: { rateVersionId: string; expectedVersion: number },
  command: RateCommand,
): Promise<CurrencyRateVersionResult> {
  requireOwnerConfirmer(command.actor);
  const id = cleanPricingIdentifier(input.rateVersionId);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion);
  const now = cleanEpochMilliseconds(command.now ?? Date.now());
  const action = `CONFIRM_${config.kind}`;
  const requestHash = await hashCanonicalJson({
    action, rate_version_id: id, expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<CurrencyRateVersionResult>(
    database,
    {
      actorType: 'STAFF', actorId: command.actor.staffId,
      action, targetType: config.kind, targetId: id,
      idempotencyKey: command.idempotencyKey, requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const source = await requireRate(database, config, id);
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
      UPDATE ${config.table}
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
        id: crypto.randomUUID(), aggregateType: config.kind,
        aggregateId: id, eventType: `${config.kind}_CONFIRMED`,
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
      assertRateState(database, config, acquired.claim, response),
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
  config: RateConfiguration,
  id: string,
): Promise<CanonicalRateRow> {
  const columns = config === BUYER_CONFIG
    ? 'business_date, NULL AS seller_organization_id, NULL AS effective_from'
    : 'NULL AS business_date, seller_organization_id, effective_from';
  const row = await database.prepare(`
    SELECT id, ${columns}, source_currency_code, version_no, status,
      rate_value, rate_scale, decision_version
    FROM ${config.table} WHERE id=?
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
  config: RateConfiguration,
  input: SubmitRateInput,
): Promise<{ latestVersion: number; pendingCount: number }> {
  const predicate = config === BUYER_CONFIG
    ? 'business_date=? AND source_currency_code=?'
    : 'seller_organization_id=? AND source_currency_code=?';
  const key = config === BUYER_CONFIG
    ? input.businessDate : input.sellerOrganizationId;
  const row = await database.prepare(`
    SELECT COALESCE(MAX(version_no),0) AS latest_version,
      COALESCE(SUM(status='SUBMITTED'),0) AS pending_count
    FROM ${config.table}
    WHERE ${predicate} AND quote_currency_code='CNY'
  `).bind(key, input.sourceCurrencyCode).first<{
    latest_version: number; pending_count: number;
  }>();
  return {
    latestVersion: Number(row?.latest_version ?? 0),
    pendingCount: Number(row?.pending_count ?? 0),
  };
}

function assertRateState(
  database: SqlDatabase,
  config: RateConfiguration,
  claim: { actorType: string; actorId: string; idempotencyKey: string;
    leaseToken: string },
  response: CurrencyRateVersionResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (SELECT 1 FROM ${config.table}
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

async function requireActiveSeller(
  database: SqlDatabase,
  id: string,
): Promise<void> {
  const row = await database.prepare(`
    SELECT status FROM seller_organizations WHERE id=?
  `).bind(id).first<{ status: string }>();
  if (!row) throw new PricingError('NOT_FOUND', 404);
  if (row.status !== 'ACTIVE') throw new PricingError('VALIDATION_ERROR', 400);
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

function rateTarget(config: RateConfiguration, input: SubmitRateInput): string {
  const first = config === BUYER_CONFIG
    ? input.businessDate : input.sellerOrganizationId;
  return `${first}:${input.sourceCurrencyCode}:CNY`;
}
