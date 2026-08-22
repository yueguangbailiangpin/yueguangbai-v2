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

describe('Staff rate center HTTP boundary', () => {
  it('permits only Owner plus financial correction to submit and confirm the shared Amazon-order-day base rate', async () => {
    database = fixture();
    const withoutFinancial = appFor(owner(['SELLER_MANAGE'], ['FINANCIAL_CORRECT']));
    const denied = await withoutFinancial.request(
      `${ORIGIN}/api/staff/rate-center/base-rates/submit`,
      baseRequest({ business_date: '2026-08-22', rate_value: '0.047', expected_version: 0 }),
      { DB: database },
    );
    expect(denied.status).toBe(403);

    const sellerOps = appFor(actor('seller_ops', 'seller-ops', ['SELLER_MANAGE']), assignedScope());
    const nonOwner = await sellerOps.request(
      `${ORIGIN}/api/staff/rate-center/base-rates/submit`,
      baseRequest({ business_date: '2026-08-22', rate_value: '0.047', expected_version: 0 }),
      { DB: database },
    );
    expect(nonOwner.status).toBe(403);

    const app = appFor(owner(['SELLER_MANAGE', 'FINANCIAL_CORRECT']));
    const submitted = await app.request(
      `${ORIGIN}/api/staff/rate-center/base-rates/submit`,
      baseRequest({ business_date: '2026-08-22', rate_value: '0.047', expected_version: 0 }),
      { DB: database },
    );
    expect(submitted.status).toBe(200);
    const submittedJson = (await submitted.json()) as {
      data: { base_rate: { rate_id: string; cny_per_jpy_e8: string } };
    };
    expect(submittedJson.data.base_rate.cny_per_jpy_e8).toBe('4700000');

    const confirmed = await app.request(
      `${ORIGIN}/api/staff/rate-center/base-rates/${submittedJson.data.base_rate.rate_id}/confirm`,
      baseRequest({ expected_version: 1 }),
      { DB: database },
    );
    expect(confirmed.status).toBe(200);

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
        base_rate: { confirmed_rate: { cny_per_jpy_e8: '4700000' } },
      },
    });
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
      ('seller-ops','卖家对接','ACTIVE',1,1,1,1,NULL)
  `);
  return db;
}
