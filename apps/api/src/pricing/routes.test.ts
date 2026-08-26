import { afterEach, describe, expect, it } from 'vitest';
import type { StaffDataScope, StaffPermissionCode, StaffRoleCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp } from '../app';
import { resolveStaffDataScope, type AssignmentStaffAuthorization } from '../staff-assignment';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import { registerSellerPrincipalRatePolicyRoutes } from './routes';

const ORIGIN = 'https://api.local.test';
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('seller principal rate policy HTTP boundary', () => {
  it('returns policy facts and all errors with no-store', async () => {
    database = fixture();
    const app = appFor(
      auth('seller_ops', 'staff-pricing-ops', ['SELLER_MANAGE']),
      assignedScope('seller-org-1'),
    );
    const read = await app.request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies?source_currency_code=JPY&seller_organization_id=seller-org-1`,
      {},
      { DB: database },
    );
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(await read.json()).toMatchObject({
      data: {
        policies: {
          source_currency_code: 'JPY',
          default_policy: null,
          seller_override_policy: null,
        },
      },
    });

    const invalid = await app.request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies?source_currency_code=CNY&seller_organization_id=seller-org-1`,
      {},
      { DB: database },
    );
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('cache-control')).toBe('no-store');
    expect(await invalid.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const crossOrganization = await app.request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies?source_currency_code=JPY&seller_organization_id=seller-org-2`,
      {},
      { DB: database },
    );
    expect(crossOrganization.status).toBe(404);
    expect(crossOrganization.headers.get('cache-control')).toBe('no-store');
  });

  it('enforces assigned writes, blocks local global writes, and allows owner global writes', async () => {
    database = fixture();
    const before = await countPolicyFacts();
    const localDefaultRead = await appFor(
      auth('seller_ops', 'staff-pricing-ops', ['SELLER_MANAGE']),
      assignedScope('seller-org-1'),
    ).request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies?source_currency_code=JPY`,
      {},
      { DB: database },
    );
    expect(localDefaultRead.status).toBe(403);
    expect(localDefaultRead.headers.get('cache-control')).toBe('no-store');
    expect(await countPolicyFacts()).toEqual(before);

    const crossWrite = await appFor(
      auth('seller_ops', 'staff-pricing-ops', ['SELLER_MANAGE']),
      assignedScope('seller-org-1'),
    ).request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies/save`,
      saveRequest({ scope_type: 'SELLER_ORGANIZATION', seller_organization_id: 'seller-org-2' }),
      { DB: database },
    );
    expect(crossWrite.status).toBe(403);
    expect(await crossWrite.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await countPolicyFacts()).toEqual(before);

    const localDefault = await appFor(
      auth('seller_ops', 'staff-pricing-ops', ['SELLER_MANAGE']),
      assignedScope('seller-org-1'),
    ).request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies/save`,
      saveRequest({ scope_type: 'CURRENCY_PAIR_DEFAULT', seller_organization_id: null }),
      { DB: database },
    );
    expect(localDefault.status).toBe(403);
    expect(await localDefault.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await countPolicyFacts()).toEqual(before);

    const ownerActor = auth('owner', 'staff-pricing-owner', ['SELLER_MANAGE', 'FINANCIAL_CORRECT']);
    const owner = appFor(ownerActor, await resolveStaffDataScope(database, ownerActor));
    const ownerDefaultRead = await owner.request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies?source_currency_code=JPY`,
      {},
      { DB: database },
    );
    expect(ownerDefaultRead.status).toBe(200);
    expect(ownerDefaultRead.headers.get('cache-control')).toBe('no-store');
    expect(await ownerDefaultRead.json()).toMatchObject({
      data: {
        policies: {
          seller_organization_id: null,
          default_policy: null,
          seller_override_policy: null,
          default_next_version: 1,
          seller_override_next_version: null,
        },
      },
    });
    const ownerSubmit = await owner.request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies/save`,
      saveRequest({ scope_type: 'CURRENCY_PAIR_DEFAULT', seller_organization_id: null }),
      { DB: database },
    );
    expect(ownerSubmit.status).toBe(200);
    expect(ownerSubmit.headers.get('cache-control')).toBe('no-store');

    const unknown = await owner.request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies?source_currency_code=JPY&seller_organization_id=does-not-exist`,
      {},
      { DB: database },
    );
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('cache-control')).toBe('no-store');
    expect(await unknown.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('lets a scoped seller_ops save an organization override without an account-manager assignment (equal rights)', async () => {
    database = fixture();
    const saved = await appFor(
      auth('seller_ops', 'staff-pricing-ops', ['SELLER_MANAGE']),
      assignedScope('seller-org-1'),
    ).request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies/save`,
      saveRequest({ scope_type: 'SELLER_ORGANIZATION', seller_organization_id: 'seller-org-1' }),
      { DB: database },
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      data: {
        policy: { scope_type: 'SELLER_ORGANIZATION', seller_organization_id: 'seller-org-1' },
      },
    });

    // Removed approval endpoints really 404.
    const confirmGone = await appFor(
      auth('owner', 'staff-pricing-owner', []),
      globalScope(),
    ).request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies/some-id/confirm`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"expected_version":1}' },
      { DB: database },
    );
    expect(confirmGone.status).toBe(404);
  });

  it('rejects Personal DENY before any policy write and keeps no-store', async () => {
    database = fixture();
    const denied = await appFor(
      auth('seller_ops', 'staff-refund', ['SELLER_MANAGE'], ['SELLER_MANAGE']),
      assignedScope('seller-org-1'),
    ).request(
      `${ORIGIN}/api/staff/seller-principal-rate-policies/save`,
      saveRequest({ scope_type: 'SELLER_ORGANIZATION', seller_organization_id: 'seller-org-1' }),
      { DB: database },
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get('cache-control')).toBe('no-store');
    expect(await denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await countPolicyFacts()).toEqual({ versions: 0, events: 0, idempotency: 0 });
  });
});

function globalScope(): StaffDataScope {
  return {
    type: 'GLOBAL',
    marketplaceCodes: [],
    buyerCustomerIds: [],
    sellerOrganizationIds: [],
    teamIds: [],
  };
}

function appFor(actor: AssignmentStaffAuthorization, scope: StaffDataScope) {
  const app = createApp();
  app.use('/api/staff/*', async (context, next) => {
    context.set('staffAuthorization', actor);
    context.set('staffDataScope', scope);
    await next();
  });
  registerSellerPrincipalRatePolicyRoutes(app);
  return app;
}

function auth(
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

function assignedScope(...sellerOrganizationIds: string[]): StaffDataScope {
  return {
    type: 'ASSIGNED_SELLER_ORGANIZATIONS',
    buyerCustomerIds: [],
    sellerOrganizationIds,
    teamIds: [],
    marketplaceCodes: ['AMAZON_JP'],
  };
}

function saveRequest(overrides: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `route-test-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      scope_type: 'SELLER_ORGANIZATION',
      seller_organization_id: 'seller-org-1',
      source_currency_code: 'JPY',
      markup_rate_value: '0.004',
      expected_version: 0,
      ...overrides,
    }),
  };
}

async function countPolicyFacts(): Promise<{
  versions: number;
  events: number;
  idempotency: number;
}> {
  const row = await database!
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM seller_principal_rate_policy_versions) AS versions,
      (SELECT COUNT(*) FROM seller_principal_rate_policy_events) AS events,
      (SELECT COUNT(*) FROM command_idempotency_records
        WHERE action LIKE 'SUBMIT_SELLER_PRINCIPAL_RATE_POLICY%') AS idempotency
  `,
    )
    .first<{ versions: number; events: number; idempotency: number }>();
  return row!;
}

function fixture(): SqliteDatabase {
  const db = createMigratedTestDatabase();
  db.exec(`
    INSERT INTO staff_users (id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at)
    VALUES ('staff-pricing-ops', '卖家对接', 'ACTIVE', 1, 1, 1, 1, NULL),
      ('staff-pricing-owner', 'Owner', 'ACTIVE', 1, 1, 1, 1, NULL),
      ('staff-refund', '买家返款', 'ACTIVE', 1, 1, 1, 1, NULL);
    INSERT INTO seller_organizations (id, marketplace_code, seller_code, origin_channel_id,
      current_channel_id, seller_sequence, organization_name, status, version, created_at,
      updated_at, activated_at, disabled_at, next_member_number)
    VALUES ('seller-org-1', 'AMAZON_JP', 'pricing-seller-000001', 'seller-channel-ido-mango', 'seller-channel-ido-mango',
      1, '测试卖家', 'ACTIVE', 1, 1, 1, 1, NULL, 2);
    INSERT INTO staff_role_assignments(
      id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,
      revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at
    ) VALUES (
      'role-pricing-ops','staff-pricing-ops','seller_ops','ACTIVE',NULL,1,
      NULL,NULL,NULL,1,1
    );
    INSERT INTO staff_marketplace_scopes(
      id,staff_id,role_code,marketplace_code,status,scope_kind,assigned_by_staff_id,
      assigned_at,revoked_at,reason,created_at,updated_at
    ) VALUES (
      'scope-pricing-ops','staff-pricing-ops','seller_ops','AMAZON_JP','ACTIVE','PRIMARY',NULL,
      1,NULL,'fixture',1,1
    );
  `);
  return db;
}
