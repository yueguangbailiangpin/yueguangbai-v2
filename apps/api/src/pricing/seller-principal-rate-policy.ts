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
  assertPreviousStatementChangedOnce,
  cleanEpochMilliseconds,
  cleanExpectedVersion,
  cleanPricingIdentifier,
  cleanPricingReason,
  normalizePricingError,
  PricingError,
  requireOwnerConfirmer,
  type PricingStaffActor,
} from './pricing-shared';

const RATE_SCALE = 100_000_000;
const POLICY_KIND = 'SELLER_PRINCIPAL_RATE_POLICY';

function requireSellerPrincipalPolicySubmitter(actor: PricingStaffActor): void {
  if (!actor.roles.includes('seller_ops') && !actor.roles.includes('owner')) {
    throw new PricingError('FORBIDDEN', 403);
  }
}

interface PolicyRow {
  id: string;
  scope_type: SellerPrincipalRatePolicyScope;
  seller_organization_id: string | null;
  source_currency_code: CurrencyCode;
  quote_currency_code: 'CNY';
  version_no: number;
  decision_version: number;
  status: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED';
  markup_rate_value: number;
  rate_scale: number;
  effective_from: number;
  submitted_by_staff_id: string;
  submitted_at: number;
  confirmed_at: number | null;
  rejection_reason: string | null;
  replayed?: boolean;
}

interface BaseRateRow {
  id: string;
  business_date: string;
  version_no: number;
  rate_value: number;
  rate_scale: number;
  confirmed_at: number;
}

export interface SellerPrincipalRatePolicyCommand {
  actor: PricingStaffActor;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
}

export async function submitSellerPrincipalRatePolicy(
  database: SqlDatabase,
  input: {
    scopeType: SellerPrincipalRatePolicyScope;
    sellerOrganizationId: string | null;
    sourceCurrencyCode: CurrencyCode;
    markupRateValue: string;
    expectedVersion: number;
    effectiveFrom: number;
  },
  command: SellerPrincipalRatePolicyCommand,
): Promise<SellerPrincipalRatePolicyVersionDto> {
  requireSellerPrincipalPolicySubmitter(command.actor);
  const normalized = normalizePolicyInput(input);
  const now = cleanEpochMilliseconds(command.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    action: 'SUBMIT_SELLER_PRINCIPAL_RATE_POLICY',
    ...normalized,
  });
  const targetId = policyTargetId(normalized);
  const acquired = await acquireIdempotency<SellerPrincipalRatePolicyVersionDto>(
    database,
    {
      actorType: 'STAFF', actorId: command.actor.staffId,
      action: 'SUBMIT_SELLER_PRINCIPAL_RATE_POLICY',
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
    if (latest.pendingCount > 0) {
      throw new PricingError('PRICING_RULE_PENDING_CONFLICT', 409);
    }
    // P1-B tiered approval: the currency-pair default markup skips the
    // second-person approval.  The row is still born SUBMITTED (the trigger
    // state machine demands it) and is decided CONFIRMED within the same
    // transaction by the submitter.  Organization overrides keep the
    // submitter -> Owner confirmer dual control.
    const autoConfirm = normalized.scopeType === 'CURRENCY_PAIR_DEFAULT';
    if (autoConfirm && normalized.effectiveFrom <= now) {
      throw new PricingError('PRICING_RULE_EFFECTIVE_TIME_CONFLICT', 409);
    }
    const id = crypto.randomUUID();
    const baseRow = {
      id,
      scope_type: normalized.scopeType,
      seller_organization_id: normalized.sellerOrganizationId,
      source_currency_code: normalized.sourceCurrencyCode,
      quote_currency_code: 'CNY' as const,
      version_no: normalized.expectedVersion + 1,
      markup_rate_value: normalized.markupRateValue,
      rate_scale: RATE_SCALE,
      effective_from: normalized.effectiveFrom,
      submitted_by_staff_id: command.actor.staffId,
      submitted_at: now,
      rejection_reason: null,
      replayed: false,
    };
    const submittedRow: PolicyRow = {
      ...baseRow,
      decision_version: 1,
      status: 'SUBMITTED',
      confirmed_at: null,
    };
    const response = autoConfirm
      ? policyDto({
          ...baseRow,
          decision_version: 2,
          status: 'CONFIRMED',
          confirmed_at: now,
        })
      : policyDto(submittedRow);
    const submittedOutbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `seller-principal-rate-policy-submitted:${targetId}:${response.version_no}`,
      eventType: 'SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED',
      aggregateType: POLICY_KIND,
      aggregateId: id,
      payload: policyDto(submittedRow),
      createdAt: now,
    });
    const statements: SqlStatement[] = [
      insertPolicy(database, response, command.actor.staffId, now),
      insertPolicyEvent(database, policyDto(submittedRow), command.actor.staffId,
        null, 'SUBMITTED', acquired.claim.idempotencyKey, now),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: POLICY_KIND, aggregateId: id,
        eventType: 'SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED',
        actor: { type: 'STAFF', id: command.actor.staffId,
          roles: command.actor.roles },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: policyDto(submittedRow), createdAt: now,
      }),
      ...createOutboxStatements(database, submittedOutbox),
    ];
    if (autoConfirm) {
      const confirmedOutbox = await prepareOutboxEvent({
        id: crypto.randomUUID(),
        dedupKey: `seller-principal-rate-policy-confirmed:${targetId}:${response.version_no}`,
        eventType: 'SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED',
        aggregateType: POLICY_KIND,
        aggregateId: id,
        payload: response,
        createdAt: now,
      });
      statements.push(
        database.prepare(`
          UPDATE seller_principal_rate_policy_versions
          SET status='CONFIRMED', decision_version=2,
            confirmed_by_staff_id=?, confirmed_at=?
          WHERE id=? AND status='SUBMITTED' AND decision_version=1
        `).bind(command.actor.staffId, now, id),
        assertPreviousStatementChangedOnce(database),
        insertPolicyEvent(database, response, command.actor.staffId,
          'SUBMITTED', 'CONFIRMED', acquired.claim.idempotencyKey, now),
        createAuditEventStatement(database, {
          id: crypto.randomUUID(), aggregateType: POLICY_KIND, aggregateId: id,
          eventType: 'SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED',
          actor: { type: 'STAFF', id: command.actor.staffId,
            roles: command.actor.roles },
          requestId: command.requestId ?? null,
          idempotencyKey: acquired.claim.idempotencyKey,
          previousState: policyDto(submittedRow),
          nextState: response, createdAt: now,
        }),
        ...createOutboxStatements(database, confirmedOutbox),
      );
    }
    statements.push(
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { policy_version_id: id }, now,
      }),
      assertPolicyState(database, acquired.claim, response),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    );
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalizedError = normalizePricingError(error);
    await markIdempotencyFailed(
      database, acquired.claim, normalizedError.code, now,
    );
    throw normalizedError;
  }
}

export async function confirmSellerPrincipalRatePolicy(
  database: SqlDatabase,
  input: { policyVersionId: string; expectedVersion: number },
  command: SellerPrincipalRatePolicyCommand,
): Promise<SellerPrincipalRatePolicyVersionDto> {
  return decideSellerPrincipalRatePolicy(database, input, 'CONFIRM', null, command);
}

export async function rejectSellerPrincipalRatePolicy(
  database: SqlDatabase,
  input: { policyVersionId: string; expectedVersion: number; rejectionReason: string },
  command: SellerPrincipalRatePolicyCommand,
): Promise<SellerPrincipalRatePolicyVersionDto> {
  return decideSellerPrincipalRatePolicy(
    database, input, 'REJECT', input.rejectionReason, command,
  );
}

async function decideSellerPrincipalRatePolicy(
  database: SqlDatabase,
  input: { policyVersionId: string; expectedVersion: number },
  decision: 'CONFIRM' | 'REJECT',
  rejectionReason: string | null,
  command: SellerPrincipalRatePolicyCommand,
): Promise<SellerPrincipalRatePolicyVersionDto> {
  requireOwnerConfirmer(command.actor);
  const id = cleanPricingIdentifier(input.policyVersionId);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion);
  const reason = decision === 'REJECT'
    ? cleanPricingReason(rejectionReason ?? '')
    : null;
  const now = cleanEpochMilliseconds(command.now ?? Date.now());
  const action = decision === 'CONFIRM'
    ? 'CONFIRM_SELLER_PRINCIPAL_RATE_POLICY'
    : 'REJECT_SELLER_PRINCIPAL_RATE_POLICY';
  const requestHash = await hashCanonicalJson({
    action, policy_version_id: id, expected_version: expectedVersion,
    rejection_reason: reason,
  });
  const acquired = await acquireIdempotency<SellerPrincipalRatePolicyVersionDto>(
    database,
    {
      actorType: 'STAFF', actorId: command.actor.staffId,
      action, targetType: POLICY_KIND, targetId: id,
      idempotencyKey: command.idempotencyKey, requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const source = await requirePolicy(database, id);
    // P1-B dual control for organization overrides: the submitter may not
    // also decide their own submission, even when the submitter is the
    // Owner.  Currency-pair defaults no longer pass through decide().
    if (source.scope_type === 'SELLER_ORGANIZATION'
      && command.actor.staffId === source.submitted_by_staff_id) {
      throw new PricingError('FORBIDDEN', 403);
    }
    if (source.decision_version !== expectedVersion
      || source.status !== 'SUBMITTED') {
      throw new PricingError('VERSION_CONFLICT', 409);
    }
    if (decision === 'CONFIRM' && source.effective_from <= now) {
      throw new PricingError('PRICING_RULE_EFFECTIVE_TIME_CONFLICT', 409);
    }
    const response = policyDto({
      ...source,
      decision_version: source.decision_version + 1,
      status: decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED',
      confirmed_at: decision === 'CONFIRM' ? now : null,
      rejection_reason: reason,
      replayed: false,
    });
    const eventType = decision === 'CONFIRM'
      ? 'SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED'
      : 'SELLER_PRINCIPAL_RATE_POLICY_REJECTED';
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `${eventType.toLowerCase()}:${source.id}:${response.decision_version}`,
      eventType,
      aggregateType: POLICY_KIND,
      aggregateId: source.id,
      payload: response,
      createdAt: now,
    });
    await database.batch([
      database.prepare(`
        UPDATE seller_principal_rate_policy_versions
        SET status=?, decision_version=?, confirmed_by_staff_id=?,
          confirmed_at=?, rejected_by_staff_id=?, rejected_at=?,
          rejection_reason=?
        WHERE id=? AND status='SUBMITTED' AND decision_version=?
      `).bind(
        response.status, response.decision_version,
        decision === 'CONFIRM' ? command.actor.staffId : null,
        response.confirmed_at,
        decision === 'REJECT' ? command.actor.staffId : null,
        decision === 'REJECT' ? now : null,
        response.rejection_reason,
        source.id, expectedVersion,
      ),
      assertPreviousStatementChangedOnce(database),
      insertPolicyEvent(database, response, command.actor.staffId,
        'SUBMITTED', response.status, acquired.claim.idempotencyKey, now,
        response.rejection_reason),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: POLICY_KIND, aggregateId: id,
        eventType, actor: { type: 'STAFF', id: command.actor.staffId,
          roles: command.actor.roles }, requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: source, nextState: response,
        reason: response.rejection_reason, createdAt: now,
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
  const [defaultRow, overrideRow, defaultPending, overridePending,
    defaultLatest, overrideLatest, defaultUpcoming, overrideUpcoming] = await Promise.all([
    resolvedPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      sourceCurrencyCode: input.sourceCurrencyCode, at,
    }),
    organizationId === null ? Promise.resolve(null) : resolvedPolicy(database, {
      scopeType: 'SELLER_ORGANIZATION', sellerOrganizationId: organizationId,
      sourceCurrencyCode: input.sourceCurrencyCode, at,
    }),
    pendingPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      sourceCurrencyCode: input.sourceCurrencyCode,
    }),
    organizationId === null ? Promise.resolve(null) : pendingPolicy(database, {
      scopeType: 'SELLER_ORGANIZATION', sellerOrganizationId: organizationId,
      sourceCurrencyCode: input.sourceCurrencyCode,
    }),
    latestPolicyVersion(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      sourceCurrencyCode: input.sourceCurrencyCode,
    }),
    organizationId === null
      ? Promise.resolve({ versionNo: 0, pendingCount: 0 })
      : latestPolicyVersion(database, {
          scopeType: 'SELLER_ORGANIZATION', sellerOrganizationId: organizationId,
          sourceCurrencyCode: input.sourceCurrencyCode,
        }),
    upcomingPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      sourceCurrencyCode: input.sourceCurrencyCode, at,
    }),
    organizationId === null ? Promise.resolve(null) : upcomingPolicy(database, {
      scopeType: 'SELLER_ORGANIZATION', sellerOrganizationId: organizationId,
      sourceCurrencyCode: input.sourceCurrencyCode, at,
    }),
  ]);
  return {
    source_currency_code: input.sourceCurrencyCode,
    quote_currency_code: 'CNY',
    seller_organization_id: organizationId,
    default_policy: defaultRow ? policyDto(defaultRow) : null,
    seller_override_policy: overrideRow ? policyDto(overrideRow) : null,
    default_pending_policy: defaultPending ? policyDto(defaultPending) : null,
    seller_override_pending_policy: overridePending ? policyDto(overridePending) : null,
    default_next_version: defaultLatest.versionNo + 1,
    seller_override_next_version: organizationId === null
      ? null
      : overrideLatest.versionNo + 1,
    selected_policy: overrideRow
      ? policyDto(overrideRow)
      : defaultRow ? policyDto(defaultRow) : null,
    default_upcoming_policy: defaultUpcoming ? policyDto(defaultUpcoming) : null,
    seller_override_upcoming_policy: overrideUpcoming ? policyDto(overrideUpcoming) : null,
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
    SELECT id, business_date, version_no, rate_value, rate_scale, confirmed_at
    FROM buyer_daily_currency_rate_versions
    WHERE business_date=? AND source_currency_code=?
      AND quote_currency_code='CNY' AND status='CONFIRMED'
      AND confirmed_at<=?
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
    sourceCurrencyCode: input.paymentCurrencyCode, at,
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
    base_rate_confirmed_at: Number(base.confirmed_at),
    base_rate_value: String(baseValue),
    base_rate_scale: String(base.rate_scale),
    policy_version_id: policy.id,
    policy_scope_type: policy.scope_type,
    policy_seller_organization_id: policy.seller_organization_id,
    policy_version_no: policy.version_no,
    policy_effective_from: policy.effective_from,
    policy_confirmed_at: policy.confirmed_at!,
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
      base_rate_confirmed_at, base_rate_value, base_rate_scale,
      policy_version_id, policy_scope_type, policy_seller_organization_id,
      policy_version_no, policy_effective_from, policy_confirmed_at,
      markup_rate_value, markup_rate_scale, final_rate_value, final_rate_scale,
      rounding_rule, seller_expected_principal_amount_minor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    formalOrderId, snapshot.platform_order_date,
    Number(snapshot.payment_amount_minor), snapshot.payment_currency_code,
    snapshot.base_rate_version_id, snapshot.base_rate_business_date,
    snapshot.base_rate_confirmed_at, Number(snapshot.base_rate_value),
    Number(snapshot.base_rate_scale), snapshot.policy_version_id,
    snapshot.policy_scope_type, snapshot.policy_seller_organization_id,
    snapshot.policy_version_no, snapshot.policy_effective_from,
    snapshot.policy_confirmed_at, Number(snapshot.markup_rate_value),
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
  effectiveFrom: number;
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
    effectiveFrom: cleanEpochMilliseconds(input.effectiveFrom),
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
): Promise<{ versionNo: number; pendingCount: number }> {
  const row = await database.prepare(`
    SELECT COALESCE(MAX(version_no), 0) AS latest_version,
      COALESCE(SUM(status='SUBMITTED'), 0) AS pending_count
    FROM seller_principal_rate_policy_versions
    WHERE scope_type=? AND seller_organization_id IS ?
      AND source_currency_code=? AND quote_currency_code='CNY'
  `).bind(input.scopeType, input.sellerOrganizationId,
    input.sourceCurrencyCode).first<{ latest_version: number; pending_count: number }>();
  return {
    versionNo: Number(row?.latest_version ?? 0),
    pendingCount: Number(row?.pending_count ?? 0),
  };
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
      quote_currency_code, version_no, decision_version, status,
      markup_rate_value, rate_scale, effective_from, submitted_by_staff_id, submitted_at,
      confirmed_at, rejection_reason
    FROM seller_principal_rate_policy_versions
    WHERE scope_type=? AND seller_organization_id IS ?
      AND source_currency_code=? AND quote_currency_code='CNY'
      AND status='CONFIRMED' AND effective_from<=? AND confirmed_at<=?
    ORDER BY effective_from DESC, version_no DESC
    LIMIT 1
  `).bind(input.scopeType, input.sellerOrganizationId,
    input.sourceCurrencyCode, input.at, input.at).first<PolicyRow>();
  return row ? normalizePolicyRow(row) : null;
}

async function pendingPolicy(
  database: SqlDatabase,
  input: {
    scopeType: SellerPrincipalRatePolicyScope;
    sellerOrganizationId: string | null;
    sourceCurrencyCode: CurrencyCode;
  },
): Promise<PolicyRow | null> {
  const row = await database.prepare(`
    SELECT id, scope_type, seller_organization_id, source_currency_code,
      quote_currency_code, version_no, decision_version, status,
      markup_rate_value, rate_scale, effective_from, submitted_by_staff_id, submitted_at,
      confirmed_at, rejection_reason
    FROM seller_principal_rate_policy_versions
    WHERE scope_type=? AND seller_organization_id IS ?
      AND source_currency_code=? AND quote_currency_code='CNY'
      AND status='SUBMITTED'
    ORDER BY version_no DESC
    LIMIT 1
  `).bind(input.scopeType, input.sellerOrganizationId,
    input.sourceCurrencyCode).first<PolicyRow>();
  return row ? normalizePolicyRow(row) : null;
}

async function upcomingPolicy(
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
      quote_currency_code, version_no, decision_version, status,
      markup_rate_value, rate_scale, effective_from, submitted_by_staff_id, submitted_at,
      confirmed_at, rejection_reason
    FROM seller_principal_rate_policy_versions
    WHERE scope_type=? AND seller_organization_id IS ?
      AND source_currency_code=? AND quote_currency_code='CNY'
      AND status='CONFIRMED' AND effective_from>?
    ORDER BY effective_from ASC, version_no DESC
    LIMIT 1
  `).bind(input.scopeType, input.sellerOrganizationId,
    input.sourceCurrencyCode, input.at).first<PolicyRow>();
  return row ? normalizePolicyRow(row) : null;
}

async function requirePolicy(database: SqlDatabase, id: string): Promise<PolicyRow> {
  const row = await database.prepare(`
    SELECT id, scope_type, seller_organization_id, source_currency_code,
      quote_currency_code, version_no, decision_version, status,
      markup_rate_value, rate_scale, effective_from, submitted_by_staff_id, submitted_at,
      confirmed_at, rejection_reason
    FROM seller_principal_rate_policy_versions WHERE id=?
  `).bind(id).first<PolicyRow>();
  if (!row) throw new PricingError('PRICING_RULE_NOT_FOUND', 404);
  return normalizePolicyRow(row);
}

function insertPolicy(
  database: SqlDatabase,
  row: SellerPrincipalRatePolicyVersionDto,
  staffId: string,
  now: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO seller_principal_rate_policy_versions (
      id, scope_type, seller_organization_id, source_currency_code,
      quote_currency_code, version_no, status, markup_rate_value, rate_scale,
      effective_from, submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
      rejection_reason
    ) VALUES (?, ?, ?, ?, 'CNY', ?, 'SUBMITTED', ?, ?, ?, ?, ?, 1,
      NULL, NULL, NULL, NULL, NULL)
  `).bind(
    row.policy_version_id, row.scope_type, row.seller_organization_id,
    row.source_currency_code, row.version_no, Number(row.markup_rate_value),
    Number(row.markup_rate_scale), row.effective_from, staffId, now,
  );
}

function insertPolicyEvent(
  database: SqlDatabase,
  row: SellerPrincipalRatePolicyVersionDto,
  staffId: string,
  previousStatus: 'SUBMITTED' | null,
  nextStatus: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED',
  idempotencyKey: string,
  now: number,
  reason: string | null = null,
): SqlStatement {
  const eventType = nextStatus === 'SUBMITTED'
    ? 'SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED'
    : nextStatus === 'CONFIRMED'
      ? 'SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED'
      : 'SELLER_PRINCIPAL_RATE_POLICY_REJECTED';
  return database.prepare(`
    INSERT INTO seller_principal_rate_policy_events (
      id, version_id, scope_type, seller_organization_id,
      source_currency_code, quote_currency_code, version_no, event_type,
      actor_staff_id, previous_status, next_status, markup_rate_value,
      effective_from, reason, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), row.policy_version_id, row.scope_type,
    row.seller_organization_id, row.source_currency_code, row.version_no,
    eventType, staffId, previousStatus, nextStatus,
    Number(row.markup_rate_value), row.effective_from, reason,
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
        WHERE id=? AND status=? AND version_no=? AND decision_version=?)
      AND EXISTS (SELECT 1 FROM seller_principal_rate_policy_events
        WHERE version_id=? AND next_status=?)
      AND EXISTS (SELECT 1 FROM command_idempotency_records
        WHERE actor_type=? AND actor_id=? AND idempotency_key=?
          AND status='COMMITTED' AND lease_token=?)
    THEN 1 ELSE 0 END
  `).bind(
    row.policy_version_id, row.status, row.version_no, row.decision_version,
    row.policy_version_id, row.status, claim.actorType, claim.actorId,
    claim.idempotencyKey, claim.leaseToken,
  );
}

function normalizePolicyRow(row: PolicyRow): PolicyRow {
  return {
    ...row,
    version_no: Number(row.version_no),
    decision_version: Number(row.decision_version),
    markup_rate_value: Number(row.markup_rate_value),
    rate_scale: Number(row.rate_scale),
    effective_from: Number(row.effective_from),
    submitted_at: Number(row.submitted_at),
    confirmed_at: row.confirmed_at === null ? null : Number(row.confirmed_at),
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
    decision_version: Number(row.decision_version),
    status: row.status,
    markup_rate_value: String(row.markup_rate_value),
    markup_rate_scale: String(row.rate_scale),
    effective_from: Number(row.effective_from),
    submitted_at: Number(row.submitted_at),
    confirmed_at: row.confirmed_at === null ? null : Number(row.confirmed_at),
    rejection_reason: row.rejection_reason,
    replayed: row.replayed ?? false,
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
