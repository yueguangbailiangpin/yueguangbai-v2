import { afterEach, describe, expect, it } from 'vitest';
import type { StaffDataScope, StaffPermissionCode, StaffRoleCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp } from '../app';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import { resolveStaffDataScope } from '../staff-assignment/data-scope';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { registerSellerServiceFeeRoutes } from './seller-service-fee-routes';

const ORIGIN = 'https://api.local.test';
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('staff seller service fee routes', () => {
  it('keeps read and submit owner/assignment gated and supports submit then owner confirm', async () => {
    database = fixture();
    const ownerActor = auth('owner', 'fee-owner', ['SELLER_MANAGE', 'FINANCIAL_CORRECT']);
    const owner = appFor(ownerActor, await resolveStaffDataScope(database, ownerActor));

    // A staff member without SELLER_MANAGE cannot even read the fee matrix.
    const refundActor = auth('buyer_refund', 'fee-refund', []);
    const refund = appFor(refundActor, await resolveStaffDataScope(database, refundActor));
    const refundRead = await refund.request(
      `${ORIGIN}/api/staff/seller-service-fees?seller_organization_id=seller-org-1`,
      {},
      { DB: database },
    );
    expect(refundRead.status).toBe(403);

    // Owner reads the empty matrix first: four review types, nothing set.
    const initialRead = await owner.request(
      `${ORIGIN}/api/staff/seller-service-fees?seller_organization_id=seller-org-1`,
      {},
      { DB: database },
    );
    expect(initialRead.status).toBe(200);
    expect(await initialRead.json()).toMatchObject({
      data: {
        seller_organization_id: 'seller-org-1',
        fees: [
          { review_type: 'RATING', effective_fee: null, pending_fee: null, upcoming_fee: null, next_version: 1 },
          { review_type: 'TEXT', effective_fee: null, pending_fee: null, upcoming_fee: null, next_version: 1 },
          { review_type: 'IMAGE', effective_fee: null, pending_fee: null, upcoming_fee: null, next_version: 1 },
          { review_type: 'VIDEO', effective_fee: null, pending_fee: null, upcoming_fee: null, next_version: 1 },
        ],
      },
    });

    // Unassigned seller_ops cannot submit for the organization.
    const opsActor = auth('seller_ops', 'fee-ops', ['SELLER_MANAGE']);
    const unassigned = appFor(opsActor, assignedScope('seller-org-1'));
    const deniedSubmit = await unassigned.request(
      `${ORIGIN}/api/staff/seller-service-fees/submit`,
      submitRequest({ seller_organization_id: 'seller-org-1' }),
      { DB: database },
    );
    expect(deniedSubmit.status).toBe(403);

    // Once assigned as the canonical account manager, submit succeeds.
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
    const opsAssigned = appFor(opsActor, assignedScope('seller-org-1'));
    const submitted = await opsAssigned.request(
      `${ORIGIN}/api/staff/seller-service-fees/submit`,
      submitRequest({ seller_organization_id: 'seller-org-1' }),
      { DB: database },
    );
    expect(submitted.status).toBe(200);
    const submittedJson = (await submitted.json()) as {
      data: { fee: { fee_version_id: string; status: string } };
    };
    expect(submittedJson.data.fee.status).toBe('SUBMITTED');

    // seller_ops cannot confirm; only Owner plus financial correction can.
    const opsConfirm = await opsAssigned.request(
      `${ORIGIN}/api/staff/seller-service-fees/${submittedJson.data.fee.fee_version_id}/confirm`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `fee-confirm-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ expected_version: 1 }),
      },
      { DB: database },
    );
    expect(opsConfirm.status).toBe(403);

    const confirmed = await owner.request(
      `${ORIGIN}/api/staff/seller-service-fees/${submittedJson.data.fee.fee_version_id}/confirm`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `fee-confirm-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ expected_version: 1 }),
      },
      { DB: database },
    );
    expect(confirmed.status).toBe(200);

    // The confirmed fee is effective (effective_from in the past relative to
    // read time is not required here: it was submitted as now+60s, so the
    // read still shows no effective fee but no pending fee either).
    const finalRead = await owner.request(
      `${ORIGIN}/api/staff/seller-service-fees?seller_organization_id=seller-org-1`,
      {},
      { DB: database },
    );
    expect(finalRead.status).toBe(200);
    expect(await finalRead.json()).toMatchObject({
      data: {
        fees: expect.arrayContaining([
          {
            review_type: 'RATING',
            effective_fee: null,
            pending_fee: null,
            upcoming_fee: expect.anything(),
            next_version: 2,
          },
        ]),
      },
    });
  });
});

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

function assignedScope(...sellerOrganizationIds: string[]): StaffDataScope {
  return {
    type: 'MARKETPLACE',
    marketplaceCodes: ['AMAZON_JP'],
    buyerCustomerIds: [],
    sellerOrganizationIds,
    teamIds: [],
  };
}

function submitRequest(overrides: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `fee-submit-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      review_type: 'RATING',
      fee_cny_fen: '1250',
      effective_from: Date.now() + 60_000,
      expected_version: 0,
      ...overrides,
    }),
  };
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
    VALUES ('seller-org-1', 'JP', 'fee-seller-000001', 'seller-channel-ido-mango', 'seller-channel-ido-mango',
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
