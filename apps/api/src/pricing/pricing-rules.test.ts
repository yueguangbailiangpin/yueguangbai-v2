import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type { SqlDatabase } from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import {
  confirmBuyerDailyExchangeRate,
  rejectBuyerDailyExchangeRate,
  resolveBuyerDailyExchangeRate,
  submitBuyerDailyExchangeRate,
} from './buyer-daily-exchange-rates';
import {
  confirmSellerServiceFee,
  resolveSellerServiceFee,
  submitSellerServiceFee,
} from './seller-service-fees';
import type { PricingStaffActor } from './pricing-shared';

let database: SqliteDatabase | null = null;

const sellerOps: PricingStaffActor = {
  staffId: 'staff-seller-ops',
  displayName: 'Seller Ops',
  roles: ['seller_ops'],
};
const owner: PricingStaffActor = {
  staffId: 'staff-owner',
  displayName: 'Owner',
  roles: ['owner'],
};

afterEach(() => {
  database?.close();
  database = null;
});

describe('Phase 3E pricing rules', () => {
  it('confirms one exact buyer rate per China business date without fallback', async () => {
    database = pricingDatabase();

    const submitted = await submitBuyerDailyExchangeRate(
      database,
      {
        businessDate: '2026-08-01',
        cnyPerJpyE8: '5000000',
        expectedVersion: 0,
      },
      command(sellerOps, 'pricing:buyer-rate:submit:0001', 1_000),
    );
    expect(submitted).toMatchObject({
      business_date: '2026-08-01',
      version_no: 1,
      decision_version: 1,
      status: 'SUBMITTED',
      cny_per_jpy_e8: '5000000',
      replayed: false,
    });

    const replay = await submitBuyerDailyExchangeRate(
      database,
      {
        businessDate: '2026-08-01',
        cnyPerJpyE8: '5000000',
        expectedVersion: 0,
      },
      command(sellerOps, 'pricing:buyer-rate:submit:0001', 1_100),
    );
    expect(replay).toEqual({ ...submitted, replayed: true });

    await expect(resolveBuyerDailyExchangeRate(database, {
      businessDate: '2026-08-01',
      asOf: 1_999,
    })).rejects.toMatchObject({
      code: 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND',
      status: 404,
    });

    const confirmed = await confirmBuyerDailyExchangeRate(
      database,
      { rateId: submitted.rate_id, expectedVersion: 1 },
      command(owner, 'pricing:buyer-rate:confirm:0001', 2_000),
    );
    expect(confirmed).toMatchObject({
      status: 'CONFIRMED',
      decision_version: 2,
      rejection_reason: null,
    });

    await expect(resolveBuyerDailyExchangeRate(database, {
      businessDate: '2026-08-02',
      asOf: 3_000,
    })).rejects.toMatchObject({
      code: 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND',
      status: 404,
    });

    expect(await resolveBuyerDailyExchangeRate(database, {
      businessDate: '2026-08-01',
      asOf: 3_000,
    })).toEqual({
      rate_id: submitted.rate_id,
      business_date: '2026-08-01',
      version_no: 1,
      cny_per_jpy_e8: '5000000',
      confirmed_at: 2_000,
    });

    await expect(submitBuyerDailyExchangeRate(
      database,
      {
        businessDate: '2026-08-01',
        cnyPerJpyE8: '5100000',
        expectedVersion: 1,
      },
      command(sellerOps, 'pricing:buyer-rate:submit:0002', 3_000),
    )).rejects.toMatchObject({
      code: 'PRICING_RULE_ALREADY_DECIDED',
      status: 409,
    });
  });

  it('allows a rejected buyer date version to be replaced with a new version', async () => {
    database = pricingDatabase();
    const first = await submitBuyerDailyExchangeRate(
      database,
      {
        businessDate: '2026-08-03',
        cnyPerJpyE8: '5000000',
        expectedVersion: 0,
      },
      command(sellerOps, 'pricing:buyer-reject:submit:0001', 1_000),
    );
    const rejected = await rejectBuyerDailyExchangeRate(
      database,
      {
        rateId: first.rate_id,
        expectedVersion: 1,
        rejectionReason: '录入错误',
      },
      command(owner, 'pricing:buyer-reject:decision:0001', 2_000),
    );
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      rejection_reason: '录入错误',
      decision_version: 2,
    });

    const second = await submitBuyerDailyExchangeRate(
      database,
      {
        businessDate: '2026-08-03',
        cnyPerJpyE8: '5050000',
        expectedVersion: 1,
      },
      command(sellerOps, 'pricing:buyer-reject:submit:0002', 3_000),
    );
    expect(second.version_no).toBe(2);
  });

  it('fails a stale concurrent decision through the in-transaction change assertion', async () => {
    database = pricingDatabase();
    const submitted = await submitBuyerDailyExchangeRate(
      database,
      {
        businessDate: '2026-08-05',
        cnyPerJpyE8: '5000000',
        expectedVersion: 0,
      },
      command(sellerOps, 'pricing:race:submit:0001', 1_000),
    );

    let injected = false;
    const racingDatabase: SqlDatabase = {
      prepare: (sql) => database!.prepare(sql),
      batch: async (statements) => {
        if (!injected) {
          injected = true;
          await confirmBuyerDailyExchangeRate(
            database!,
            { rateId: submitted.rate_id, expectedVersion: 1 },
            command(
              {
                staffId: 'staff-racer',
                displayName: 'Racing Owner',
                roles: ['owner'],
              },
              'pricing:race:winner:0001',
              2_000,
            ),
          );
        }
        return database!.batch(statements);
      },
    };

    await expect(confirmBuyerDailyExchangeRate(
      racingDatabase,
      { rateId: submitted.rate_id, expectedVersion: 1 },
      command(owner, 'pricing:race:loser:0001', 2_100),
    )).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });

    const events = await database.prepare(`
      SELECT COUNT(*) AS count
      FROM buyer_daily_exchange_rate_events
      WHERE version_id=?
        AND event_type='BUYER_DAILY_EXCHANGE_RATE_CONFIRMED'
    `).bind(submitted.rate_id).first<{ count: number }>();
    expect(Number(events?.count)).toBe(1);
  });

  it('versions service fees independently by review type and permits zero fen', async () => {
    database = pricingDatabase();
    const image = await submitSellerServiceFee(
      database,
      {
        sellerOrganizationId: 'seller-org-1',
        reviewType: 'IMAGE',
        feeCnyFen: '12000',
        effectiveFrom: 10_000,
        expectedVersion: 0,
      },
      command(sellerOps, 'pricing:fee:image:submit:0001', 1_000),
    );
    const rating = await submitSellerServiceFee(
      database,
      {
        sellerOrganizationId: 'seller-org-1',
        reviewType: 'RATING',
        feeCnyFen: '0',
        effectiveFrom: 10_000,
        expectedVersion: 0,
      },
      command(sellerOps, 'pricing:fee:rating:submit:0001', 1_100),
    );
    await confirmSellerServiceFee(
      database,
      { feeVersionId: image.fee_version_id, expectedVersion: 1 },
      command(owner, 'pricing:fee:image:confirm:0001', 2_000),
    );
    await confirmSellerServiceFee(
      database,
      { feeVersionId: rating.fee_version_id, expectedVersion: 1 },
      command(owner, 'pricing:fee:rating:confirm:0001', 2_100),
    );

    expect((await resolveSellerServiceFee(database, {
      sellerOrganizationId: 'seller-org-1',
      reviewType: 'IMAGE',
      at: 10_000,
    })).fee_cny_fen).toBe('12000');
    expect((await resolveSellerServiceFee(database, {
      sellerOrganizationId: 'seller-org-1',
      reviewType: 'RATING',
      at: 10_000,
    })).fee_cny_fen).toBe('0');
    await expect(resolveSellerServiceFee(database, {
      sellerOrganizationId: 'seller-org-1',
      reviewType: 'VIDEO',
      at: 10_000,
    })).rejects.toMatchObject({
      code: 'PRICING_RULE_NOT_FOUND',
      status: 404,
    });
  });

  it('enforces roles, expectedVersion, immutable facts, audit, and outbox', async () => {
    database = pricingDatabase();
    await expect(submitBuyerDailyExchangeRate(
      database,
      {
        businessDate: '2026-08-04',
        cnyPerJpyE8: '5000000',
        expectedVersion: 0,
      },
      command(owner, 'pricing:permissions:submit:0001', 1_000),
    )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    const rate = await submitBuyerDailyExchangeRate(
      database,
      {
        businessDate: '2026-08-04',
        cnyPerJpyE8: '5000000',
        expectedVersion: 0,
      },
      command(sellerOps, 'pricing:permissions:submit:0002', 1_100),
    );
    await expect(confirmBuyerDailyExchangeRate(
      database,
      { rateId: rate.rate_id, expectedVersion: 2 },
      command(owner, 'pricing:permissions:confirm:0001', 2_000),
    )).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });

    await confirmBuyerDailyExchangeRate(
      database,
      { rateId: rate.rate_id, expectedVersion: 1 },
      command(owner, 'pricing:permissions:confirm:0002', 2_100),
    );

    await expect(database.prepare(`
      UPDATE buyer_daily_exchange_rates
      SET cny_per_jpy_e8=1
      WHERE id=?
    `).bind(rate.rate_id).run()).rejects.toThrow(
      'buyer_daily_exchange_rate_is_immutable',
    );
    await expect(database.prepare(`
      DELETE FROM buyer_daily_exchange_rate_events
      WHERE version_id=?
    `).bind(rate.rate_id).run()).rejects.toThrow(
      'buyer_daily_exchange_rate_events_are_immutable',
    );

    const counts = await database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM audit_events
          WHERE aggregate_type='BUYER_DAILY_EXCHANGE_RATE') AS audits,
        (SELECT COUNT(*) FROM integration_outbox
          WHERE aggregate_type='BUYER_DAILY_EXCHANGE_RATE') AS outbox,
        (SELECT COUNT(*) FROM command_idempotency_records
          WHERE status='COMMITTED') AS committed
    `).first<{
      audits: number;
      outbox: number;
      committed: number;
    }>();
    expect(counts).toEqual({ audits: 2, outbox: 2, committed: 2 });
  });
});

function pricingDatabase(): SqliteDatabase {
  const result = createMigratedTestDatabase();
  seedPricingFixture(result);
  return result;
}

function seedPricingFixture(result: SqliteDatabase): void {
  result.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      ('staff-seller-ops', 'Seller Ops', 'ACTIVE', 1, 1, 1, 1, NULL),
      ('staff-owner', 'Owner', 'ACTIVE', 1, 1, 1, 1, NULL),
      ('staff-racer', 'Racing Owner', 'ACTIVE', 1, 1, 1, 1, NULL);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-1', 'JP', 'ido-mango-000001',
      'seller-channel-ido-mango', 'seller-channel-ido-mango',
      1, '匿名测试卖家', 'ACTIVE',
      1, 1, 1, 1, NULL, 2
    );
  `);
}

function command(
  actor: PricingStaffActor,
  idempotencyKey: string,
  now: number,
) {
  return {
    actor,
    idempotencyKey,
    requestId: `${idempotencyKey}:request`,
    now,
  };
}
