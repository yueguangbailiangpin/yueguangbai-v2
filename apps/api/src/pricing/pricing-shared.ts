import type {
  PricingReviewType,
  PricingRuleStatus,
  SqlDatabase,
  SqlStatement,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  canonicalJson,
  parseChinaBusinessDate,
  parseCnyFen,
  parseCnyPerJpyE8,
  toD1SafeInteger,
} from '@ygb/domain';

export interface PricingStaffActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
}

export type PricingErrorCode =
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND'
  | 'SELLER_PRINCIPAL_RATE_NOT_FOUND'
  | 'PRICING_RULE_NOT_FOUND'
  | 'PRICING_RULE_ALREADY_DECIDED'
  | 'PRICING_RULE_PENDING_CONFLICT'
  | 'PRICING_RULE_EFFECTIVE_TIME_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'DEPENDENCY_UNAVAILABLE';

export class PricingError extends Error {
  constructor(
    public readonly code: PricingErrorCode,
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'PricingError';
  }
}

export function requireSellerOpsSubmitter(actor: PricingStaffActor): void {
  validateActor(actor);
  // The common order-date base rate is submitted by an Owner in the normal
  // rate-center flow.  Keep seller_ops support for the legacy daily-rate
  // operational workflow, but never use a non-Staff role here.
  if (!actor.roles.includes('seller_ops') && !actor.roles.includes('owner')) {
    throw new PricingError('FORBIDDEN', 403);
  }
}

export function requireOwnerConfirmer(actor: PricingStaffActor): void {
  validateActor(actor);
  if (!actor.roles.includes('owner')) {
    throw new PricingError('FORBIDDEN', 403);
  }
}

export function cleanPricingIdentifier(raw: string, maximum = 120): string {
  if (typeof raw !== 'string') {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const normalized = raw.normalize('NFKC').trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function cleanPricingReason(raw: string): string {
  return cleanPricingIdentifier(raw, 1000);
}

export function cleanBusinessDate(raw: string): string {
  try {
    return parseChinaBusinessDate(raw);
  } catch {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
}

/**
 * Optional `as_of` epoch-millisecond parameter for the pricing read routes.
 * Omitting it means "now".  Historical lookups (finance page date rewind)
 * pass an explicit timestamp; future timestamps simply resolve to nothing.
 */
export function parseAsOfParameter(raw: string | null): number {
  if (raw === null) return Date.now();
  if (!/^\d{1,15}$/u.test(raw)) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  return cleanEpochMilliseconds(Number(raw));
}

export function cleanRateE8(raw: string): {
  bigintValue: bigint;
  databaseValue: number;
  serialized: string;
} {
  try {
    const bigintValue = parseCnyPerJpyE8(raw);
    return {
      bigintValue,
      databaseValue: toD1SafeInteger(bigintValue),
      serialized: bigintValue.toString(10),
    };
  } catch {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
}

export function cleanFeeFen(raw: string): {
  bigintValue: bigint;
  databaseValue: number;
  serialized: string;
} {
  try {
    const bigintValue = parseCnyFen(raw);
    return {
      bigintValue,
      databaseValue: toD1SafeInteger(bigintValue),
      serialized: bigintValue.toString(10),
    };
  } catch {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
}

export function cleanEpochMilliseconds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function cleanExpectedVersion(value: number, options: { allowZero?: boolean } = {}): number {
  const minimum = options.allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function assertPreviousStatementChangedOnce(database: SqlDatabase): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
  `);
}

export function insertPricingEventStatement(
  database: SqlDatabase,
  input: {
    table: 'buyer_daily_exchange_rate_events' | 'seller_service_fee_events';
    versionId: string;
    organizationId?: string | null;
    businessDate?: string | null;
    reviewType?: PricingReviewType | null;
    versionNo: number;
    eventType: string;
    actorId: string;
    previousStatus: PricingRuleStatus | null;
    nextStatus: PricingRuleStatus;
    valueColumn: 'cny_per_jpy_e8' | 'fee_cny_fen';
    value: number;
    effectiveFrom?: number | null;
    reason?: string | null;
    idempotencyKey: string;
    createdAt: number;
  },
): SqlStatement {
  const valueColumn = input.valueColumn;
  const sql = `
    INSERT INTO ${input.table} (
      id,
      version_id,
      organization_id,
      business_date,
      review_type,
      version_no,
      event_type,
      actor_staff_id,
      previous_status,
      next_status,
      ${valueColumn},
      effective_from,
      reason,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  return database
    .prepare(sql)
    .bind(
      crypto.randomUUID(),
      input.versionId,
      input.organizationId ?? null,
      input.businessDate ?? null,
      input.reviewType ?? null,
      input.versionNo,
      input.eventType,
      input.actorId,
      input.previousStatus,
      input.nextStatus,
      input.value,
      input.effectiveFrom ?? null,
      input.reason ?? null,
      input.idempotencyKey,
      input.createdAt,
    );
}

export function pricingAuditState(input: {
  status: PricingRuleStatus;
  versionNo: number;
  decisionVersion: number;
  valueName: 'cny_per_jpy_e8' | 'fee_cny_fen';
  value: string;
  effectiveFrom?: number | null;
  businessDate?: string | null;
  reviewType?: PricingReviewType | null;
}): Record<string, unknown> {
  return JSON.parse(
    canonicalJson({
      status: input.status,
      version_no: input.versionNo,
      decision_version: input.decisionVersion,
      [input.valueName]: input.value,
      effective_from: input.effectiveFrom ?? null,
      business_date: input.businessDate ?? null,
      review_type: input.reviewType ?? null,
    }),
  ) as Record<string, unknown>;
}

export function normalizePricingError(error: unknown): PricingError {
  if (error instanceof PricingError) return error;

  const record = error as { code?: unknown };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new PricingError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new PricingError('REQUEST_IN_PROGRESS', 409);
  }

  const message = String(error);
  if (
    message.includes('pricing_pending_conflict') ||
    message.includes('seller_principal_rate_policy_pending')
  ) {
    return new PricingError('PRICING_RULE_PENDING_CONFLICT', 409);
  }
  if (
    message.includes('seller_principal_rate_policy_version')
  ) {
    // Two concurrent submissions for the same policy target raced past the
    // version check and collided on the (scope, version_no) unique index.
    return new PricingError('VERSION_CONFLICT', 409);
  }
  if (
    message.includes('pricing_confirmed_conflict') ||
    message.includes('pricing_effective_conflict') ||
    message.includes('seller_principal_rate_policy_confirmed_effective')
  ) {
    return new PricingError('PRICING_RULE_EFFECTIVE_TIME_CONFLICT', 409);
  }
  if (message.includes('transaction_assertion_failed')) {
    return new PricingError('VERSION_CONFLICT', 409);
  }
  return new PricingError('DEPENDENCY_UNAVAILABLE', 503);
}

function validateActor(actor: PricingStaffActor): void {
  if (
    !actor ||
    typeof actor.staffId !== 'string' ||
    actor.staffId.length < 1 ||
    actor.staffId.length > 120 ||
    typeof actor.displayName !== 'string' ||
    actor.displayName.length < 1 ||
    actor.roles.length !== 1
  ) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
}
