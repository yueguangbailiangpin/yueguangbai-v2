import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { StaffPermissionCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { hashOneTimeToken } from '@ygb/domain';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { registerCreateBuyerCustomerRoutes } from './create-buyer-route';
import { registerStaffCustomerSecurityRoutes } from '../customer-security/routes';
import { registerInvitedBuyer } from '../customer-security/invited-registration';

const ORIGIN = 'https://api.example.test';
const TOKEN_SECRET = 'stage66e-route-test-secret-32-bytes!!';
const PASSWORD = 'Strong-Password-2026!';
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('stage 6.6E staff buyer creation and invitation binding (HTTP)', () => {
  it('creates a B-channel buyer at HTTP level with an immediate number and pre-sales owner', async () => {
    const ctx = setup();
    const first = await createBuyer(ctx, 'buyer-b-0001', 'wx_route_b_01');
    expect(first.status).toBe(201);
    const body = (await first.json()) as any;
    expect(body.data.buyer_customer).toMatchObject({
      access_status: 'DISABLED',
      activated: false,
      buyer_number: expect.stringMatching(/^\d{8}B\d+$/u),
      initial_pre_sales_owner: {
        staff_id: 'staff-66e-pre-sales',
        staff_display_name: '售前甲',
      },
    });
    // The buyer cannot log in yet: no login account exists.
    expect(await database!.prepare(`
      SELECT COUNT(*) AS c FROM customer_login_accounts
    `).first()).toEqual({ c: 0 });

    // C channel numbers advance independently.
    const cBuyer = await createBuyer(ctx, 'buyer-c-0001', 'wx_route_c_01', 'buyer-channel-wechat-c');
    const cBody = (await cBuyer.json()) as any;
    expect(cBody.data.buyer_customer.buyer_number).toMatch(/^\d{8}C\d+$/u);

    // Idempotent replay returns the same buyer and the same number.
    const replay = await createBuyer(ctx, 'buyer-b-0001', 'wx_route_b_01');
    expect(replay.status).toBe(201);
    const replayBody = (await replay.json()) as any;
    expect(replayBody.data.buyer_customer.buyer_customer_id)
      .toBe(body.data.buyer_customer.buyer_customer_id);
    expect(replayBody.data.buyer_customer.buyer_number)
      .toBe(body.data.buyer_customer.buyer_number);
    expect(replayBody.data.replayed).toBe(true);
  });

  it('rejects duplicate WeChat, other-marketplace writes and non-authorized staff', async () => {
    const ctx = setup();
    await createBuyer(ctx, 'buyer-dup-0001', 'wx_route_dup_01');
    const duplicate = await createBuyer(ctx, 'buyer-dup-0002', 'wx_route_dup_01');
    expect(duplicate.status).toBe(409);

    const forbiddenApp = appWith(authorization('seller_ops'));
    const sellerOps = await forbiddenApp.request(`${ORIGIN}/api/staff/buyer-customers`, {
      method: 'POST',
      headers: jsonHeaders('create-buyer-forbidden'),
      body: JSON.stringify({
        display_name: 'buyer-forbidden',
        wechat_id: 'wx_route_forbidden',
        buyer_channel_id: 'buyer-channel-wechat-b',
        marketplace_code: 'AMAZON_JP',
      }),
    }, ctx.env);
    expect(sellerOps.status).toBe(403);
    expect(await database!.prepare(`
      SELECT COUNT(*) AS c FROM buyer_customers
      WHERE display_name='buyer-forbidden'
    `).first()).toEqual({ c: 0 });
  });

  it('binds the invitation to the existing buyer and registration only claims and activates it', async () => {
    const ctx = setup();
    const created = (await (await createBuyer(ctx, 'buyer-inv-0001', 'wx_route_inv_01')).json()) as any;
    const buyerId = created.data.buyer_customer.buyer_customer_id;
    const buyerNumber = created.data.buyer_customer.buyer_number;

    const issued = await ctx.app.request(
      `${ORIGIN}/api/staff/customer-security/buyer-invitations`,
      {
        method: 'POST',
        headers: jsonHeaders('invite-66e-0001'),
        body: JSON.stringify({
          buyer_customer_id: buyerId,
          wechat_id: 'wx_route_inv_01',
          marketplace_code: 'AMAZON_JP',
        }),
      },
      ctx.env,
    );
    expect(issued.status).toBe(201);
    const invitation = ((await issued.json()) as any).data.invitation;
    expect(invitation.buyer_customer_id).toBe(buyerId);
    expect(invitation.buyer_customer_no).toBe(buyerNumber);

    const registered = await registerInvitedBuyer(database!, {
      invitationToken: invitation.registration_token,
      wechatId: 'wx_route_inv_01',
      marketplaceCode: 'AMAZON_JP',
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
    }, {
      idempotencyKey: 'register-66e-0000000001',
      requestId: 'request-register-66e',
      sessionId: crypto.randomUUID(),
      sessionExpiresAt: Date.now() + 60_000,
      networkSourceHash: 'a'.repeat(64), deviceHash: 'b'.repeat(64),
      now: Date.now(),
    });
    // The number is exactly the number allocated at staff creation.
    expect(registered.buyerNumber).toBe(buyerNumber);
    expect(registered.replayed).toBe(false);
    const row = await database!.prepare(`
      SELECT access_status, buyer_customer_no FROM buyer_customers WHERE id=?
    `).bind(buyerId).first();
    expect(row).toEqual({ access_status: 'ACTIVE', buyer_customer_no: buyerNumber });
    expect(await database!.prepare(`
      SELECT COUNT(*) AS c FROM buyer_customers
    `).first()).toEqual({ c: 1 });

    // A second invitation cannot be issued for an already-activated buyer.
    const secondIssue = await ctx.app.request(
      `${ORIGIN}/api/staff/customer-security/buyer-invitations`,
      {
        method: 'POST',
        headers: jsonHeaders('invite-66e-0002'),
        body: JSON.stringify({
          buyer_customer_id: buyerId,
          wechat_id: 'wx_route_inv_01',
          marketplace_code: 'AMAZON_JP',
        }),
      },
      ctx.env,
    );
    expect(secondIssue.status).toBe(409);
  });

  it('fails closed for binding mismatches and legacy unbound invitations', async () => {
    const ctx = setup();
    const created = (await (await createBuyer(ctx, 'buyer-mm-00001', 'wx_route_mm_01')).json()) as any;
    const buyerId = created.data.buyer_customer.buyer_customer_id;

    // WeChat mismatch and marketplace mismatch are both rejected before write.
    const wechatMismatch = await ctx.app.request(
      `${ORIGIN}/api/staff/customer-security/buyer-invitations`,
      {
        method: 'POST',
        headers: jsonHeaders('invite-mm-wx-0001'),
        body: JSON.stringify({
          buyer_customer_id: buyerId,
          wechat_id: 'wx_route_other_9',
          marketplace_code: 'AMAZON_JP',
        }),
      },
      ctx.env,
    );
    expect(wechatMismatch.status).toBe(409);
    const marketMismatch = await ctx.app.request(
      `${ORIGIN}/api/staff/customer-security/buyer-invitations`,
      {
        method: 'POST',
        headers: jsonHeaders('invite-mm-mkt-001'),
        body: JSON.stringify({
          buyer_customer_id: buyerId,
          wechat_id: 'wx_route_mm_01',
          marketplace_code: 'AMAZON_US',
        }),
      },
      ctx.env,
    );
    expect(marketMismatch.status).toBe(409);
    expect(await database!.prepare(`
      SELECT COUNT(*) AS c FROM customer_buyer_invitations
    `).first()).toEqual({ c: 0 });

    // A legacy unbound invitation (pre-0030 row) must fail closed instead of
    // creating a second profile.
    const legacyToken = 'LegacyUnmappedToken012345678901234567890123';
    await database!.prepare(`
      INSERT INTO customer_buyer_invitations (
        id, token_hash, wechat_display, normalized_wechat, wechat_hash,
        marketplace_code, issued_by_staff_id, status, version,
        issued_at, expires_at, consumed_at, consumed_by_account_id,
        revoked_at, revoked_by_staff_id, created_at, updated_at,
        buyer_customer_id
      ) VALUES ('invitation-legacy-66e', ?,
        'wx_route_legacy', 'wx_route_legacy', '${'1'.repeat(64)}',
        'AMAZON_JP', 'staff-66e-pre-sales', 'ACTIVE', 1,
        1000, 1000+604800000, NULL, NULL, NULL, NULL, 1000, 1000, NULL);
    `).bind(await hashOneTimeToken(legacyToken)).run();
    await expect(registerInvitedBuyer(database!, {
      invitationToken: legacyToken,
      wechatId: 'wx_route_legacy',
      marketplaceCode: 'AMAZON_JP',
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
    }, {
      idempotencyKey: 'register-legacy-00000001',
      requestId: 'request-register-legacy',
      sessionId: crypto.randomUUID(),
      sessionExpiresAt: Date.now() + 60_000,
      networkSourceHash: 'a'.repeat(64), deviceHash: 'b'.repeat(64),
      now: Date.now(),
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    // Fail closed: still only the single staff-created profile exists.
    expect(await database!.prepare(`
      SELECT COUNT(*) AS c FROM buyer_customers
    `).first()).toEqual({ c: 1 });
  });

  it('keeps numbering intact and skips no sequence when the create transaction fails', async () => {
    const ctx = setup();
    const created = (await (await createBuyer(ctx, 'buyer-tx-00001', 'wx_route_tx_01')).json()) as any;
    const number = created.data.buyer_customer.buyer_number as string;
    const sequence = Number(number.slice(9));
    // A failed creation (duplicate WeChat) must not consume or skip a number.
    await createBuyer(ctx, 'buyer-tx-00002', 'wx_route_tx_01');
    const next = await createBuyer(ctx, 'buyer-tx-00003', 'wx_route_tx_02');
    const nextBody = (await next.json()) as any;
    expect(Number(nextBody.data.buyer_customer.buyer_number.slice(9)))
      .toBe(sequence + 1);
  });
});

interface TestContext {
  app: Hono<any>;
  actor: AssignmentStaffAuthorization;
  env: Record<string, unknown>;
}

function appWith(actor: AssignmentStaffAuthorization): Hono<any> {
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', `stage66e-${crypto.randomUUID()}`);
    context.set('staffAuthorization', actor);
    await next();
  });
  registerCreateBuyerCustomerRoutes(app);
  registerStaffCustomerSecurityRoutes(app);
  return app;
}

function setup(): TestContext {
  database = createMigratedTestDatabase();
  database.exec(`
    UPDATE buyer_channels SET next_sequence=2001
    WHERE id IN ('buyer-channel-wechat-b','buyer-channel-wechat-c');
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at, session_version
    ) VALUES ('staff-66e-pre-sales', '售前甲', 'ACTIVE', 1, 1,
      1000, 1000, NULL, 1);
    INSERT INTO staff_role_assignments (
      id, staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('role-66e-pre-sales-001', 'staff-66e-pre-sales', 'pre_sales',
      'ACTIVE', NULL, 1000, NULL, 1000, 1000);
    INSERT INTO staff_marketplace_scopes (
      id, staff_id, role_code, marketplace_code, status,
      assigned_by_staff_id, assigned_at, revoked_at, reason,
      created_at, updated_at, scope_kind
    ) VALUES ('scope-66e-pre-sales-jp', 'staff-66e-pre-sales', 'pre_sales',
      'AMAZON_JP', 'ACTIVE', NULL, 1000, NULL, 'TEST_PRIMARY',
      1000, 1000, 'PRIMARY');
  `);
  const actor = authorization('pre_sales');
  const app = appWith(actor);
  return {
    app,
    actor,
    env: {
      DB: database,
      CUSTOMER_SECURITY_TOKEN_SECRET: TOKEN_SECRET,
    },
  };
}

async function createBuyer(
  ctx: TestContext,
  displayName: string,
  wechatId: string,
  channelId = 'buyer-channel-wechat-b',
): Promise<Response> {
  return ctx.app.request(`${ORIGIN}/api/staff/buyer-customers`, {
    method: 'POST',
    headers: {
      ...jsonHeaders(`create-${displayName}`),
    },
    body: JSON.stringify({
      display_name: displayName,
      wechat_id: wechatId,
      buyer_channel_id: channelId,
      marketplace_code: 'AMAZON_JP',
    }),
  }, ctx.env);
}

function jsonHeaders(key: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    'Idempotency-Key': key,
  };
}

function authorization(
  role: 'pre_sales' | 'seller_ops' | 'owner',
): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]),
    grants: new Set<StaffPermissionCode>(),
    denies: new Set<StaffPermissionCode>(),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId: 'staff-66e-pre-sales',
    displayName: '售前甲',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: effective.roles,
    permissions: effective.permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}
