import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { createApp } from '../app';
import { decideReservation } from '../reservations/decide-reservation';
import type { ReservationStaffActor } from '../reservations/reservation-shared';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { registerBuyerPortalRoutes } from './routes';

const ORIGIN = 'https://portal.local.test';
const SESSION_SECRET =
  'phase4b1-test-session-secret-with-at-least-thirty-two-bytes';
const SESSION_COOKIE = '__Host-ygb_customer_session';

let database: SqliteDatabase | null = null;
let fixtureNow = 0;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Phase 4B1 buyer portal HTTP API', () => {
  it(
    'requires active buyer session and rejects wrong session types',
    async () => {
      database = createMigratedTestDatabase();
      fixtureNow = Date.now();
      seedPortalFixture(database, fixtureNow);
      const app = testApp();

      const anonymous = await request(app, '/api/buyer-portal/me');
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get('cache-control')).toBe('no-store');
      await expect(json(anonymous)).resolves.toMatchObject({
        error: { code: 'UNAUTHENTICATED' },
        meta: { request_id: expect.any(String) },
      });

      const seller = await request(app, '/api/buyer-portal/me', {
        headers: {
          Cookie: await sessionCookie({
            accountId: 'seller-account-1',
            identitySubjectId: 'seller-subject-1',
            accountType: 'SELLER_MEMBER',
          }),
        },
      });
      expect(seller.status).toBe(403);
      await expect(json(seller)).resolves.toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      database.exec(`
        UPDATE customer_login_accounts
        SET password_change_required=1
        WHERE id='buyer-account-1';
      `);
      const forced = await request(app, '/api/buyer-portal/me', {
        headers: {
          Cookie: await buyerCookie('1'),
        },
      });
      expect(forced.status).toBe(403);
      await expect(json(forced)).resolves.toMatchObject({
        error: { code: 'PASSWORD_CHANGE_REQUIRED' },
      });
    },
  );

  it(
    'invalidates sessions after account or customer deactivation',
    async () => {
      database = createMigratedTestDatabase();
      fixtureNow = Date.now();
      seedPortalFixture(database, fixtureNow);
      const app = testApp();

      const buyerAccountCookie = await buyerCookie('1');
      database.exec(`
        UPDATE customer_login_accounts
        SET status='DISABLED', disabled_at=${fixtureNow},
            updated_at=${fixtureNow}
        WHERE id='buyer-account-1';
      `);
      expect((await request(app, '/api/buyer-portal/me', {
        headers: { Cookie: buyerAccountCookie },
      })).status).toBe(401);

      database.exec(`
        UPDATE customer_login_accounts
        SET status='ACTIVE', disabled_at=NULL,
            updated_at=${fixtureNow + 1}
        WHERE id='buyer-account-1';
      `);
      const buyerCookieBeforeDisable = await buyerCookie('1');
      database.exec(`
        UPDATE buyer_customers
        SET access_status='DISABLED', disabled_at=${fixtureNow + 2},
            updated_at=${fixtureNow + 2}
        WHERE id='buyer-1';
      `);
      expect((await request(app, '/api/buyer-portal/me', {
        headers: { Cookie: buyerCookieBeforeDisable },
      })).status).toBe(401);

      const sellerCookie = await sessionCookie({
        accountId: 'seller-account-1',
        identitySubjectId: 'seller-subject-1',
        accountType: 'SELLER_MEMBER',
      });
      database.exec(`
        UPDATE seller_organization_members
        SET status='DISABLED', disabled_at=${fixtureNow + 3},
            updated_at=${fixtureNow + 3}
        WHERE id='seller-member-1';
      `);
      expect((await request(app, '/api/buyer-portal/me', {
        headers: { Cookie: sellerCookie },
      })).status).toBe(401);

      database.exec(`
        UPDATE seller_organization_members
        SET status='ACTIVE', disabled_at=NULL,
            updated_at=${fixtureNow + 4}
        WHERE id='seller-member-1';
      `);
      const sellerCookieBeforeOrgDisable = await sessionCookie({
        accountId: 'seller-account-1',
        identitySubjectId: 'seller-subject-1',
        accountType: 'SELLER_MEMBER',
      });
      database.exec(`
        UPDATE seller_organizations
        SET status='DISABLED', disabled_at=${fixtureNow + 5},
            updated_at=${fixtureNow + 5}
        WHERE id='seller-org-1';
      `);
      expect((await request(app, '/api/buyer-portal/me', {
        headers: { Cookie: sellerCookieBeforeOrgDisable },
      })).status).toBe(401);
    },
  );

  it(
    'returns safe demand projection and stable bounded pages',
    async () => {
      database = createMigratedTestDatabase();
      fixtureNow = Date.now();
      seedPortalFixture(database, fixtureNow);
      const app = testApp();
      const cookie = await buyerCookie('1');

      const me = await request(app, '/api/buyer-portal/me', {
        headers: { Cookie: cookie },
      });
      expect(me.status).toBe(200);
      await expect(json(me)).resolves.toMatchObject({
        data: {
          buyer: {
            display_name: '买家一',
            marketplace_code: 'AMAZON_JP',
            identity_review_status: 'CLEAR',
          },
        },
      });

      const firstPage = await request(
        app,
        '/api/buyer-portal/demands?limit=1',
        { headers: { Cookie: cookie } },
      );
      expect(firstPage.status).toBe(200);
      expect(firstPage.headers.get('cache-control')).toBe('no-store');
      const firstBody = await json<any>(firstPage);
      expect(firstBody.data.items).toHaveLength(1);
      expect(firstBody.data.items[0]).toMatchObject({
        demand_id: 'demand-projection',
        product_name: '门户产品一',
        main_image: {
          file_object_id: 'portal-main-image-object',
          file_version: 3,
          purpose: 'PRODUCT_IMAGE',
          visibility: 'SELLER_VISIBLE',
        },
        task_type: 'IMAGE',
        target_quantity: 3,
        remaining_quantity: 1,
      });
      expect(firstBody.data.next_cursor).toEqual(expect.any(String));

      const secondPage = await request(
        app,
        '/api/buyer-portal/demands?limit=1&cursor='
          + encodeURIComponent(firstBody.data.next_cursor),
        { headers: { Cookie: cookie } },
      );
      expect(secondPage.status).toBe(200);
      const secondBody = await json<any>(secondPage);
      expect(secondBody.data.items[0].demand_id).toBe('demand-final');

      const detail = await request(
        app,
        '/api/buyer-portal/demands/demand-projection',
        { headers: { Cookie: cookie } },
      );
      expect(detail.status).toBe(200);
      const detailText = JSON.stringify(await json(detail));
      expect(detailText).toContain('portal-main-image-object');
      for (const forbidden of [
        'asin',
        'product_url',
        'search_keywords',
        'search_keywords_json',
        'seller_notes',
        'internal_notes',
        'held_reservation_count',
        'approved_reservation_count',
        'staff-pre-sales',
        'seller-org-1',
        'buyer_customer_id',
        'audit',
        'object_key',
        'files/v1/',
      ]) {
        expect(detailText).not.toContain(forbidden);
      }

      const tooLarge = await request(
        app,
        '/api/buyer-portal/demands?limit=101',
        { headers: { Cookie: cookie } },
      );
      expect(tooLarge.status).toBe(400);
      await expect(json(tooLarge)).resolves.toMatchObject({
        error: { code: 'VALIDATION_ERROR' },
      });

      database.exec(`
        UPDATE buyer_customers
        SET identity_review_status='REVIEW_REQUIRED',
            updated_at=${fixtureNow + 10}
        WHERE id='buyer-3';
      `);
      const reviewRequired = await request(
        app,
        '/api/buyer-portal/demands',
        { headers: { Cookie: await buyerCookie('3') } },
      );
      expect(reviewRequired.status).toBe(409);
      await expect(json(reviewRequired)).resolves.toMatchObject({
        error: { code: 'IDENTITY_REVIEW_REQUIRED' },
      });
    },
  );

  it('does not list or disclose a demand whose capacity is full', async () => {
    database = createMigratedTestDatabase();
    fixtureNow = Date.now();
    seedPortalFixture(database, fixtureNow);
    const app = testApp();
    const cookie = await buyerCookie('1');

    database.exec(`
      UPDATE demand_batches
      SET held_reservation_count=target_quantity
      WHERE id='demand-final';
    `);

    const list = await request(app, '/api/buyer-portal/demands', {
      headers: { Cookie: cookie },
    });
    expect(list.status).toBe(200);
    expect((await json<any>(list)).data.items.map((item: { demand_id: string }) => item.demand_id))
      .not.toContain('demand-final');
    expect((await request(app, '/api/buyer-portal/demands/demand-final', {
      headers: { Cookie: cookie },
    })).status).toBe(404);
  });

  it('does not list or disclose a demand after that Buyer has any reservation history', async () => {
    database = createMigratedTestDatabase();
    fixtureNow = Date.now();
    seedPortalFixture(database, fixtureNow);
    const app = testApp();
    const cookie = await buyerCookie('1');
    const reservation = await createReservation(
      app, cookie, 'demand-projection', 'portal-eligibility-history',
    );
    const cancelled = await cancelViaApi(
      app, cookie, reservation.data.reservation.reservation_id, 1,
      'portal-eligibility-history-cancel',
    );
    expect(cancelled.status).toBe(200);

    const list = await request(app, '/api/buyer-portal/demands', {
      headers: { Cookie: cookie },
    });
    expect((await json<any>(list)).data.items.map((item: { demand_id: string }) => item.demand_id))
      .not.toContain('demand-projection');
    expect((await request(app, '/api/buyer-portal/demands/demand-projection', {
      headers: { Cookie: cookie },
    })).status).toBe(404);
  });

  for (const decision of ['PENDING_REVIEW', 'APPROVED'] as const) {
    it(`lists another same-store demand as ineligible with a ${decision} reservation`, async () => {
      database = createMigratedTestDatabase();
      fixtureNow = Date.now();
      seedPortalFixture(database, fixtureNow);
      const app = testApp();
      const cookie = await buyerCookie('1');
      database.exec(`
        UPDATE demand_batches
        SET product_id='product-1', product_version_no=1
        WHERE id='demand-final';
      `);
      const reservation = await createReservation(
        app, cookie, 'demand-projection', `portal-eligibility-${decision}`,
      );
      if (decision === 'APPROVED') {
        await decideReservation(database, {
          reservationId: reservation.data.reservation.reservation_id,
          expectedVersion: 1,
          decision: 'APPROVE',
        }, {
          actor: staffActor(), idempotencyKey: 'portal-eligibility-approve',
          now: fixtureNow + 1000,
        });
      }

      const list = await request(app, '/api/buyer-portal/demands', {
        headers: { Cookie: cookie },
      });
      expect((await json<any>(list)).data.items).toContainEqual(expect.objectContaining({
        demand_id: 'demand-final',
        reservation_eligibility: 'INELIGIBLE_ACTIVE_STORE_RESERVATION',
        reservation_ineligibility_reason: 'ACTIVE_STORE_RESERVATION',
      }));
      const detail = await request(app, '/api/buyer-portal/demands/demand-final', {
        headers: { Cookie: cookie },
      });
      expect(detail.status).toBe(200);
      await expect(json(detail)).resolves.toMatchObject({
        data: {
          demand: {
            reservation_eligibility: 'INELIGIBLE_ACTIVE_STORE_RESERVATION',
            reservation_ineligibility_reason: 'ACTIVE_STORE_RESERVATION',
          },
        },
      });
    });
  }

  it(
    'submits through the original atomic reservation command and rechecks stale capacity',
    async () => {
      database = createMigratedTestDatabase();
      fixtureNow = Date.now();
      seedPortalFixture(database, fixtureNow);
      const app = testApp();
      const buyerOne = await buyerCookie('1');
      const buyerTwo = await buyerCookie('2');

      const buyerTwoSawFinalSlot = await request(
        app,
        '/api/buyer-portal/demands/demand-final',
        { headers: { Cookie: buyerTwo } },
      );
      expect(buyerTwoSawFinalSlot.status).toBe(200);

      const missingOrigin = await request(
        app,
        '/api/buyer-portal/demands/demand-final/reservations',
        {
          method: 'POST',
          headers: {
            Cookie: buyerOne,
            'Idempotency-Key': 'portal-submit-no-origin',
          },
        },
      );
      expect(missingOrigin.status).toBe(403);

      const attemptedBuyerOverride = await request(
        app,
        '/api/buyer-portal/demands/demand-final/reservations',
        {
          method: 'POST',
          headers: {
            ...stateHeaders(),
            Cookie: buyerOne,
            'Idempotency-Key': 'portal-submit-buyer-override',
          },
          body: JSON.stringify({ buyer_id: 'buyer-2' }),
        },
      );
      expect(attemptedBuyerOverride.status).toBe(400);

      const created = await request(
        app,
        '/api/buyer-portal/demands/demand-final/reservations',
        {
          method: 'POST',
          headers: {
            ...stateHeaders(),
            Cookie: buyerOne,
            'Idempotency-Key': 'portal-submit-final-slot',
          },
          body: reservationAcceptanceBody(),
        },
      );
      expect(created.status).toBe(201);
      expect(created.headers.get('cache-control')).toBe('no-store');
      const createdBody = await json<any>(created);
      expect(createdBody.data).toMatchObject({
        replayed: false,
        reservation: {
          status: 'PENDING_REVIEW',
          version: 1,
          can_cancel: true,
          demand: {
            demand_id: 'demand-final',
          },
        },
      });
      const reservationId = createdBody.data.reservation.reservation_id;
      const serialized = JSON.stringify(createdBody);
      for (const forbidden of [
        'buyer-1',
        'buyer_customer_id',
        'seller-org-1',
        'precheck_snapshot_json',
        'decided_by_staff_id',
        'asin',
        'product_url',
        'search_keywords',
        'search_keywords_json',
        'asin',
        'product_url',
        'search_keywords',
        'search_keywords_json',
        'seller_notes',
        'internal_notes',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }

      const replay = await request(
        app,
        '/api/buyer-portal/demands/demand-final/reservations',
        {
          method: 'POST',
          headers: {
            ...stateHeaders(),
            Cookie: buyerOne,
            'Idempotency-Key': 'portal-submit-final-slot',
          },
          body: reservationAcceptanceBody(),
        },
      );
      expect(replay.status).toBe(200);
      await expect(json(replay)).resolves.toMatchObject({
        data: {
          replayed: true,
          reservation: { reservation_id: reservationId },
        },
      });

      const duplicateSource = await request(
        app,
        '/api/buyer-portal/demands/demand-pending/reservations',
        {
          method: 'POST',
          headers: {
            ...stateHeaders(),
            Cookie: buyerOne,
            'Idempotency-Key': 'portal-submit-duplicate-source',
          },
          body: reservationAcceptanceBody(),
        },
      );
      expect(duplicateSource.status).toBe(409);
      await expect(json(duplicateSource)).resolves.toMatchObject({
        error: { code: 'BUYER_STORE_RESERVATION_CONFLICT' },
      });

      const duplicate = await request(
        app,
        '/api/buyer-portal/demands/demand-pending/reservations',
        {
          method: 'POST',
          headers: {
            ...stateHeaders(),
            Cookie: buyerOne,
            'Idempotency-Key': 'portal-submit-duplicate-again',
          },
          body: reservationAcceptanceBody(3),
        },
      );
      expect(duplicate.status).toBe(409);
      await expect(json(duplicate)).resolves.toMatchObject({
        error: { code: 'BUYER_STORE_RESERVATION_CONFLICT' },
      });

      const finalSlotLost = await request(
        app,
        '/api/buyer-portal/demands/demand-final/reservations',
        {
          method: 'POST',
          headers: {
            ...stateHeaders(),
            Cookie: buyerTwo,
            'Idempotency-Key': 'portal-submit-final-second-buyer',
          },
          body: reservationAcceptanceBody(3),
        },
      );
      expect(finalSlotLost.status).toBe(409);
      await expect(json(finalSlotLost)).resolves.toMatchObject({
        error: { code: 'CAPACITY_FULL' },
      });
      expect(await demandCounts(database, 'demand-final'))
        .toEqual({ held: 1, approved: 0 });

      const otherBuyerRead = await request(
        app,
        `/api/buyer-portal/reservations/${reservationId}`,
        { headers: { Cookie: buyerTwo } },
      );
      expect(otherBuyerRead.status).toBe(404);
      await expect(json(otherBuyerRead)).resolves.toMatchObject({
        error: { code: 'NOT_FOUND' },
      });
    },
  );

  it(
    'lists own reservations and cancels with expectedVersion',
    async () => {
      database = createMigratedTestDatabase();
      fixtureNow = Date.now();
      seedPortalFixture(database, fixtureNow);
      const app = testApp();
      const cookie = await buyerCookie('1');

      const pending = await createReservation(
        app,
        cookie,
        'demand-pending',
        'portal-cancel-pending-submit',
      );
      const pendingId = pending.data.reservation.reservation_id as string;

      const missingCancelOrigin = await request(
        app,
        `/api/buyer-portal/reservations/${pendingId}/cancel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'Idempotency-Key': 'portal-cancel-no-origin',
          },
          body: JSON.stringify({ expected_version: 1 }),
        },
      );
      expect(missingCancelOrigin.status).toBe(403);

      const otherBuyerCancel = await cancelViaApi(
        app,
        await buyerCookie('2'),
        pendingId,
        1,
        'portal-cancel-other-buyer',
      );
      expect(otherBuyerCancel.status).toBe(404);
      await expect(json(otherBuyerCancel)).resolves.toMatchObject({
        error: { code: 'NOT_FOUND' },
      });

      const wrongVersion = await cancelViaApi(
        app,
        cookie,
        pendingId,
        99,
        'portal-cancel-pending-wrong-version',
      );
      expect(wrongVersion.status).toBe(409);
      await expect(json(wrongVersion)).resolves.toMatchObject({
        error: { code: 'VERSION_CONFLICT' },
      });

      const pendingCancelled = await cancelViaApi(
        app,
        cookie,
        pendingId,
        1,
        'portal-cancel-pending',
      );
      expect(pendingCancelled.status).toBe(200);
      await expect(json(pendingCancelled)).resolves.toMatchObject({
        data: {
          replayed: false,
          reservation: {
            status: 'CANCELLED',
            version: 2,
            can_cancel: false,
          },
        },
      });
      expect(await demandCounts(database, 'demand-pending'))
        .toEqual({ held: 0, approved: 0 });

      const approved = await createReservation(
        app,
        cookie,
        'demand-approved',
        'portal-cancel-approved-submit',
      );
      const approvedId = approved.data.reservation.reservation_id as string;
      await decideReservation(database, {
        reservationId: approvedId,
        expectedVersion: 1,
        decision: 'APPROVE',
      }, {
        actor: staffActor(),
        idempotencyKey: 'portal-cancel-approved-decision',
        now: fixtureNow + 1000,
      });
      expect(await demandCounts(database, 'demand-approved'))
        .toEqual({ held: 0, approved: 1 });

      const approvedCancelled = await cancelViaApi(
        app,
        cookie,
        approvedId,
        2,
        'portal-cancel-approved',
      );
      expect(approvedCancelled.status).toBe(200);
      await expect(json(approvedCancelled)).resolves.toMatchObject({
        data: {
          reservation: {
            status: 'CANCELLED',
            version: 3,
          },
        },
      });
      expect(await demandCounts(database, 'demand-approved'))
        .toEqual({ held: 0, approved: 0 });

      const cancelReplay = await cancelViaApi(
        app,
        cookie,
        approvedId,
        2,
        'portal-cancel-approved',
      );
      expect(cancelReplay.status).toBe(200);
      await expect(json(cancelReplay)).resolves.toMatchObject({
        data: { replayed: true },
      });

      const otherBuyer = await createReservation(
        app,
        await buyerCookie('2'),
        'demand-final',
        'portal-list-other-buyer',
      );
      const otherBuyerReservationId =
        otherBuyer.data.reservation.reservation_id as string;

      const list = await request(
        app,
        '/api/buyer-portal/reservations?limit=1',
        { headers: { Cookie: cookie } },
      );
      expect(list.status).toBe(200);
      const listBody = await json<any>(list);
      expect(listBody.data.items).toHaveLength(1);
      expect(listBody.data.next_cursor).toEqual(expect.any(String));
      expect(JSON.stringify(listBody)).not.toContain('buyer_customer_id');

      const fullList = await request(
        app,
        '/api/buyer-portal/reservations?limit=100',
        { headers: { Cookie: cookie } },
      );
      const fullListBody = await json<any>(fullList);
      expect(fullListBody.data.items).toHaveLength(2);
      expect(JSON.stringify(fullListBody))
        .not.toContain(otherBuyerReservationId);
    },
  );

  it('saves and re-reads the buyer refund account through the me projection', async () => {
    database = createMigratedTestDatabase();
    fixtureNow = Date.now();
    seedPortalFixture(database, fixtureNow);
    const app = testApp();
    const cookie = await buyerCookie('1');

    const before = await request(app, '/api/buyer-portal/me', {
      headers: { Cookie: cookie },
    });
    expect(before.status).toBe(200);
    await expect(json(before)).resolves.toMatchObject({
      data: {
        buyer: {
          refund_account_name: null,
          refund_account_identifier: null,
        },
      },
    });

    const missingOrigin = await request(
      app,
      '/api/buyer-portal/me/refund-account',
      {
        method: 'PATCH',
        headers: {
          ...stateHeaders(),
          Cookie: cookie,
          Origin: 'https://evil.example.test',
        },
        body: JSON.stringify({
          account_name: '买家一',
          account_identifier: 'buyer@example.test',
        }),
      },
    );
    expect(missingOrigin.status).toBe(403);

    const invalid = await request(
      app,
      '/api/buyer-portal/me/refund-account',
      {
        method: 'PATCH',
        headers: { ...stateHeaders(), Cookie: cookie },
        body: JSON.stringify({ account_name: '买家一' }),
      },
    );
    expect(invalid.status).toBe(400);
    await expect(json(invalid)).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });

    const saved = await request(
      app,
      '/api/buyer-portal/me/refund-account',
      {
        method: 'PATCH',
        headers: { ...stateHeaders(), Cookie: cookie },
        body: JSON.stringify({
          account_name: ' 买家一 ',
          account_identifier: 'buyer@example.test',
        }),
      },
    );
    expect(saved.status).toBe(200);
    await expect(json(saved)).resolves.toMatchObject({
      data: {
        buyer: {
          refund_account_name: '买家一',
          refund_account_identifier: 'buyer@example.test',
        },
      },
    });

    // 幂等重放：同值重复提交结果一致；响应与库里一致。
    const replay = await request(
      app,
      '/api/buyer-portal/me/refund-account',
      {
        method: 'PATCH',
        headers: { ...stateHeaders(), Cookie: cookie },
        body: JSON.stringify({
          account_name: '买家一',
          account_identifier: 'buyer@example.test',
        }),
      },
    );
    expect(replay.status).toBe(200);
    await expect(json(replay)).resolves.toMatchObject({
      data: {
        buyer: { refund_account_name: '买家一' },
      },
    });

    const stored = await database.prepare(`
      SELECT refund_account_name, refund_account_identifier
      FROM buyer_customers WHERE id='buyer-1'
    `).first<{ refund_account_name: string; refund_account_identifier: string }>();
    expect(stored).toEqual({
      refund_account_name: '买家一',
      refund_account_identifier: 'buyer@example.test',
    });
  });

  it('applies the stage 3 clean baseline 0001-0019', async () => {
    database = createMigratedTestDatabase();
    const repositoryRoot = path.resolve(
      import.meta.dirname,
      '../../../..',
    );
    const migrations = readdirSync(
      path.join(repositoryRoot, 'migrations'),
    )
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(35);
    expect(migrations[0]).toMatch(/^0001_/u);
    expect(migrations.at(-1)).toBe('0035_stage75r_settlement_batch_cancel_fix.sql');

    const state = await database.prepare(`
      SELECT schema_version
      FROM app_schema_state
      WHERE singleton_id=1
    `).first<{ schema_version: number }>();
    expect(Number(state?.schema_version)).toBe(35);
  });
});

function testApp() {
  const app = createApp();
  registerBuyerPortalRoutes(app);
  return app;
}

function seedPortalFixture(
  target: SqliteDatabase,
  now: number,
): void {
  const openAt = now - 60_000;
  const reservationDeadlineBase = now + 60 * 60 * 1000;
  const orderDeadlineBase = now + 2 * 60 * 60 * 1000;

  target.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'staff-pre-sales', '售前', 'ACTIVE', 1,
      1, 1000, 1000, NULL
    );
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, created_at, updated_at
    ) VALUES ('staff-pre-sales','pre_sales','ACTIVE',NULL,1000,NULL,1000,1000);
    INSERT INTO staff_marketplace_scopes (
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES ('scope-buyer-portal-pre-jp','staff-pre-sales','pre_sales',
      'AMAZON_JP','ACTIVE','zz-phase3h-test-owner',1000,NULL,
      'TEST_PRIMARY',1000,1000,'PRIMARY');

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-1', 'AMAZON_JP', 'ido-mango-9901',
      'seller-channel-ido-mango',
      'seller-channel-ido-mango',
      9901, '门户卖家', 'ACTIVE',
      1, 1000, 1000, 1000, NULL, 2
    );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('seller-subject-1', 'SELLER_ORG_MEMBER', 1000),
      ('buyer-subject-1', 'BUYER_CUSTOMER', 1000),
      ('buyer-subject-2', 'BUYER_CUSTOMER', 1000),
      ('buyer-subject-3', 'BUYER_CUSTOMER', 1000);

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'seller-member-1', 'seller-subject-1',
      'seller-org-1', 1, 'ido-mango-9901-001',
      '负责人', 'OWNER', 1, 'ACTIVE', 1,
      1000, 1000, 1000, NULL
    );

    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code,
      buyer_channel_id, buyer_customer_no,
      buyer_sequence,
      display_name, access_status,
      identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      (
        'buyer-1', 'buyer-subject-1', 'AMAZON_JP',
        'buyer-channel-wechat-b', '19700101B0001', 1,
        '买家一', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'buyer-2', 'buyer-subject-2', 'AMAZON_JP',
        'buyer-channel-wechat-b', '19700101B0002', 2,
        '买家二', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'buyer-3', 'buyer-subject-3', 'AMAZON_JP',
        'buyer-channel-wechat-b', '19700101B0003', 3,
        '买家三', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      );

    INSERT INTO customer_login_accounts (
      id, identity_subject_id, account_type,
      login_identifier_display, login_identifier_normalized,
      status, session_version, password_change_required,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES
      (
        'buyer-account-1', 'buyer-subject-1', 'BUYER',
        'buyer_portal_1', 'buyer_portal_1',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL
      ),
      (
        'buyer-account-2', 'buyer-subject-2', 'BUYER',
        'buyer_portal_2', 'buyer_portal_2',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL
      ),
      (
        'buyer-account-3', 'buyer-subject-3', 'BUYER',
        'buyer_portal_3', 'buyer_portal_3',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL
      ),
      (
        'seller-account-1', 'seller-subject-1', 'SELLER_MEMBER',
        'seller_portal_1', 'seller_portal_1',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL
      );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-1', 'seller-org-1', 'AMAZON_JP',
      '门户店铺', '门户店铺', 'ACTIVE',
      1, 1000, 1000, NULL
    );

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('product-1', 'seller-org-1', 'store-1', 'AMAZON_JP',
       'B0PORTAL01', 'B0PORTAL01', 'ACTIVE', 1, 1,
       1000, 1000, NULL),
      ('product-2', 'seller-org-1', 'store-1', 'AMAZON_JP',
       'B0PORTAL02', 'B0PORTAL02', 'ACTIVE', 1, 1,
       1000, 1000, NULL),
      ('product-3', 'seller-org-1', 'store-1', 'AMAZON_JP',
       'B0PORTAL03', 'B0PORTAL03', 'ACTIVE', 1, 1,
       1000, 1000, NULL),
      ('product-4', 'seller-org-1', 'store-1', 'AMAZON_JP',
       'B0PORTAL04', 'B0PORTAL04', 'ACTIVE', 1, 1,
       1000, 1000, NULL);

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode,
          default_buyer_self_pay_bps) VALUES
      ('product-1-v1', 'product-1', 1, '门户产品一',
       '["关键词一"]', 'https://www.amazon.co.jp/portal-one',
       '产品公开说明一', '产品内部说明一', 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT', 0),
      ('product-2-v1', 'product-2', 1, '门户产品二',
       '["关键词二"]', 'https://www.amazon.co.jp/portal-two',
       '产品公开说明二', '产品内部说明二', 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT', 0),
      ('product-3-v1', 'product-3', 1, '门户产品三',
       '["关键词三"]', 'https://www.amazon.co.jp/portal-three',
       '产品公开说明三', '产品内部说明三', 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT', 0),
      ('product-4-v1', 'product-4', 1, '门户产品四',
       '["关键词四"]', 'https://www.amazon.co.jp/portal-four',
       '产品公开说明四', '产品内部说明四', 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT', 0);

    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code,
      product_id, product_version_no,
      submitted_by_member_id, task_type,
      target_quantity, buyer_visible_notes,
      seller_notes, open_at,
      reservation_deadline, order_deadline,
      status, review_reason, close_reason,
      reviewed_by_staff_id, closed_by_staff_id,
      version, submitted_at, updated_at,
      reviewed_at, published_at,
      withdrawn_at, closed_at,
      held_reservation_count,
      approved_reservation_count,
      buyer_self_pay_bps_snapshot,
      buyer_self_pay_source,
      buyer_self_pay_override_reason
    ) VALUES
      (
        'demand-projection', 'seller-org-1', 'store-1', 'AMAZON_JP',
        'product-1', 1, 'seller-member-1', 'IMAGE',
        3, '需求公开说明一', '需求内部说明一',
        ${openAt}, ${reservationDeadlineBase}, ${orderDeadlineBase},
        'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
        2, 1000, 1000, 1000, 1000, NULL, NULL, 1, 1,
        0, 'PRODUCT_DEFAULT', NULL
      ),
      (
        'demand-final', 'seller-org-1', 'store-1', 'AMAZON_JP',
        'product-2', 1, 'seller-member-1', 'TEXT',
        1, '需求公开说明二', '需求内部说明二',
        ${openAt}, ${reservationDeadlineBase + 1000},
        ${orderDeadlineBase + 1000},
        'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
        2, 1100, 1100, 1100, 1100, NULL, NULL, 0, 0,
        0, 'PRODUCT_DEFAULT', NULL
      ),
      (
        'demand-pending', 'seller-org-1', 'store-1', 'AMAZON_JP',
        'product-3', 1, 'seller-member-1', 'RATING',
        2, '需求公开说明三', '需求内部说明三',
        ${openAt}, ${reservationDeadlineBase + 2000},
        ${orderDeadlineBase + 2000},
        'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
        2, 1200, 1200, 1200, 1200, NULL, NULL, 0, 0,
        0, 'PRODUCT_DEFAULT', NULL
      ),
      (
        'demand-approved', 'seller-org-1', 'store-1', 'AMAZON_JP',
        'product-4', 1, 'seller-member-1', 'VIDEO',
        2, '需求公开说明四', '需求内部说明四',
        ${openAt}, ${reservationDeadlineBase + 3000},
        ${orderDeadlineBase + 3000},
        'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
        2, 1300, 1300, 1300, 1300, NULL, NULL, 0, 0,
        0, 'PRODUCT_DEFAULT', NULL
      );
  `);
  database!.exec(`
    INSERT INTO buyer_staff_assignments (
      id, buyer_customer_id, duty_code, staff_id, status, source,
      assigned_by_actor_type, assigned_by_actor_id, reason, version,
      created_at, updated_at, revoked_at
    )
    SELECT 'buyer-pre-binding-'||id, id, 'BUYER_PRE_SALES_OWNER',
      'staff-pre-sales', 'ACTIVE', 'AUTO_INITIAL',
      'STAFF', 'zz-phase3h-test-owner', NULL, 1, 1000, 1000, NULL
    FROM buyer_customers;
`);

  seedPortalMainImage(target);
}

function seedPortalMainImage(target: SqliteDatabase): void {
  target.exec(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility,
      status, requested_file_count, manifest_hash, version, expires_at,
      failure_code, created_at, updated_at, completed_at
    ) VALUES (
      'portal-main-image-intent', 'STAFF', 'staff-pre-sales',
      'PRODUCT_IMAGE', 'SELLER_VISIBLE', 'ISSUED', 1,
      '${'a'.repeat(64)}', 1, 30000, NULL, 1000, 1000, NULL
    );
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size,
      status, upload_token_hash, upload_expires_at, uploaded_byte_size,
      detected_mime, uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at, uploaded_at,
      verified_at, deleted_at
    ) VALUES (
      'portal-main-image-object', 'portal-main-image-intent', 1,
      'PRODUCT_IMAGE', 'SELLER_VISIBLE',
      'files/v1/2026/08/portalmainimageobjectkeyxxxxxxxxxxxxxxxx',
      'portal-main.png', 'png', 'image/png', 4, 'RESERVED',
      '${'b'.repeat(64)}', 30000, NULL, NULL, NULL,
      NULL, 0, NULL, 3, 1000, 1000, NULL, NULL, NULL
    );
    UPDATE file_upload_intents
    SET status='VERIFIED', updated_at=1001, completed_at=1001
    WHERE id='portal-main-image-intent';
    UPDATE file_objects
    SET status='VERIFIED', uploaded_byte_size=4, detected_mime='image/png',
        uploaded_sha256='${'c'.repeat(64)}', updated_at=1001,
        uploaded_at=1001, verified_at=1001
    WHERE id='portal-main-image-object';
    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (
      'portal-main-image-link', 'portal-main-image-object',
      'PRODUCT_VERSION', 'product-1-v1', 'PRODUCT_IMAGE',
      'SELLER_VISIBLE', 'STAFF', 'staff-pre-sales', 1002,
      'EXPLICIT_AUDIENCES', NULL, NULL
    );
    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type, buyer_customer_id,
      seller_organization_id, staff_permission_code, staff_scope_type,
      staff_team_id, granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES
      ('portal-main-image-seller-grant', 'portal-main-image-link',
       'SELLER_ORGANIZATION', NULL, 'seller-org-1', NULL, NULL, NULL,
       'STAFF', 'staff-pre-sales', 1002, NULL, NULL),
      ('portal-main-image-staff-grant', 'portal-main-image-link',
       'STAFF_INTERNAL', NULL, NULL, 'PRODUCT_VIEW', 'GLOBAL', NULL,
       'STAFF', 'staff-pre-sales', 1002, NULL, NULL);
    INSERT INTO product_version_main_images (
      product_version_id, file_entity_link_id,
      created_by_staff_id, created_at
    ) VALUES (
      'product-1-v1', 'portal-main-image-link', 'staff-pre-sales', 1002
    );
  `);
}

async function buyerCookie(number: '1' | '2' | '3'): Promise<string> {
  return sessionCookie({
    accountId: `buyer-account-${number}`,
    identitySubjectId: `buyer-subject-${number}`,
    accountType: 'BUYER',
  });
}

async function sessionCookie(input: {
  accountId: string;
  identitySubjectId: string;
  accountType: 'BUYER' | 'SELLER_MEMBER';
}): Promise<string> {
  const token = await issueCustomerSession({
    accountId: input.accountId,
    identitySubjectId: input.identitySubjectId,
    accountType: input.accountType,
    sessionVersion: 1,
    passwordChangeRequired: false,
  }, SESSION_SECRET, {
    now: Date.now(),
    ttlMs: 60 * 60 * 1000,
  });
  return `${SESSION_COOKIE}=${token}`;
}

function stateHeaders(
  jsonBody = true,
): Record<string, string> {
  return {
    ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
  };
}

async function createReservation(
  app: ReturnType<typeof testApp>,
  cookie: string,
  demandId: string,
  idempotencyKey: string,
): Promise<any> {
  const response = await request(
    app,
    `/api/buyer-portal/demands/${demandId}/reservations`,
    {
      method: 'POST',
      headers: {
        ...stateHeaders(),
        Cookie: cookie,
        'Idempotency-Key': idempotencyKey,
      },
      body: reservationAcceptanceBody(),
    },
  );
  expect(response.status).toBe(201);
  return json<any>(response);
}

function reservationAcceptanceBody(expectedDemandVersion = 2): string {
  return JSON.stringify({
    expected_demand_version: expectedDemandVersion,
    accepted_buyer_self_pay_bps: 0,
  });
}

async function cancelViaApi(
  app: ReturnType<typeof testApp>,
  cookie: string,
  reservationId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<Response> {
  return request(
    app,
    `/api/buyer-portal/reservations/${reservationId}/cancel`,
    {
      method: 'POST',
      headers: {
        ...stateHeaders(),
        Cookie: cookie,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        expected_version: expectedVersion,
      }),
    },
  );
}

function staffActor(): ReservationStaffActor {
  return {
    staffId: 'staff-pre-sales',
    displayName: '售前',
    roles: ['pre_sales'] as readonly StaffRoleCode[],
    permissions: new Set<StaffPermissionCode>([
      'RESERVATION_DECIDE',
    ]),
  };
}

async function demandCounts(
  target: SqliteDatabase,
  demandId: string,
): Promise<{ held: number; approved: number }> {
  const row = await target.prepare(`
    SELECT
      held_reservation_count,
      approved_reservation_count
    FROM demand_batches
    WHERE id=?
  `).bind(demandId).first<{
    held_reservation_count: number;
    approved_reservation_count: number;
  }>();
  if (!row) throw new Error('missing_demand');
  return {
    held: Number(row.held_reservation_count),
    approved: Number(row.approved_reservation_count),
  };
}

async function request(
  app: ReturnType<typeof testApp>,
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!database) throw new Error('test_database_missing');
  return app.request(
    `${ORIGIN}${pathname}`,
    init,
    {
      DB: database,
      CUSTOMER_SESSION_SECRET: SESSION_SECRET,
    } as any,
  );
}

async function json<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  return response.json() as Promise<T>;
}
