import type {
  BuyerDailyExchangeRateReadDto,
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
import {
  cleanBusinessDate,
  cleanEpochMilliseconds,
  cleanExpectedVersion,
  cleanRateE8,
  normalizePricingError,
  PricingError,
  requireRateMaintainer,
  type PricingStaffActor,
} from './pricing-shared';

/**
 * Stage 6.6 (D-056) single-source rate model: `buyer_daily_currency_rate_versions`
 * is the only order-date base-rate table. One save immediately forms a new
 * effective, immutable version — there is no SUBMITTED/CONFIRMED/REJECTED dual
 * approval. Owner and seller_ops have identical maintenance rights; formal
 * orders resolve by Amazon order business date and keep immutable snapshots.
 */

interface SavedRateRow {
  id: string;
  business_date: string;
  version_no: number;
  rate_value: number;
  rate_scale: number;
  created_by_staff_id: string;
  created_at: number;
}

export interface SaveBuyerDailyExchangeRateResult {
  rate_version_id: string;
  business_date: string;
  version_no: number;
  rate_value: string;
  rate_scale: string;
  effective_from: number;
  replayed: boolean;
}

export async function saveBuyerDailyExchangeRate(
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
): Promise<SaveBuyerDailyExchangeRateResult> {
  requireRateMaintainer(command.actor);
  const businessDate = cleanBusinessDate(input.businessDate);
  const rate = cleanRateE8(input.cnyPerJpyE8);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion, { allowZero: true });
  const now = cleanEpochMilliseconds(command.now ?? Date.now());

  const requestHash = await hashCanonicalJson({
    action: 'SAVE_BUYER_DAILY_EXCHANGE_RATE',
    business_date: businessDate,
    rate_value: rate.serialized,
    expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<SaveBuyerDailyExchangeRateResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'SAVE_BUYER_DAILY_EXCHANGE_RATE',
      targetType: 'BUYER_DAILY_CURRENCY_RATE_DATE',
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
    const latestVersion = await readLatestRateVersion(database, businessDate);
    if (latestVersion !== expectedVersion) {
      throw new PricingError('VERSION_CONFLICT', 409);
    }

    const rateVersionId = crypto.randomUUID();
    const versionNo = expectedVersion + 1;
    const response: SaveBuyerDailyExchangeRateResult = {
      rate_version_id: rateVersionId,
      business_date: businessDate,
      version_no: versionNo,
      rate_value: rate.serialized,
      rate_scale: '100000000',
      effective_from: now,
      replayed: false,
    };

    const statements: SqlStatement[] = [
      database
        .prepare(
          `
        INSERT INTO buyer_daily_currency_rate_versions (
          id, business_date, source_currency_code, quote_currency_code,
          version_no, rate_value, rate_scale, rounding_rule,
          effective_from, created_by_staff_id, created_at
        ) VALUES (?, ?, 'JPY', 'CNY', ?, ?, 100000000, 'HALF_UP', ?, ?, ?)
      `,
        )
        .bind(
          rateVersionId,
          businessDate,
          versionNo,
          rate.databaseValue,
          now,
          command.actor.staffId,
          now,
        ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_DAILY_CURRENCY_RATE',
        aggregateId: rateVersionId,
        eventType: 'BUYER_DAILY_EXCHANGE_RATE_SAVED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: {
          rate_version_id: rateVersionId,
          business_date: businessDate,
          version_no: versionNo,
          rate_value: rate.serialized,
          rate_scale: '100000000',
          effective_from: now,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { rate_version_id: rateVersionId },
        now,
      }),
      assertRateSaved(database, acquired.claim, response),
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
      rate_value,
      rate_scale,
      created_at
    FROM buyer_daily_currency_rate_versions
    WHERE business_date=?
      AND source_currency_code='JPY'
      AND quote_currency_code='CNY'
      AND created_at<=?
    ORDER BY version_no DESC
    LIMIT 1
  `,
    )
    .bind(businessDate, asOf)
    .first<{
      id: string;
      business_date: string;
      version_no: number;
      rate_value: number;
      rate_scale: number;
      created_at: number;
    }>();

  if (!row) {
    throw new PricingError('BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND', 404);
  }
  return {
    rate_id: row.id,
    business_date: row.business_date,
    version_no: Number(row.version_no),
    rate_value: String(row.rate_value),
    rate_scale: String(row.rate_scale),
    created_at: Number(row.created_at),
  };
}

/**
 * Read the single authoritative JPY/CNY base-rate stream for an Amazon order
 * date. Formal-order snapshots and seller principal snapshots both resolve
 * through this one table (D-056).
 */
export async function readBuyerDailyExchangeRateVersions(
  database: SqlDatabase,
  input: { businessDate: string },
): Promise<BuyerDailyExchangeRateReadDto> {
  const businessDate = cleanBusinessDate(input.businessDate);
  const rows = await database
    .prepare(
      `
    SELECT id, business_date, version_no, rate_value, rate_scale,
      created_by_staff_id, created_at
    FROM buyer_daily_currency_rate_versions
    WHERE business_date=? AND source_currency_code='JPY'
      AND quote_currency_code='CNY'
    ORDER BY version_no DESC
  `,
    )
    .bind(businessDate)
    .all<SavedRateRow>();
  const values = rows.results.map((row) => ({
    rate_version_id: row.id,
    business_date: row.business_date,
    version_no: Number(row.version_no),
    rate_value: String(row.rate_value),
    rate_scale: String(row.rate_scale),
    created_by_staff_id: row.created_by_staff_id,
    created_at: Number(row.created_at),
  }));
  return {
    business_date: businessDate,
    versions: values,
    active_version: values[0] ?? null,
    next_version: (values.at(0)?.version_no ?? 0) + 1,
  };
}

async function readLatestRateVersion(
  database: SqlDatabase,
  businessDate: string,
): Promise<number> {
  const row = await database
    .prepare(
      `
    SELECT COALESCE(MAX(version_no), 0) AS latest_version
    FROM buyer_daily_currency_rate_versions
    WHERE business_date=? AND source_currency_code='JPY'
      AND quote_currency_code='CNY'
  `,
    )
    .bind(businessDate)
    .first<{ latest_version: number }>();
  return Number(row?.latest_version ?? 0);
}

function assertRateSaved(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: SaveBuyerDailyExchangeRateResult,
): SqlStatement {
  return database
    .prepare(
      `
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1 FROM buyer_daily_currency_rate_versions
        WHERE id=? AND business_date=? AND version_no=?
          AND effective_from=created_at
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
      response.rate_version_id,
      response.business_date,
      response.version_no,
      claim.actorType,
      claim.actorId,
      claim.idempotencyKey,
      claim.leaseToken,
    );
}
