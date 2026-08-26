import { afterEach, describe, expect, it } from 'vitest';
import type { StaffDataScope, StaffPermissionCode, StaffRoleCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp } from '../app';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { registerSellerServiceFeeRoutes } from './seller-service-fee-routes';

const ORIGIN = 'https://api.local.test';
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('staff seller service fee routes (stage 6.6 single-save model)', () => {
  it('reads and saves with owner/seller_ops equal rights and fails others closed', async () => {
    database = fixture();

    const preSales = appFor(actor('pre_sales', 'pre-sales', ['SELLER_MANAGE']));
    const deniedRole = await preSales.request(
      `${ORIGIN}/api/staff/seller-service-fees`,
      saveBody({ review_type: 'TEXT', fee_cny_fen: '6000', expected_version: 0 }),
      { DB: database },
    );
    expect(deniedRole.status).toBe(403);

    const initialRead = await appFor(owner([])).request(
      `${ORIGIN}/api/staff/seller-service-fees?seller_organization_id=seller-org-1`,
      {},
      { DB: database },
    );
    expect(initialRead.status).toBe(200);
    expect(await initialRead.json()).toMatchObject({
      data: {
        seller_organization_id: 'seller-org-1',
        fees: [
          { review_type: 'RATING', effective_fee: null, next_version: 1 },
          { review_type: 'TEXT', effective_fee: null, next_version: 1 },
          { review_type: 'IMAGE', effective_fee: null, next_version: 1 },
          { review_type: 'VIDEO', effective_fee: null, next_version: 1 },
        ],
      },
    });

    const sellerOps = appFor(actor('seller_ops', 'seller-ops', ['SELLER_MANAGE']));
    const saved = await sellerOps.request(
      `${ORIGIN}/api/staff/seller-service-fees`,
      saveBody({ review_type: 'TEXT', fee_cny_fen: '6000', expected_version: 0 }),
      { DB: database },
    );
    expect(saved.status).toBe(200);

    const read = await sellerOps.request(
      `${ORIGIN}/api/staff/seller-service-fees?seller_organization_id=seller-org-1`,
      {},
      { DB: database },
    );
    const readJson = (await read.json()) as {
      data: { fees: Array<{ review_type: string; effective_fee: { fee_cny_fen: string } | null }> };
    };
    const textFee = readJson.data.fees.find((fee) => fee.review_type === 'TEXT');
    expect(textFee?.effective_fee).toMatchObject({ fee_cny_fen: '6000' });

    const stale = await sellerOps.request(
      `${ORIGIN}/api/staff/seller-service-fees`,
      saveBody({ review_type: 'TEXT', fee_cny_fen: '6500', expected_version: 0 }),
      { DB: database },
    );
    expect(stale.status).toBe(409);

    // Explicit zero fen is a valid rule value, never treated as missing.
    const zero = await appFor(owner([])).request(
      `${ORIGIN}/api/staff/seller-service-fees`,
      saveBody({ review_type: 'RATING', fee_cny_fen: '0', expected_version: 0 }),
      { DB: database },
    );
    expect(zero.status).toBe(200);

    // Removed approval endpoints really 404.
    const confirmGone = await appFor(owner([])).request(
      `${ORIGIN}/api/staff/seller-service-fees/some-id/confirm`,
      { method: 'POST', headers: jsonHeaders(), body: '{"expected_version":1}' },
      { DB: database },
    );
    expect(confirmGone.status).toBe(404);
  });

  it('keeps saved rules immutable and organization-scoped reads concealed', async () => {
    database = fixture();
    const db = database;
    const scoped = appFor(
      actor('seller_ops', 'seller-ops', ['SELLER_MANAGE']),
      marketplaceScopeWith(['seller-org-1']),
    );
    const foreign = await scoped.request(
      `${ORIGIN}/api/staff/seller-service-fees?seller_organization_id=seller-org-2`,
      {},
      { DB: database },
    );
    expect(foreign.status).toBe(404);

    database.exec(`
      INSERT INTO seller_service_fee_rule_versions (
        id, seller_organization_id, marketplace_code, review_type, version_no,
        fee_amount_minor, fee_currency_code, fee_currency_exponent,
        effective_from, created_by_staff_id, created_at
      ) VALUES (
        'fee-rule-seed', 'seller-org-1', 'AMAZON_JP', 'TEXT', 1,
        6000, 'CNY', 2, 1, 'staff-owner', 1
      )
    `);
    expect(() => db.exec(`
      UPDATE seller_service_fee_rule_versions SET fee_amount_minor=1
      WHERE id='fee-rule-seed'
    `)).toThrow(/immutable/u);
    expect(() => db.exec(`
      DELETE FROM seller_service_fee_rule_versions WHERE id='fee-rule-seed'
    `)).toThrow(/immutable/u);
  });
});

function appFor(actorValue: AssignmentStaffAuthorization, scope: StaffDataScope = globalScope()) {
  const app = createApp();
  app.use('/api/staff/*', async (context, next) => {
    context.set('staffAuthorization', actorValue);
    context.set('staffDataScope', scope);
    await next();
  });
  registerSellerServiceFeeRoutes(app);
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

function marketplaceScopeWith(organizationIds: string[]): StaffDataScope {
  return {
    type: 'MARKETPLACE',
    marketplaceCodes: ['AMAZON_JP'],
    buyerCustomerIds: [],
    sellerOrganizationIds: organizationIds,
    teamIds: [],
  };
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

function saveBody(body: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `service-fee-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      seller_organization_id: 'seller-org-1',
      ...body,
    }),
  };
}

function fixture(): SqliteDatabase {
  const db = createMigratedTestDatabase();
  db.exec(`
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
    VALUES ('staff-owner','Owner','ACTIVE',1,1,1,1,NULL),
      ('seller-ops','卖家对接','ACTIVE',1,1,1,1,NULL),
      ('pre-sales','售前','ACTIVE',1,1,1,1,NULL);
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status, version, created_at,
      updated_at, activated_at, disabled_at, next_member_number
    ) VALUES
      ('seller-org-1','AMAZON_JP','ido-mango-000001','seller-channel-ido-mango',
        'seller-channel-ido-mango',1,'测试卖家一','ACTIVE',1,1,1,1,NULL,2),
      ('seller-org-2','AMAZON_JP','ido-mango-000002','seller-channel-ido-mango',
        'seller-channel-ido-mango',2,'测试卖家二','ACTIVE',1,1,1,1,NULL,2);
  `);
  return db;
}
