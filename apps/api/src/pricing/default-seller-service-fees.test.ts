import { afterEach, describe, expect, it } from 'vitest';
import type { StaffDataScope, StaffPermissionCode, StaffRoleCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp } from '../app';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import { resolveStaffDataScope } from '../staff-assignment/data-scope';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { applyDefaultSellerServiceFees } from './default-seller-service-fees';
import { registerSellerServiceFeeRoutes } from './seller-service-fee-routes';
import { resolveSellerServiceFee } from './seller-service-fees';

const ORIGIN = 'https://api.local.test';
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('default seller service fees', () => {
  it('apply-defaults fills only unconfigured types, auto-confirms them, and is repeatable', async () => {
    database = fixture();
    const ownerActor = auth('owner', 'fee-owner', ['SELLER_MANAGE', 'FINANCIAL_CORRECT']);
    const owner = appFor(ownerActor, ownerScope());

    // TEXT already has a staff-submitted version waiting for a decision: the
    // backfill must leave it alone and fill the other three types.
    database.exec(`
      INSERT INTO seller_service_fee_versions (
        id, organization_id, review_type, version_no, status, fee_cny_fen,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES (
        'fee-text-pending', 'seller-org-1', 'TEXT', 1, 'SUBMITTED', 9000,
        ${Date.now() + 60_000}, 'fee-owner', 1, 1,
        NULL, NULL, NULL, NULL, NULL
      );
    `);

    const applied = await owner.request(
      `${ORIGIN}/api/staff/seller-service-fees/apply-defaults`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `apply-defaults-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ seller_organization_id: 'seller-org-1' }),
      },
      { DB: database },
    );
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({
      data: {
        applied: ['RATING', 'IMAGE', 'VIDEO'],
        fees: [
          {
            review_type: 'RATING',
            // Seeded defaults become effective one minute after seeding, so
            // the immediate re-read shows them as upcoming, not yet effective.
            effective_fee: null,
            upcoming_fee: { fee_cny_fen: '3500' },
            pending_fee: null,
            next_version: 2,
          },
          { review_type: 'TEXT', effective_fee: null, pending_fee: { fee_cny_fen: '9000' }, next_version: 2 },
          {
            review_type: 'IMAGE',
            effective_fee: null,
            upcoming_fee: { fee_cny_fen: '7000' },
            pending_fee: null,
            next_version: 2,
          },
          {
            review_type: 'VIDEO',
            effective_fee: null,
            upcoming_fee: { fee_cny_fen: '8500' },
            pending_fee: null,
            next_version: 2,
          },
        ],
      },
    });

    // The seeded version is resolvable for any order time and carries both
    // events plus audit trail rows.
    await expect(
      resolveSellerServiceFee(database, {
        sellerOrganizationId: 'seller-org-1',
        reviewType: 'RATING',
        at: Date.now() + 120_000,
      }),
    ).resolves.toMatchObject({ fee_cny_fen: '3500' });
    const events = database.raw
      .prepare(`SELECT event_type, COUNT(*) AS n FROM seller_service_fee_events GROUP BY event_type`)
      .all() as unknown as { event_type: string; n: number }[];
    expect(events).toEqual(
      expect.arrayContaining([
        { event_type: 'SELLER_SERVICE_FEE_SUBMITTED', n: 3 },
        { event_type: 'SELLER_SERVICE_FEE_CONFIRMED', n: 3 },
      ]),
    );

    // A second call is a no-op for the now-configured types.
    const second = await applyDefaultSellerServiceFees(
      database,
      { sellerOrganizationId: 'seller-org-1' },
      {
        actor: pricingActor('owner', 'fee-owner'),
        idempotencyKey: `apply-defaults-${crypto.randomUUID()}`,
        now: Date.now(),
      },
    );
    expect(second.applied).toEqual([]);
  });

  it('keeps apply-defaults gated behind SELLER_MANAGE and the account-manager assignment', async () => {
    database = fixture();
    const refundActor = auth('buyer_refund', 'fee-refund', []);
    const refund = appFor(refundActor, await resolveStaffDataScope(database!, refundActor));
    const denied = await refund.request(
      `${ORIGIN}/api/staff/seller-service-fees/apply-defaults`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `apply-defaults-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ seller_organization_id: 'seller-org-1' }),
      },
      { DB: database },
    );
    expect(denied.status).toBe(403);

    const opsActor = auth('seller_ops', 'fee-ops', ['SELLER_MANAGE']);
    const unassigned = appFor(opsActor, marketplaceScope());
    const unassignedResponse = await unassigned.request(
      `${ORIGIN}/api/staff/seller-service-fees/apply-defaults`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `apply-defaults-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ seller_organization_id: 'seller-org-1' }),
      },
      { DB: database },
    );
    expect(unassignedResponse.status).toBe(404);

    // Assigned as the canonical account manager, seller_ops may backfill.
    database.exec(`
      INSERT INTO seller_staff_assignments(
        id,seller_organization_id,duty_code,staff_id,status,source,
        assigned_by_actor_type,assigned_by_actor_id,reason,version,
        created_at,updated_at,revoked_at
      ) VALUES (
        'assignment-fee-ops','seller-org-1','SELLER_ACCOUNT_MANAGER','fee-ops',
        'ACTIVE','MANUAL_REASSIGN','SYSTEM','fixture',NULL,1,1,1,NULL
      );
    `);
    const assigned = appFor(opsActor, assignedScope());
    const allowed = await assigned.request(
      `${ORIGIN}/api/staff/seller-service-fees/apply-defaults`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `apply-defaults-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ seller_organization_id: 'seller-org-1' }),
      },
      { DB: database },
    );
    expect(allowed.status).toBe(200);
  });
});

function pricingActor(role: StaffRoleCode, staffId: string) {
  return {
    staffId,
    displayName: staffId,
    roles: [role] as StaffRoleCode[],
  };
}

function auth(
  role: StaffRoleCode,
  staffId: string,
  grants: StaffPermissionCode[],
): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]),
    grants: new Set(grants),
    denies: new Set(),
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

function ownerScope(): StaffDataScope {
  return { type: 'GLOBAL' } as StaffDataScope;
}

function assignedScope(): StaffDataScope {
  return {
    type: 'MARKETPLACE',
    marketplaceCodes: ['AMAZON_JP'],
    buyerCustomerIds: [],
    sellerOrganizationIds: ['seller-org-1'],
    teamIds: [],
  };
}

function marketplaceScope(): StaffDataScope {
  return {
    type: 'MARKETPLACE',
    marketplaceCodes: ['AMAZON_JP'],
    buyerCustomerIds: [],
    sellerOrganizationIds: [],
    teamIds: [],
  };
}

function appFor(actorValue: AssignmentStaffAuthorization, scope: StaffDataScope) {
  const app = createApp();
  app.use('/api/staff/*', async (context, next) => {
    context.set('staffAuthorization', actorValue);
    context.set('staffDataScope', scope);
    await next();
  });
  registerSellerServiceFeeRoutes(app);
  return app;
}

function fixture(): SqliteDatabase {
  const db = createMigratedTestDatabase();
  db.exec(`
    INSERT INTO staff_users (id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at)
    VALUES ('fee-owner', 'Owner', 'ACTIVE', 1, 1, 1, 1, NULL),
      ('fee-ops', '卖家对接', 'ACTIVE', 1, 1, 1, 1, NULL),
      ('fee-refund', '买家返款', 'ACTIVE', 1, 1, 1, 1, NULL);
    INSERT INTO seller_organizations (id, marketplace_code, seller_code, origin_channel_id,
      current_channel_id, seller_sequence, organization_name, status, version, created_at,
      updated_at, activated_at, disabled_at, next_member_number)
    VALUES ('seller-org-1', 'AMAZON_JP', 'fee-seller-000001', 'seller-channel-ido-mango', 'seller-channel-ido-mango',
      1, '测试卖家', 'ACTIVE', 1, 1, 1, 1, NULL, 2);
    INSERT INTO staff_role_assignments(
      id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,
      revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at
    ) VALUES (
      'role-fee-ops-default-01','fee-ops','seller_ops','ACTIVE',NULL,1,
      NULL,NULL,NULL,1,1
    );
    INSERT INTO staff_marketplace_scopes(
      id,staff_id,role_code,marketplace_code,status,scope_kind,assigned_by_staff_id,
      assigned_at,revoked_at,reason,created_at,updated_at
    ) VALUES (
      'scope-fee-ops-primary-01','fee-ops','seller_ops','AMAZON_JP','ACTIVE','PRIMARY',NULL,
      1,NULL,'fixture',1,1
    );
  `);
  return db;
}
