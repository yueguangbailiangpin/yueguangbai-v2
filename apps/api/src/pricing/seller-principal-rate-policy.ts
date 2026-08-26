import type {
  CurrencyCode,
  SellerPrincipalRatePolicyReadDto,
  SellerPrincipalRatePolicyScope,
  SellerPrincipalRatePolicyVersionDto,
  SellerPrincipalRateSnapshotDto,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  addCnyPerJpyE8,
  hashCanonicalJson,
  parseCnyPerJpyE8,
  parseCnyPerJpyMarkupDecimal,
  parseCnyPerJpyMarkupE8,
  parseJpyInteger,
  toD1SafeInteger,
  convertJpyToCnyFen,
} from '@ygb/domain';
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
  cleanEpochMilliseconds,
  cleanExpectedVersion,
  cleanPricingIdentifier,
  normalizePricingError,
  PricingError,
  requireRateMaintainer,
  type PricingStaffActor,
} from './pricing-shared';

/**
 * Stage 6.6 (D-056): one save immediately forms a new effective, immutable
 * markup policy version (effective_from = save time). No dual approval; owner
 * and seller_ops have identical maintenance rights. Resolution and snapshot
 * semantics from D-053 are unchanged: order-date base rate + markup, integer
 * E8 scale, HALF_UP principal, immutable snapshots.
 */

const RATE_SCALE = 100_000_000;
const POLICY_KIND = 'SELLER_PRINCIPAL_RATE_POLICY';

interface PolicyRow {
  id: string;
  scope_type: SellerPrincipalRatePolicyScope;
  seller_organization_id: string | null;
  source_currency_code: CurrencyCode;
  version_no: number;
  markup_rate_value: number;
  rate_scale: number;
  effective_from: number;
  created_by_staff_id: string;
  created_at: number;
}

interface BaseRateRow {
  id: string;
  business_date: string;
  version_no: number;
  rate_value: number;
  rate_scale: number;
  created_at: number;
}

export interface SellerPrincipalRatePolicyCommand {
  actor: PricingStaffActor;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
}

export async function saveSellerPrincipalRatePolicy(
  database: SqlDatabase,
  input: {
    scopeType: SellerPrincipalRatePolicyScope;
    sellerOrganizationId: string | null;
    sourceCurrencyCode: CurrencyCode;
    markupRateValue: string;
    expectedVersion: number;
  },
  command: SellerPrincipalRatePolicyCommand,
): Promise<SellerPrincipalRatePolicyVersionDto> {
  requireRateMaintainer(command.actor);
  const normalized = normalizePolicyInput(input);
  const now = cleanEpochMilliseconds(command.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    action: 'SAVE_SELLER_PRINCIPAL_RATE_POLICY',
    scope_type: normalized.scopeType,
    seller_organization_id: normalized.sellerOrganizationId,
    source_currency_code: normalized.sourceCurrencyCode,
    markup_rate_value: normalized.markupRateValue,
    expected_version: normalized.expectedVersion,
  });
  const targetId = policyTargetId(normalized);
  const acquired = await acquireIdempotency<SellerPrincipalRatePolicyVersionDto>(
    database,
    {
      actorType: 'STAFF', actorId: command.actor.staffId,
      action: 'SAVE_SELLER_PRINCIPAL_RATE_POLICY',
      targetType: POLICY_KIND, targetId,
      idempotencyKey: command.idempotencyKey, requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    await requireActiveCurrency(database, normalized.sourceCurrencyCode);
    if (normalized.sellerOrganizationId !== null) {
      await requireActiveSellerOrganization(
        database,
        normalized.sellerOrganizationId,
      );
    }
    const latest = await latestPolicyVersion(database, normalized);
    if (latest.versionNo !== normalized.expectedVersion) {
      throw new PricingError('VERSION_CONFLICT', 409);
    }
    const id = crypto.randomUUID();
    const response: SellerPrincipalRatePolicyVersionDto = {
      policy_version_id: id,
      scope_type: normalized.scopeType,
      seller_organization_id: normalized.sellerOrganizationId,
      source_currency_code: normalized.sourceCurrencyCode,
      quote_currency_code: 'CNY',
      version_no: normalized.expectedVersion + 1,
      markup_rate_value: String(normalized.markupRateValue),
      markup_rate_scale: String(RATE_SCALE),
      effective_from: now,
      created_by_staff_id: command.actor.staffId,
      created_at: now,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `seller-principal-rate-policy-saved:${targetId}:${response.version_no}`,
      eventType: 'SELLER_PRINCIPAL_RATE_POLICY_SAVED',
      aggregateType: POLICY_KIND,
      aggregateId: id,
      payload: response,
      createdAt: now,
    });
    await database.batch([
      insertPolicy(database, response, now),
      insertPolicyEvent(database, response, command.actor.staffId,
        acquired.claim.idempotencyKey, now),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: POLICY_KIND, aggregateId: id,
        eventType: 'SELLER_PRINCIPAL_RATE_POLICY_SAVED',
        actor: { type: 'STAFF', id: command.actor.staffId,
          roles: command.actor.roles },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: response, createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { policy_version_id: id }, now,
      }),
      assertPolicyState(database, acquired.claim, response),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalizedError = normalizePricingError(error);
    await markIdempotencyFailed(
      database, acquired.claim, normalizedError.code, now,
    );
    throw normalizedError;
  }
}

export async function readSellerPrincipalRatePolicies(
  database: SqlDatabase,
  input: {
    sourceCurrencyCode: CurrencyCode;
    sellerOrganizationId: string | null;
    at: number;
  },
): Promise<SellerPrincipalRatePolicyReadDto> {
  const at = cleanEpochMilliseconds(input.at);
  const organizationId = input.sellerOrganizationId === null
    ? null
    : cleanPricingIdentifier(input.sellerOrganizationId);
  const [defaultRow, overrideRow, defaultLatest, overrideLatest] = await Promise.all([
    resolvedPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      sourceCurrencyCode: input.sourceCurrencyCode, at,
    }),
    organizationId === null ? Promise.resolve(null) : resolvedPolicy(database, {
      scopeType: 'SELLER_ORGANIZATION', sellerOrganizationId: organizationId,
      sourceCurrencyCode: input.sourceCurrencyCode, at,
    }),
    latestPolicyVersion(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      sourceCurrencyCode: input.sourceCurrencyCode,
    }),
    organizationId === null
      ? Promise.resolve({ versionNo: 0 })
      : latestPolicyVersion(database, {
          scopeType: 'SELLER_ORGANIZATION', sellerOrganizationId: organizationId,
          sourceCurrencyCode: input.sourceCurrencyCode,
        }),
  ]);
  return {
    source_currency_code: input.sourceCurrencyCode,
    quote_currency_code: 'CNY',
    seller_organization_id: organizationId,
    default_policy: defaultRow ? policyDto(defaultRow) : null,
    seller_override_policy: overrideRow ? policyDto(overrideRow) : null,
    default_next_version: defaultLatest.versionNo + 1,
    seller_override_next_version: organizationId === null
      ? null
      : overrideLatest.versionNo + 1,
    selected_policy: overrideRow
      ? policyDto(overrideRow)
      : defaultRow ? policyDto(defaultRow) : null,
  };
}

export async function resolveSellerPrincipalRateSnapshot(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    platformOrderDate: string;
    paymentAmountMinor: number;
    paymentCurrencyCode: CurrencyCode;
    at: number;
  },
): Promise<SellerPrincipalRateSnapshotDto> {
  if (input.paymentCurrencyCode !== 'JPY') {
    throw new PricingError('SELLER_PRINCIPAL_RATE_NOT_FOUND', 404);
  }
  const orderDate = cleanDate(input.platformOrderDate);
  const paymentAmount = toD1SafeInteger(
    parseJpyInteger(String(input.paymentAmountMinor)),
  );
  const at = cleanEpochMilliseconds(input.at);
  const base = await database.prepare(`
    SELECT id, business_date, version_no, rate_value, rate_scale, created_at
    FROM buyer_daily_currency_rate_versions
    WHERE business_date=? AND source_currency_code=?
      AND quote_currency_code='CNY'
      AND created_at<=?
    ORDER BY version_no DESC
    LIMIT 1
  `).bind(orderDate, input.paymentCurrencyCode, at).first<BaseRateRow>();
  if (!base) throw new PricingError('SELLER_PRINCIPAL_RATE_NOT_FOUND', 404);
  const policy = await resolvedPolicy(database, {
    scopeType: 'SELLER_ORGANIZATION',
    sellerOrganizationId: input.sellerOrganizationId,
    sourceCurrencyCode: input.paymentCurrencyCode,
    at,
  }) ?? await resolvedPolicy(database, {
    scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
    sourceCurrencyCode: input.paymentCurrencyCode,
    at,
  });
  if (!policy) throw new PricingError('SELLER_PRINCIPAL_RATE_NOT_FOUND', 404);
  const baseValue = parseCnyPerJpyE8(String(base.rate_value));
  const markupValue = parseCnyPerJpyMarkupE8(String(policy.markup_rate_value));
  if (Number(base.rate_scale) !== RATE_SCALE) {
    throw new PricingError('DEPENDENCY_UNAVAILABLE', 503);
  }
  const finalValue = addCnyPerJpyE8(baseValue, markupValue);
  const expected = convertJpyToCnyFen(
    BigInt(paymentAmount), finalValue, 'HALF_UP',
  );
  return {
    platform_order_date: orderDate,
    payment_amount_minor: String(paymentAmount),
    payment_currency_code: input.paymentCurrencyCode,
    base_rate_version_id: base.id,
    base_rate_business_date: base.business_date,
    base_rate_created_at: Number(base.created_at),
    base_rate_value: String(baseValue),
    base_rate_scale: String(base.rate_scale),
    policy_version_id: policy.id,
    policy_scope_type: policy.scope_type,
    policy_seller_organization_id: policy.seller_organization_id,
    policy_version_no: policy.version_no,
    policy_effective_from: policy.effective_from,
    policy_created_at: policy.created_at,
    markup_rate_value: String(markupValue),
    markup_rate_scale: String(policy.rate_scale),
    final_rate_value: String(finalValue),
    final_rate_scale: String(RATE_SCALE),
    rounding_rule: 'HALF_UP',
    seller_expected_principal_amount_minor: String(expected),
  };
}

export function insertSellerPrincipalRateSnapshotStatement(
  database: SqlDatabase,
  formalOrderId: string,
  snapshot: SellerPrincipalRateSnapshotDto,
  createdAt: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO seller_principal_rate_snapshots (
      formal_order_id, platform_order_date, payment_amount_minor,
      payment_currency_code, base_rate_version_id, base_rate_business_date,
      base_rate_created_at, base_rate_value, base_rate_scale,
      policy_version_id, policy_scope_type, policy_seller_organization_id,
      policy_version_no, policy_effective_from, policy_created_at,
      markup_rate_value, markup_rate_scale, final_rate_value, final_rate_scale,
      rounding_rule, seller_expected_principal_amount_minor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    formalOrderId, snapshot.platform_order_date,
    Number(snapshot.payment_amount_minor), snapshot.payment_currency_code,
    snapshot.base_rate_version_id, snapshot.base_rate_business_date,
    snapshot.base_rate_created_at, Number(snapshot.base_rate_value),
    Number(snapshot.base_rate_scale), snapshot.policy_version_id,
    snapshot.policy_scope_type, snapshot.policy_seller_organization_id,
    snapshot.policy_version_no, snapshot.policy_effective_from,
    snapshot.policy_created_at, Number(snapshot.markup_rate_value),
    Number(snapshot.markup_rate_scale), Number(snapshot.final_rate_value),
    Number(snapshot.final_rate_scale), snapshot.rounding_rule,
    Number(snapshot.seller_expected_principal_amount_minor), createdAt,
  );
}

function normalizePolicyInput(input: {
  scopeType: SellerPrincipalRatePolicyScope;
  sellerOrganizationId: string | null;
  sourceCurrencyCode: CurrencyCode;
  markupRateValue: string;
  expectedVersion: number;
}) {
  if (input.scopeType !== 'CURRENCY_PAIR_DEFAULT'
    && input.scopeType !== 'SELLER_ORGANIZATION') {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const sellerOrganizationId = input.scopeType === 'CURRENCY_PAIR_DEFAULT'
    ? null
    : input.sellerOrganizationId === null
      ? null
      : cleanPricingIdentifier(input.sellerOrganizationId);
  if (input.scopeType === 'SELLER_ORGANIZATION'
    && sellerOrganizationId === null) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  if (input.sourceCurrencyCode === 'CNY') {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  let markupRateValue: number;
  try {
    markupRateValue = toD1SafeInteger(
      parseCnyPerJpyMarkupDecimal(input.markupRateValue),
    );
  } catch {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  return {
    scopeType: input.scopeType,
    sellerOrganizationId,
    sourceCurrencyCode: input.sourceCurrencyCode,
    markupRateValue,
    expectedVersion: cleanExpectedVersion(input.expectedVersion, { allowZero: true }),
  };
}

function policyTargetId(input: {
  scopeType: SellerPrincipalRatePolicyScope;
  sellerOrganizationId: string | null;
  sourceCurrencyCode: CurrencyCode;
}): string {
  return `${input.scopeType}:${input.sellerOrganizationId ?? 'DEFAULT'}:${input.sourceCurrencyCode}:CNY`;
}

async function latestPolicyVersion(
  database: SqlDatabase,
  input: {
    scopeType: SellerPrincipalRatePolicyScope;
    sellerOrganizationId: string | null;
    sourceCurrencyCode: CurrencyCode;
  },
): Promise<{ versionNo: number }> {
  const row = await database.prepare(`
    SELECT COALESCE(MAX(version_no), 0) AS latest_version
    FROM seller_principal_rate_policy_versions
    WHERE scope_type=? AND seller_organization_id IS ?
      AND source_currency_code=? AND quote_currency_code='CNY'
  `).bind(input.scopeType, input.sellerOrganizationId,
    input.sourceCurrencyCode).first<{ latest_version: number }>();
  return { versionNo: Number(row?.latest_version ?? 0) };
}

async function resolvedPolicy(
  database: SqlDatabase,
  input: {
    scopeType: SellerPrincipalRatePolicyScope;
    sellerOrganizationId: string | null;
    sourceCurrencyCode: CurrencyCode;
    at: number;
  },
): Promise<PolicyRow | null> {
  const row = await database.prepare(`
    SELECT id, scope_type, seller_organization_id, source_currency_code,
      version_no, markup_rate_value, rate_scale, effective_from,
      created_by_staff_id, created_at
    FROM seller_principal_rate_policy_versions
    WHERE scope_type=? AND seller_organization_id IS ?
      AND source_currency_code=? AND quote_currency_code='CNY'
      AND effective_from<=?
    ORDER BY effective_from DESC, version_no DESC
    LIMIT 1
  `).bind(input.scopeType, input.sellerOrganizationId,
    input.sourceCurrencyCode, input.at).first<PolicyRow>();
  return row ? normalizePolicyRow(row) : null;
}

function insertPolicy(
  database: SqlDatabase,
  row: SellerPrincipalRatePolicyVersionDto,
  now: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO seller_principal_rate_policy_versions (
      id, scope_type, seller_organization_id, source_currency_code,
      quote_currency_code, version_no, markup_rate_value, rate_scale,
      effective_from, created_by_staff_id, created_at
    ) VALUES (?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?, ?)
  `).bind(
    row.policy_version_id, row.scope_type, row.seller_organization_id,
    row.source_currency_code, row.version_no, Number(row.markup_rate_value),
    Number(row.markup_rate_scale), now, row.created_by_staff_id, now,
  );
}

function insertPolicyEvent(
  database: SqlDatabase,
  row: SellerPrincipalRatePolicyVersionDto,
  staffId: string,
  idempotencyKey: string,
  now: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO seller_principal_rate_policy_events (
      id, version_id, scope_type, seller_organization_id,
      source_currency_code, quote_currency_code, version_no, event_type,
      actor_staff_id, markup_rate_value, effective_from,
      idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, 'CNY', ?, 'SELLER_PRINCIPAL_RATE_POLICY_SAVED',
      ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), row.policy_version_id, row.scope_type,
    row.seller_organization_id, row.source_currency_code, row.version_no,
    staffId, Number(row.markup_rate_value), row.effective_from,
    idempotencyKey, now,
  );
}

function assertPolicyState(
  database: SqlDatabase,
  claim: { actorType: string; actorId: string; idempotencyKey: string; leaseToken: string },
  row: SellerPrincipalRatePolicyVersionDto,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (SELECT 1 FROM seller_principal_rate_policy_versions
        WHERE id=? AND version_no=? AND effective_from=created_at)
      AND EXISTS (SELECT 1 FROM seller_principal_rate_policy_events
        WHERE version_id=?
          AND event_type='SELLER_PRINCIPAL_RATE_POLICY_SAVED')
      AND EXISTS (SELECT 1 FROM command_idempotency_records
        WHERE actor_type=? AND actor_id=? AND idempotency_key=?
          AND status='COMMITTED' AND lease_token=?)
    THEN 1 ELSE 0 END
  `).bind(
    row.policy_version_id, row.version_no, row.policy_version_id,
    claim.actorType, claim.actorId, claim.idempotencyKey, claim.leaseToken,
  );
}

function normalizePolicyRow(row: PolicyRow): PolicyRow {
  return {
    ...row,
    version_no: Number(row.version_no),
    markup_rate_value: Number(row.markup_rate_value),
    rate_scale: Number(row.rate_scale),
    effective_from: Number(row.effective_from),
    created_at: Number(row.created_at),
  };
}

function policyDto(row: PolicyRow): SellerPrincipalRatePolicyVersionDto {
  return {
    policy_version_id: row.id,
    scope_type: row.scope_type,
    seller_organization_id: row.seller_organization_id,
    source_currency_code: row.source_currency_code,
    quote_currency_code: 'CNY',
    version_no: Number(row.version_no),
    markup_rate_value: String(row.markup_rate_value),
    markup_rate_scale: String(row.rate_scale),
    effective_from: Number(row.effective_from),
    created_by_staff_id: row.created_by_staff_id,
    created_at: Number(row.created_at),
    replayed: false,
  };
}

function cleanDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf())
    || parsed.toISOString().slice(0, 10) !== value) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  return value;
}

async function requireActiveCurrency(
  database: SqlDatabase,
  code: CurrencyCode,
): Promise<void> {
  const row = await database.prepare(
    `SELECT 1 AS ok FROM currencies WHERE code=? AND status='ACTIVE'`,
  ).bind(code).first<{ ok: number }>();
  if (!row) throw new PricingError('PRICING_RULE_NOT_FOUND', 404);
}

async function requireActiveSellerOrganization(
  database: SqlDatabase,
  id: string,
): Promise<void> {
  const row = await database.prepare(
    `SELECT 1 AS ok FROM seller_organizations WHERE id=? AND status='ACTIVE'`,
  ).bind(id).first<{ ok: number }>();
  if (!row) throw new PricingError('NOT_FOUND', 404);
}
