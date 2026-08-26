import { afterEach, describe, expect, it } from 'vitest';
import type { StaffDataScope, StaffPermissionCode, StaffRoleCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp } from '../app';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { registerStaffRateCenterRoutes } from './rate-center-routes';

const ORIGIN = 'https://api.local.test';
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Staff rate center HTTP boundary (stage 6.6 single-save model)', () => {
  it('lets owner and seller_ops save the order-day base rate; others fail closed', async () => {
    database = fixture();

    const preSales = appFor(actor('pre_sales', 'pre-sales', ['SELLER_MANAGE']), assignedScope());
    const deniedRole = await preSales.request(
      `${ORIGIN}/api/staff/rate-center/base-rates`,
      baseRequest({ business_date: '2026-08-22', rate_value: '0.047', expected_version: 0 }),
      { DB: database },
    );
    expect(deniedRole.status).toBe(403);

    const ownerDeniedManage = appFor(owner(['FINANCIAL_CORRECT'], ['SELLER_MANAGE']));
    const deniedPermission = await ownerDeniedManage.request(
      `${ORIGIN}/api/staff/rate-center/base-rates`,
      baseRequest({ business_date: '2026-08-22', rate_value: '0.047', expected_version: 0 }),
      { DB: database },
    );
    expect(deniedPermission.status).toBe(403);

    const sellerOpsDenied = appFor(
      actor('seller_ops', 'seller-ops', ['SELLER_MANAGE'], ['SELLER_MANAGE']),
      assignedScope(),
    );
    const deniedOps = await sellerOpsDenied.request(
      `${ORIGIN}/api/staff/rate-center/base-rates`,
      baseRequest({ business_date: '2026-08-22', rate_value: '0.047', expected_version: 0 }),
      { DB: database },
    );
    expect(deniedOps.status).toBe(403);

    const sellerOps = appFor(actor('seller_ops', 'seller-ops', ['SELLER_MANAGE']), assignedScope());
    const savedByOps = await sellerOps.request(
      `${ORIGIN}/api/staff/rate-center/base-rates`,
      baseRequest({ business_date: '2026-08-22', rate_value: '0.047', expected_version: 0 }),
      { DB: database },
    );
    expect(savedByOps.status).toBe(200);
    const savedJson = (await savedByOps.json()) as {
      data: { base_rate: { rate_version_id: string; rate_value: string } };
    };
    expect(savedJson.data.base_rate.rate_value).toBe('4700000');

    const app = appFor(owner(['SELLER_MANAGE']));
    const read = await app.request(
      `${ORIGIN}/api/staff/rate-center?business_date=2026-08-22`,
      {},
      { DB: database },
    );
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      data: {
        business_date: '2026-08-22',
        source_currency_code: 'JPY',
        quote_currency_code: 'CNY',
        base_rate: {
          active_version: { rate_value: '4700000' },
          next_version: 2,
        },
      },
    });
  });

  it('rejects stale expected_version with a conflict and replays identical saves idempotently', async () => {
    database = fixture();
    const app = appFor(owner(['SELLER_MANAGE']));

    const first = await app.request(
      `${ORIGIN}/api/staff/rate-center/base-rates`,
      baseRequest({ business_date: '2026-08-23', rate_value: '0.050', expected_version: 0 }),
      { DB: database },
    );
    expect(first.status).toBe(200);

    const stale = await app.request(
      `${ORIGIN}/api/staff/rate-center/base-rates`,
      baseRequest({ business_date: '2026-08-23', rate_value: '0.051', expected_version: 0 }),
      { DB: database },
    );
    expect(stale.status).toBe(409);

    const idempotencyKey = `rate-center-${crypto.randomUUID()}`;
    const replayBody = { business_date: '2026-08-23', rate_value: '0.052', expected_version: 1 };
    const once = await app.request(
      `${ORIGIN}/api/staff/rate-center/base-rates`,
      { ...baseRequest(replayBody), headers: { ...jsonHeaders(), 'Idempotency-Key': idempotencyKey } },
      { DB: database },
    );
    expect(once.status).toBe(200);
    const onceJson = (await once.json()) as { data: { base_rate: { rate_version_id: string } } };

    const replay = await app.request(
      `${ORIGIN}/api/staff/rate-center/base-rates`,
      { ...baseRequest(replayBody), headers: { ...jsonHeaders(), 'Idempotency-Key': idempotencyKey } },
      { DB: database },
    );
    expect(replay.status).toBe(200);
    const replayJson = (await replay.json()) as { data: { base_rate: { rate_version_id: string; replayed: boolean } } };
    expect(replayJson.data.base_rate.rate_version_id).toBe(onceJson.data.base_rate.rate_version_id);
    expect(replayJson.data.base_rate.replayed).toBe(true);

    const mismatch = await app.request(
      `${ORIGIN}/api/staff/rate-center/base-rates`,
      {
        ...baseRequest({ business_date: '2026-08-23', rate_value: '0.053', expected_version: 1 }),
        headers: { ...jsonHeaders(), 'Idempotency-Key': idempotencyKey },
      },
      { DB: database },
    );
    expect(mismatch.status).toBe(409);
  });

  it('keeps saved versions immutable: no update or delete paths exist', () => {
    database = fixture();
    const db = database;
    db.exec(`
      INSERT INTO buyer_daily_currency_rate_versions (
        id, business_date, source_currency_code, quote_currency_code, version_no,
        rate_value, rate_scale, rounding_rule, effective_from,
        created_by_staff_id, created_at
      ) VALUES ('rate-v1','2026-08-22','JPY','CNY',1,4700000,100000000,'HALF_UP',1,'staff-owner',1)
    `);
    expect(() =>
      db.exec(`UPDATE buyer_daily_currency_rate_versions SET rate_value=1 WHERE id='rate-v1'`),
    ).toThrow(/immutable/u);
    expect(() =>
      db.exec(`DELETE FROM buyer_daily_currency_rate_versions WHERE id='rate-v1'`),
    ).toThrow(/immutable/u);
  });
});

function appFor(actorValue: AssignmentStaffAuthorization, scope: StaffDataScope = globalScope()) {
  const app = createApp();
  app.use('/api/staff/*', async (context, next) => {
    context.set('staffAuthorization', actorValue);
    context.set('staffDataScope', scope);
    await next();
  });
  registerStaffRateCenterRoutes(app);
  return app;
}

function actor(
  role: StaffRoleCode,
  staffId: string,
  grants: StaffPermissionCode[],
  denies: StaffPermissionCode[] = [],
): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]),
    grants: new Set(grants),
    denies: new Set(denies),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId,
    displayName: staffId,
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    ...effective,
  };
}

function owner(
  grants: StaffPermissionCode[],
  denies: StaffPermissionCode[] = [],
): AssignmentStaffAuthorization {
  return actor('owner', 'staff-owner', grants, denies);
}

function globalScope(): StaffDataScope {
  return {
    type: 'GLOBAL',
    marketplaceCodes: [],
    buyerCustomerIds: [],
    sellerOrganizationIds: [],
    teamIds: [],
  };
}

function assignedScope(): StaffDataScope {
  return {
    type: 'MARKETPLACE',
    marketplaceCodes: ['AMAZON_JP'],
    buyerCustomerIds: [],
    sellerOrganizationIds: [],
    teamIds: [],
  };
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

function baseRequest(body: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `rate-center-${crypto.randomUUID()}`,
    },
    body: JSON.stringify(body),
  };
}

function fixture(): SqliteDatabase {
  const db = createMigratedTestDatabase();
  db.exec(`
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
    VALUES ('staff-owner','Owner','ACTIVE',1,1,1,1,NULL),
      ('seller-ops','卖家对接','ACTIVE',1,1,1,1,NULL),
      ('pre-sales','售前','ACTIVE',1,1,1,1,NULL)
  `);
  return db;
}
