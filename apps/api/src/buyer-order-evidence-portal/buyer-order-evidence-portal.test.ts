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
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { createApp } from '../app';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import {
  type StaffOrderEvidenceActor,
} from '../order-evidence/order-evidence-shared';
import {
  requestOrderEvidenceChanges,
  verifyOrderEvidence,
} from '../order-evidence/review-order-evidence';
import { seedPhase3GInstructionFixture } from '../../test-support/phase3g-test-fixtures';
import { registerBuyerOrderEvidencePortalRoutes } from './routes';

const ORIGIN = 'https://portal.local.test';
const SESSION_SECRET =
  'phase4b2-test-session-secret-with-at-least-thirty-two-bytes';
const SESSION_COOKIE = '__Host-ygb_customer_session';

let database: SqliteDatabase | null = null;
let fixtureNow = 0;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Phase 4B2 buyer order evidence HTTP API', () => {
  it(
    'requires a valid buyer session and rejects inactive account trees',
    async () => {
      await setup();
      const app = testApp();

      const anonymous = await request(
        app,
        '/api/buyer-portal/order-evidence/eligible-reservations',
      );
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get('cache-control')).toBe('no-store');
      await expect(json(anonymous)).resolves.toMatchObject({
        error: { code: 'UNAUTHENTICATED' },
        meta: { request_id: expect.any(String) },
      });

      const seller = await request(
        app,
        '/api/buyer-portal/order-evidence',
        { headers: { Cookie: await sellerCookie() } },
      );
      expect(seller.status).toBe(403);
      await expect(json(seller)).resolves.toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      database!.exec(`
        UPDATE customer_login_accounts
        SET password_change_required=1
        WHERE id='buyer-account-1';
      `);
      const forced = await request(
        app,
        '/api/buyer-portal/order-evidence',
        { headers: { Cookie: await buyerCookie('1') } },
      );
      expect(forced.status).toBe(403);
      await expect(json(forced)).resolves.toMatchObject({
        error: { code: 'PASSWORD_CHANGE_REQUIRED' },
      });

      database!.exec(`
        UPDATE customer_login_accounts
        SET password_change_required=0, status='DISABLED',
            disabled_at=${fixtureNow}, updated_at=${fixtureNow}
        WHERE id='buyer-account-1';
      `);
      const disabledAccount = await request(
        app,
        '/api/buyer-portal/order-evidence',
        { headers: { Cookie: await buyerCookie('1') } },
      );
      expect(disabledAccount.status).toBe(401);

      database!.exec(`
        UPDATE customer_login_accounts
        SET status='ACTIVE', disabled_at=NULL,
            updated_at=${fixtureNow + 1}
        WHERE id='buyer-account-1';
        UPDATE seller_organization_members
        SET status='DISABLED', disabled_at=${fixtureNow + 1},
            updated_at=${fixtureNow + 1}
        WHERE id='seller-member-1';
      `);
      const disabledMember = await request(
        app,
        '/api/buyer-portal/order-evidence',
        { headers: { Cookie: await sellerCookie() } },
      );
      expect(disabledMember.status).toBe(401);

      database!.exec(`
        UPDATE seller_organization_members
        SET status='ACTIVE', disabled_at=NULL,
            updated_at=${fixtureNow + 2}
        WHERE id='seller-member-1';
        UPDATE seller_organizations
        SET status='DISABLED', disabled_at=${fixtureNow + 2},
            updated_at=${fixtureNow + 2}
        WHERE id='seller-org-1';
      `);
      const disabledOrganization = await request(
        app,
        '/api/buyer-portal/order-evidence',
        { headers: { Cookie: await sellerCookie() } },
      );
      expect(disabledOrganization.status).toBe(401);
    },
  );

  it(
    'lists only buyer-owned eligible reservations with stable paging',
    async () => {
      await setup();
      seedEvidenceFile(database!, {
        suffix: 1,
        ownerBuyerId: 'buyer-1',
      });
      const app = testApp();
      const cookie = await buyerCookie('1');

      const submitted = await submitViaApi(app, cookie, {
        reservationId: 'reservation-a',
        orderNumber: '111-1234567-1234567',
        fileObjectId: 'file-object-1',
        idempotencyKey: 'phase4b2-eligible-submit-0001',
      });
      await requestOrderEvidenceChanges(database!, {
        submissionId: submitted.data.order_evidence.submission_id,
        expectedVersion: 1,
        publicReason: '请补充清晰的付款截图',
        internalNote: '内部审核说明不得出现在门户',
      }, {
        actor: staffActor(),
        idempotencyKey: 'phase4b2-eligible-changes-0001',
        now: Date.now() + 1000,
      });

      const first = await request(
        app,
        '/api/buyer-portal/order-evidence/eligible-reservations?limit=1',
        { headers: { Cookie: cookie } },
      );
      expect(first.status).toBe(200);
      expect(first.headers.get('cache-control')).toBe('no-store');
      const firstBody = await json<any>(first);
      expect(firstBody.data.items).toHaveLength(1);
      expect(firstBody.data.next_cursor).toEqual(expect.any(String));

      const second = await request(
        app,
        '/api/buyer-portal/order-evidence/eligible-reservations?limit=1&cursor='
          + encodeURIComponent(firstBody.data.next_cursor),
        { headers: { Cookie: cookie } },
      );
      expect(second.status).toBe(200);
      const secondBody = await json<any>(second);
      expect(secondBody.data.next_cursor).toEqual(expect.any(String));
      const third = await request(
        app,
        '/api/buyer-portal/order-evidence/eligible-reservations?limit=1&cursor='
          + encodeURIComponent(secondBody.data.next_cursor),
        { headers: { Cookie: cookie } },
      );
      expect(third.status).toBe(200);
      const thirdBody = await json<any>(third);
      expect(thirdBody.data.next_cursor).toBeNull();
      const items = [
        ...firstBody.data.items,
        ...secondBody.data.items,
        ...thirdBody.data.items,
      ];
      expect(new Set(items.map((item) => item.reservation_id)))
        .toEqual(new Set([
          'reservation-a',
          'reservation-b',
          'reservation-c',
        ]));
      expect(items.find(
        (item) => item.reservation_id === 'reservation-a',
      )).toMatchObject({
        current_order_evidence_status: 'CHANGES_REQUESTED',
        current_order_evidence_version: 2,
        allowed_actions: ['RESUBMIT', 'WITHDRAW'],
        review_type: 'IMAGE',
      });
      expect(items.find(
        (item) => item.reservation_id === 'reservation-b',
      )).toMatchObject({
        current_order_evidence_status: null,
        current_order_evidence_version: null,
        allowed_actions: ['SUBMIT'],
      });

      const serialized = JSON.stringify(items);
      for (const forbidden of [
        'reservation-other',
        'reservation-pending',
        'buyer_customer_id',
        'seller-org-1',
        'staff-pre-sales',
        '内部审核说明',
        'seller_notes',
        'audit',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }

      const tooLarge = await request(
        app,
        '/api/buyer-portal/order-evidence/eligible-reservations?limit=101',
        { headers: { Cookie: cookie } },
      );
      expect(tooLarge.status).toBe(400);

      const invalidCursor = await request(
        app,
        '/api/buyer-portal/order-evidence/eligible-reservations?cursor=***',
        { headers: { Cookie: cookie } },
      );
      expect(invalidCursor.status).toBe(400);
    },
  );

  it(
    'submits through Phase 3D normalization and validates integer JPY input',
    async () => {
      await setup();
      seedEvidenceFile(database!, {
        suffix: 1,
        ownerBuyerId: 'buyer-1',
      });
      const app = testApp();
      const cookie = await buyerCookie('1');

      const missingOrigin = await request(
        app,
        '/api/buyer-portal/order-evidence',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'Idempotency-Key': 'phase4b2-no-origin-0001',
          },
          body: submitBody({ fileObjectId: 'file-object-1' }),
        },
      );
      expect(missingOrigin.status).toBe(403);

      const buyerOverride = await request(
        app,
        '/api/buyer-portal/order-evidence',
        {
          method: 'POST',
          headers: writeHeaders(
            cookie,
            'phase4b2-buyer-override-0001',
          ),
          body: JSON.stringify({
            ...JSON.parse(submitBody({ fileObjectId: 'file-object-1' })),
            buyer_id: 'buyer-2',
          }),
        },
      );
      expect(buyerOverride.status).toBe(400);

      const created = await request(
        app,
        '/api/buyer-portal/order-evidence',
        {
          method: 'POST',
          headers: writeHeaders(cookie, 'phase4b2-submit-success-0001'),
          body: JSON.stringify({
            reservation_id: 'reservation-a',
            expected_version: 0,
            amazon_order_number: ' 123－1234567 – 1234567 ',
            amazon_order_date: '2026-08-01',
            final_paid_jpy: 3980,
            file_object_ids: ['file-object-1'],
            buyer_note: '订单截图已上传',
          }),
        },
      );
      expect(created.status).toBe(201);
      expect(created.headers.get('cache-control')).toBe('no-store');
      expect(created.headers.get('x-request-id'))
        .toEqual(expect.any(String));
      const createdBody = await json<any>(created);
      expect(createdBody).toMatchObject({
        data: {
          replayed: false,
          order_evidence: {
            reservation: { reservation_id: 'reservation-a' },
            amazon_order_number_display: '123-1234567-1234567',
            final_paid_jpy: 3980,
            status: 'PENDING_VERIFICATION',
            version: 1,
            evidence_version_no: 1,
            allowed_actions: ['WITHDRAW'],
          },
        },
        meta: { request_id: expect.any(String) },
      });

      const version = await database!.prepare(`
        SELECT amazon_order_number_raw,
               amazon_order_number_normalized,
               final_paid_jpy
        FROM order_evidence_versions
        WHERE submission_id=?
      `).bind(
        createdBody.data.order_evidence.submission_id,
      ).first<{
        amazon_order_number_raw: string;
        amazon_order_number_normalized: string;
        final_paid_jpy: number;
      }>();
      expect(version).toEqual({
        amazon_order_number_raw: '123-1234567 – 1234567',
        amazon_order_number_normalized: '123-1234567-1234567',
        final_paid_jpy: 3980,
      });

      for (const [value, key] of [
        [1.5, 'decimal'],
        [-1, 'negative'],
        [Number.MAX_SAFE_INTEGER + 1, 'overflow'],
      ] as const) {
        const invalid = await request(
          app,
          '/api/buyer-portal/order-evidence',
          {
            method: 'POST',
            headers: writeHeaders(
              cookie,
              `phase4b2-invalid-jpy-${key}-0001`,
            ),
            body: JSON.stringify({
              reservation_id: 'reservation-b',
              expected_version: 0,
              amazon_order_number: '124-1234567-1234567',
              amazon_order_date: '2026-08-01',
              final_paid_jpy: value,
              file_object_ids: ['file-object-1'],
            }),
          },
        );
        expect(invalid.status).toBe(400);
        await expect(json(invalid)).resolves.toMatchObject({
          error: { code: 'VALIDATION_ERROR' },
        });
      }

      const otherReservation = await request(
        app,
        '/api/buyer-portal/order-evidence',
        {
          method: 'POST',
          headers: writeHeaders(
            cookie,
            'phase4b2-other-reservation-0001',
          ),
          body: JSON.stringify({
            reservation_id: 'reservation-other',
            expected_version: 0,
            amazon_order_number: '125-1234567-1234567',
            amazon_order_date: '2026-08-01',
            final_paid_jpy: 100,
            file_object_ids: ['file-object-1'],
          }),
        },
      );
      expect(otherReservation.status).toBe(404);
    },
  );

  it(
    'rejects unverified, wrong-purpose, seller-visible and foreign files',
    async () => {
      await setup();
      seedEvidenceFile(database!, {
        suffix: 1,
        ownerBuyerId: 'buyer-1',
        verified: false,
      });
      seedEvidenceFile(database!, {
        suffix: 2,
        ownerBuyerId: 'buyer-1',
        purpose: 'PRODUCT_APPLICATION_IMAGE',
      });
      seedEvidenceFile(database!, {
        suffix: 3,
        ownerBuyerId: 'buyer-2',
      });
      seedEvidenceFile(database!, {
        suffix: 4,
        ownerBuyerId: 'buyer-1',
        visibility: 'SELLER_VISIBLE',
      });
      const app = testApp();
      const cookie = await buyerCookie('1');

      const cases = [
        ['file-object-1', 409, 'FILE_NOT_VERIFIED'],
        ['file-object-2', 404, 'NOT_FOUND'],
        ['file-object-3', 404, 'NOT_FOUND'],
        ['file-object-4', 404, 'NOT_FOUND'],
        ['file-object-missing', 404, 'NOT_FOUND'],
      ] as const;
      for (const [fileObjectId, status, code] of cases) {
        const response = await request(
          app,
          '/api/buyer-portal/order-evidence',
          {
            method: 'POST',
            headers: writeHeaders(
              cookie,
              `phase4b2-file-check-${fileObjectId}`,
            ),
            body: JSON.stringify({
              reservation_id: 'reservation-a',
              expected_version: 0,
              amazon_order_number: '200-1234567-1234567',
              amazon_order_date: '2026-08-01',
              final_paid_jpy: 1000,
              file_object_ids: [fileObjectId],
            }),
          },
        );
        expect(response.status).toBe(status);
        await expect(json(response)).resolves.toMatchObject({
          error: { code },
        });
      }

      const submissions = await database!.prepare(`
        SELECT COUNT(*) AS count
        FROM order_evidence_submissions
      `).first<{ count: number }>();
      expect(Number(submissions?.count)).toBe(0);
    },
  );

  it('replays identical writes and rejects idempotency payload conflicts', async () => {
    await setup();
    seedEvidenceFile(database!, {
      suffix: 1,
      ownerBuyerId: 'buyer-1',
    });
    const app = testApp();
    const cookie = await buyerCookie('1');
    const key = 'phase4b2-idempotency-submit-0001';
    const body = submitBody({ fileObjectId: 'file-object-1' });

    const first = await request(app, '/api/buyer-portal/order-evidence', {
      method: 'POST',
      headers: writeHeaders(cookie, key),
      body,
    });
    expect(first.status).toBe(201);
    const firstBody = await json<any>(first);

    const replay = await request(app, '/api/buyer-portal/order-evidence', {
      method: 'POST',
      headers: writeHeaders(cookie, key),
      body,
    });
    expect(replay.status).toBe(200);
    await expect(json(replay)).resolves.toMatchObject({
      data: {
        replayed: true,
        order_evidence: {
          submission_id:
            firstBody.data.order_evidence.submission_id,
        },
      },
    });

    const conflict = await request(
      app,
      '/api/buyer-portal/order-evidence',
      {
        method: 'POST',
        headers: writeHeaders(cookie, key),
        body: JSON.stringify({
          ...JSON.parse(body),
          final_paid_jpy: 9999,
        }),
      },
    );
    expect(conflict.status).toBe(409);
    await expect(json(conflict)).resolves.toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });

  it(
    'lists and reads only safe current-buyer projections',
    async () => {
      await setup();
      seedEvidenceFile(database!, {
        suffix: 1,
        ownerBuyerId: 'buyer-1',
      });
      seedEvidenceFile(database!, {
        suffix: 2,
        ownerBuyerId: 'buyer-1',
        visibility: 'INTERNAL_ONLY',
      });
      seedEvidenceFile(database!, {
        suffix: 3,
        ownerBuyerId: 'buyer-2',
      });
      const app = testApp();
      const buyerOne = await buyerCookie('1');
      const buyerTwo = await buyerCookie('2');

      const first = await submitViaApi(app, buyerOne, {
        reservationId: 'reservation-a',
        orderNumber: '301-1234567-1234567',
        fileObjectId: 'file-object-1',
        idempotencyKey: 'phase4b2-list-submit-a-0001',
      });
      const second = await submitViaApi(app, buyerOne, {
        reservationId: 'reservation-b',
        orderNumber: '302-1234567-1234567',
        fileObjectId: 'file-object-2',
        idempotencyKey: 'phase4b2-list-submit-b-0001',
      });
      const foreign = await submitViaApi(app, buyerTwo, {
        reservationId: 'reservation-other',
        orderNumber: '303-1234567-1234567',
        fileObjectId: 'file-object-3',
        idempotencyKey: 'phase4b2-list-submit-other-0001',
      });

      const pageOne = await request(
        app,
        '/api/buyer-portal/order-evidence?limit=1',
        { headers: { Cookie: buyerOne } },
      );
      expect(pageOne.status).toBe(200);
      const pageOneBody = await json<any>(pageOne);
      expect(pageOneBody.data.items).toHaveLength(1);
      expect(pageOneBody.data.next_cursor).toEqual(expect.any(String));

      const pageTwo = await request(
        app,
        '/api/buyer-portal/order-evidence?limit=1&cursor='
          + encodeURIComponent(pageOneBody.data.next_cursor),
        { headers: { Cookie: buyerOne } },
      );
      const pageTwoBody = await json<any>(pageTwo);
      const items = [
        ...pageOneBody.data.items,
        ...pageTwoBody.data.items,
      ];
      expect(new Set(items.map((item) => item.submission_id)))
        .toEqual(new Set([
          first.data.order_evidence.submission_id,
          second.data.order_evidence.submission_id,
        ]));
      expect(JSON.stringify(items)).not.toContain(
        foreign.data.order_evidence.submission_id,
      );

      const detail = await request(
        app,
        `/api/buyer-portal/order-evidence/${
          first.data.order_evidence.submission_id
        }`,
        { headers: { Cookie: buyerOne } },
      );
      expect(detail.status).toBe(200);
      const detailBody = await json<any>(detail);
      expect(detailBody.data.order_evidence.files[0]).toMatchObject({
        file_object_id: 'file-object-1',
        client_file_name: 'evidence-1.png',
        mime: 'image/png',
        byte_size: 8,
        status: 'VERIFIED',
        visibility: 'BUYER_VISIBLE',
      });

      const serialized = JSON.stringify(detailBody);
      for (const forbidden of [
        'amazon_order_number_raw',
        'buyer_customer_id',
        'internal_review_note',
        'verified_by_staff_id',
        'duplicate_signal_count',
        'object_key',
        'upload_intent_id',
        'files/v1/',
        'seller-org-1',
        'staff-pre-sales',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }

      const foreignDetail = await request(
        app,
        `/api/buyer-portal/order-evidence/${
          first.data.order_evidence.submission_id
        }`,
        { headers: { Cookie: buyerTwo } },
      );
      expect(foreignDetail.status).toBe(404);
      await expect(json(foreignDetail)).resolves.toMatchObject({
        error: { code: 'NOT_FOUND' },
      });
    },
  );

  it('creates a concealed, version-bound file read intent with replay safety', async () => {
    await setup();
    seedEvidenceFile(database!, {
      suffix: 1,
      ownerBuyerId: 'buyer-1',
    });
    const app = testApp();
    const buyerOne = await buyerCookie('1');
    const buyerTwo = await buyerCookie('2');
    const submitted = await submitViaApi(app, buyerOne, {
      reservationId: 'reservation-a',
      orderNumber: '311-1234567-1234567',
      fileObjectId: 'file-object-1',
      idempotencyKey: 'module1-read-source-0001',
    });
    const evidence = submitted.data.order_evidence;
    const file = evidence.files[0];
    expect(file).toMatchObject({
      file_object_id: 'file-object-1',
      file_entity_link_id: expect.any(String),
      version: 3,
      allowed_actions: ['CREATE_READ_INTENT'],
    });
    const path = `/api/buyer-portal/order-evidence/${evidence.submission_id}`
      + `/files/${file.file_entity_link_id}/read-intent`;

    const missingOrigin = await request(app, path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: buyerOne,
        'Idempotency-Key': 'module1-read-no-origin-0001',
      },
      body: JSON.stringify({ expected_file_version: 3 }),
    });
    expect(missingOrigin.status).toBe(403);

    const wrongVersion = await request(app, path, {
      method: 'POST',
      headers: writeHeaders(buyerOne, 'module1-read-version-0001'),
      body: JSON.stringify({ expected_file_version: 2 }),
    });
    expect(wrongVersion.status).toBe(409);
    await expect(json(wrongVersion)).resolves.toMatchObject({
      error: { code: 'VERSION_CONFLICT' },
    });

    const foreign = await request(app, path, {
      method: 'POST',
      headers: writeHeaders(buyerTwo, 'module1-read-foreign-0001'),
      body: JSON.stringify({ expected_file_version: 3 }),
    });
    expect(foreign.status).toBe(404);

    const key = 'module1-read-success-0001';
    const first = await request(app, path, {
      method: 'POST',
      headers: writeHeaders(buyerOne, key),
      body: JSON.stringify({ expected_file_version: 3 }),
    });
    expect(first.status).toBe(201);
    const firstBody = await json<any>(first);
    expect(firstBody.data).toMatchObject({
      read_intent_id: expect.any(String),
      file_object_id: 'file-object-1',
      access_token: expect.any(String),
      access_token_available: true,
      expires_at: expect.any(Number),
      replayed: false,
    });
    expect(JSON.stringify(firstBody)).not.toMatch(/object_key|files\/v1\//iu);

    const replay = await request(app, path, {
      method: 'POST',
      headers: writeHeaders(buyerOne, key),
      body: JSON.stringify({ expected_file_version: 3 }),
    });
    expect(replay.status).toBe(200);
    await expect(json(replay)).resolves.toMatchObject({
      data: {
        read_intent_id: firstBody.data.read_intent_id,
        file_object_id: 'file-object-1',
        access_token: null,
        access_token_available: false,
        replayed: true,
      },
    });
  });

  it(
    'resubmits only CHANGES_REQUESTED evidence as a new immutable version',
    async () => {
      await setup();
      seedEvidenceFile(database!, {
        suffix: 1,
        ownerBuyerId: 'buyer-1',
      });
      seedEvidenceFile(database!, {
        suffix: 2,
        ownerBuyerId: 'buyer-1',
      });
      const app = testApp();
      const cookie = await buyerCookie('1');
      const submitted = await submitViaApi(app, cookie, {
        reservationId: 'reservation-a',
        orderNumber: '401-1234567-1234567',
        fileObjectId: 'file-object-1',
        idempotencyKey: 'phase4b2-resubmit-initial-0001',
      });
      const submissionId = submitted.data.order_evidence.submission_id;

      await requestOrderEvidenceChanges(database!, {
        submissionId,
        expectedVersion: 1,
        publicReason: '请补充最终付款截图',
        internalNote: '金额区域不清晰',
      }, {
        actor: staffActor(),
        idempotencyKey: 'phase4b2-resubmit-changes-0001',
        now: Date.now() + 1000,
      });

      const changesDetail = await request(
        app,
        `/api/buyer-portal/order-evidence/${submissionId}`,
        { headers: { Cookie: cookie } },
      );
      const changesBody = await json<any>(changesDetail);
      expect(changesBody.data.order_evidence).toMatchObject({
        status: 'CHANGES_REQUESTED',
        version: 2,
        public_change_reason: '请补充最终付款截图',
        allowed_actions: ['RESUBMIT', 'WITHDRAW'],
      });
      expect(JSON.stringify(changesBody)).not.toContain('金额区域不清晰');

      const wrongVersion = await resubmitViaApi(app, cookie, {
        submissionId,
        expectedVersion: 99,
        fileObjectId: 'file-object-2',
        idempotencyKey: 'phase4b2-resubmit-wrong-version-0001',
      });
      expect(wrongVersion.status).toBe(409);
      await expect(json(wrongVersion)).resolves.toMatchObject({
        error: { code: 'VERSION_CONFLICT' },
      });

      const resubmitted = await resubmitViaApi(app, cookie, {
        submissionId,
        expectedVersion: 2,
        fileObjectId: 'file-object-2',
        idempotencyKey: 'phase4b2-resubmit-success-0001',
      });
      expect(resubmitted.status).toBe(200);
      const resubmittedBody = await json<any>(resubmitted);
      expect(resubmittedBody.data.order_evidence).toMatchObject({
        status: 'PENDING_VERIFICATION',
        version: 3,
        evidence_version_no: 2,
        amazon_order_number_display: '402-1234567-7654321',
        final_paid_jpy: 4980,
        public_change_reason: null,
      });

      const versions = await database!.prepare(`
        SELECT version_no, amazon_order_number_normalized,
               final_paid_jpy
        FROM order_evidence_versions
        WHERE submission_id=?
        ORDER BY version_no
      `).bind(submissionId).all<{
        version_no: number;
        amazon_order_number_normalized: string;
        final_paid_jpy: number;
      }>();
      expect(versions.results).toEqual([
        {
          version_no: 1,
          amazon_order_number_normalized: '401-1234567-1234567',
          final_paid_jpy: 3980,
        },
        {
          version_no: 2,
          amazon_order_number_normalized: '402-1234567-7654321',
          final_paid_jpy: 4980,
        },
      ]);

      const disallowed = await resubmitViaApi(app, cookie, {
        submissionId,
        expectedVersion: 3,
        fileObjectId: 'file-object-2',
        idempotencyKey: 'phase4b2-resubmit-disallowed-0001',
      });
      expect(disallowed.status).toBe(409);
      await expect(json(disallowed)).resolves.toMatchObject({
        error: { code: 'ORDER_EVIDENCE_STATE_CONFLICT' },
      });

      const otherBuyer = await resubmitViaApi(
        app,
        await buyerCookie('2'),
        {
          submissionId,
          expectedVersion: 3,
          fileObjectId: 'file-object-2',
          idempotencyKey: 'phase4b2-resubmit-other-buyer-0001',
        },
      );
      expect(otherBuyer.status).toBe(404);
    },
  );

  it(
    'withdraws only allowed states and blocks VERIFIED and CONSUMED',
    async () => {
      await setup();
      seedEvidenceFile(database!, {
        suffix: 1,
        ownerBuyerId: 'buyer-1',
      });
      seedEvidenceFile(database!, {
        suffix: 2,
        ownerBuyerId: 'buyer-1',
      });
      const app = testApp();
      const cookie = await buyerCookie('1');

      const withdrawable = await submitViaApi(app, cookie, {
        reservationId: 'reservation-a',
        orderNumber: '501-1234567-1234567',
        fileObjectId: 'file-object-1',
        idempotencyKey: 'phase4b2-withdraw-submit-a-0001',
      });
      const withdrawalId = withdrawable.data.order_evidence.submission_id;

      const missingOrigin = await request(
        app,
        `/api/buyer-portal/order-evidence/${withdrawalId}/withdraw`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'Idempotency-Key': 'phase4b2-withdraw-no-origin-0001',
          },
          body: JSON.stringify({ expected_version: 1 }),
        },
      );
      expect(missingOrigin.status).toBe(403);

      const wrongVersion = await withdrawViaApi(app, cookie, {
        submissionId: withdrawalId,
        expectedVersion: 99,
        idempotencyKey: 'phase4b2-withdraw-wrong-version-0001',
      });
      expect(wrongVersion.status).toBe(409);
      await expect(json(wrongVersion)).resolves.toMatchObject({
        error: { code: 'VERSION_CONFLICT' },
      });

      const withdrawn = await withdrawViaApi(app, cookie, {
        submissionId: withdrawalId,
        expectedVersion: 1,
        idempotencyKey: 'phase4b2-withdraw-success-0001',
      });
      expect(withdrawn.status).toBe(200);
      await expect(json(withdrawn)).resolves.toMatchObject({
        data: {
          replayed: false,
          order_evidence: {
            status: 'WITHDRAWN',
            version: 2,
            allowed_actions: [],
          },
        },
      });

      const replay = await withdrawViaApi(app, cookie, {
        submissionId: withdrawalId,
        expectedVersion: 1,
        idempotencyKey: 'phase4b2-withdraw-success-0001',
      });
      expect(replay.status).toBe(200);
      await expect(json(replay)).resolves.toMatchObject({
        data: { replayed: true },
      });

      const verifiedSource = await submitViaApi(app, cookie, {
        reservationId: 'reservation-b',
        orderNumber: '502-1234567-1234567',
        fileObjectId: 'file-object-2',
        idempotencyKey: 'phase4b2-withdraw-submit-b-0001',
      });
      const verifiedId = verifiedSource.data.order_evidence.submission_id;
      const verified = await verifyOrderEvidence(database!, {
        submissionId: verifiedId,
        expectedVersion: 1,
        internalNote: '资料一致',
      }, {
        actor: staffActor(),
        idempotencyKey: 'phase4b2-withdraw-verify-0001',
        now: Date.now() + 1000,
      });

      const verifiedWithdraw = await withdrawViaApi(app, cookie, {
        submissionId: verifiedId,
        expectedVersion: verified.version,
        idempotencyKey: 'phase4b2-withdraw-verified-0001',
      });
      expect(verifiedWithdraw.status).toBe(409);
      await expect(json(verifiedWithdraw)).resolves.toMatchObject({
        error: { code: 'ORDER_EVIDENCE_STATE_CONFLICT' },
      });

      await database!.prepare(`
        UPDATE order_evidence_submissions
        SET status='CONSUMED', version=version+1,
            updated_at=MAX(updated_at+1, ?),
            consumed_at=MAX(updated_at+1, ?)
        WHERE id=? AND status='VERIFIED'
      `).bind(
        Date.now() + 2000,
        Date.now() + 2000,
        verifiedId,
      ).run();
      const consumedWithdraw = await withdrawViaApi(app, cookie, {
        submissionId: verifiedId,
        expectedVersion: verified.version + 1,
        idempotencyKey: 'phase4b2-withdraw-consumed-0001',
      });
      expect(consumedWithdraw.status).toBe(409);
      await expect(json(consumedWithdraw)).resolves.toMatchObject({
        error: { code: 'ORDER_EVIDENCE_STATE_CONFLICT' },
      });

      const facts = await database!.prepare(`
        SELECT
          (SELECT COUNT(*) FROM order_evidence_versions
           WHERE submission_id=?) AS version_count,
          (SELECT COUNT(*) FROM order_evidence_events
           WHERE submission_id=?) AS event_count,
          (SELECT COUNT(*) FROM order_evidence_version_files
           WHERE submission_id=?) AS file_count
      `).bind(
        withdrawalId,
        withdrawalId,
        withdrawalId,
      ).first<{
        version_count: number;
        event_count: number;
        file_count: number;
      }>();
      expect(facts).toMatchObject({
        version_count: 1,
        event_count: 2,
        file_count: 1,
      });
    },
  );

  it('keeps migration through 0026 and creates no actual refund, settlement, or profit', async () => {
    await setup();
    const root = path.resolve(import.meta.dirname, '../../../..');
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(33);
    expect(migrations[0]).toMatch(/^0001_/u);
    expect(migrations[25]).toBe('0026_financial_export_audit.sql');
    expect(migrations.at(-3)).toBe('0031_scheduled_operations.sql');

    const schema = await database!.prepare(`
      SELECT schema_version
      FROM app_schema_state
      WHERE singleton_id=1
    `).first<{ schema_version: number }>();
    expect(Number(schema?.schema_version)).toBe(33);

    const forbiddenTables = await database!.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type='table'
        AND name IN (
          'orders',
          'order_financial_snapshots',
          'buyer_refunds',
          'seller_settlements'
        )
    `).all<{ name: string }>();
    expect(forbiddenTables.results).toEqual([]);
  });
});

async function setup(): Promise<void> {
  database = createMigratedTestDatabase();
  fixtureNow = Date.now();
  await seedFixture(database, fixtureNow);
}

function testApp() {
  const app = createApp();
  registerBuyerOrderEvidencePortalRoutes(app);
  return app;
}

function staffActor(): StaffOrderEvidenceActor {
  return {
    staffId: 'staff-pre-sales',
    displayName: '售前',
    roles: ['pre_sales'] as readonly StaffRoleCode[],
    permissions: new Set<StaffPermissionCode>([
      'ORDER_VIEW',
      'ORDER_CONFIRM',
    ]),
  };
}

async function buyerCookie(number: '1' | '2'): Promise<string> {
  return sessionCookie({
    accountId: `buyer-account-${number}`,
    identitySubjectId: `buyer-subject-${number}`,
    accountType: 'BUYER',
  });
}

async function sellerCookie(): Promise<string> {
  return sessionCookie({
    accountId: 'seller-account-1',
    identitySubjectId: 'seller-subject-1',
    accountType: 'SELLER_MEMBER',
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

function writeHeaders(
  cookie: string,
  idempotencyKey: string,
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    Cookie: cookie,
    'Idempotency-Key': idempotencyKey,
  };
}

function submitBody(input: {
  fileObjectId: string;
  reservationId?: string;
  orderNumber?: string;
  finalPaidJpy?: number;
}): string {
  return JSON.stringify({
    reservation_id: input.reservationId ?? 'reservation-a',
    expected_version: 0,
    amazon_order_number:
      input.orderNumber ?? '123-1234567-1234567',
    amazon_order_date: '2026-08-01',
    final_paid_jpy: input.finalPaidJpy ?? 3980,
    file_object_ids: [input.fileObjectId],
  });
}

async function submitViaApi(
  app: ReturnType<typeof testApp>,
  cookie: string,
  input: {
    reservationId: string;
    orderNumber: string;
    fileObjectId: string;
    idempotencyKey: string;
  },
): Promise<any> {
  const response = await request(
    app,
    '/api/buyer-portal/order-evidence',
    {
      method: 'POST',
      headers: writeHeaders(cookie, input.idempotencyKey),
      body: submitBody({
        reservationId: input.reservationId,
        orderNumber: input.orderNumber,
        fileObjectId: input.fileObjectId,
      }),
    },
  );
  expect(response.status).toBe(201);
  return json<any>(response);
}

async function resubmitViaApi(
  app: ReturnType<typeof testApp>,
  cookie: string,
  input: {
    submissionId: string;
    expectedVersion: number;
    fileObjectId: string;
    idempotencyKey: string;
  },
): Promise<Response> {
  return request(
    app,
    `/api/buyer-portal/order-evidence/${input.submissionId}/resubmit`,
    {
      method: 'POST',
      headers: writeHeaders(cookie, input.idempotencyKey),
      body: JSON.stringify({
        expected_version: input.expectedVersion,
        amazon_order_number: '402-1234567-7654321',
        amazon_order_date: '2026-08-02',
        final_paid_jpy: 4980,
        file_object_ids: [input.fileObjectId],
        buyer_note: '已补充清晰截图',
      }),
    },
  );
}

async function withdrawViaApi(
  app: ReturnType<typeof testApp>,
  cookie: string,
  input: {
    submissionId: string;
    expectedVersion: number;
    idempotencyKey: string;
  },
): Promise<Response> {
  return request(
    app,
    `/api/buyer-portal/order-evidence/${input.submissionId}/withdraw`,
    {
      method: 'POST',
      headers: writeHeaders(cookie, input.idempotencyKey),
      body: JSON.stringify({
        expected_version: input.expectedVersion,
      }),
    },
  );
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

async function seedFixture(
  target: SqliteDatabase,
  now: number,
): Promise<void> {
  const orderDeadline = now + 2 * 60 * 60 * 1000;
  target.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'staff-pre-sales', '售前', 'ACTIVE', 1,
      1, 1000, 1000, NULL
    );
    INSERT INTO staff_departments (
      id, code, name, status, version, created_at, updated_at, disabled_at
    ) VALUES ('department-portal-order','portal-order','Portal Order',
      'ACTIVE',1,1000,1000,NULL);
    INSERT INTO staff_teams (
      id, department_id, code, name, status, version,
      created_at, updated_at, disabled_at
    ) VALUES ('team-portal-order','department-portal-order','portal-order',
      'Portal Order','ACTIVE',1,1000,1000,NULL);
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, created_at, updated_at
    ) VALUES ('staff-pre-sales','pre_sales','ACTIVE',NULL,1000,NULL,1000,1000);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
    ) VALUES
      ('staff-pre-sales','team-portal-order','ACTIVE',1000,NULL,1000,1000),
      ('zz-phase3h-test-owner','team-portal-order','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_team_leaders (
      staff_id, team_id, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('staff-pre-sales','team-portal-order','ACTIVE',
      'zz-phase3h-test-owner',1000,NULL,1000,1000);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-1', 'JP', 'ido-mango-9901',
      'seller-channel-ido-mango',
      'seller-channel-ido-mango',
      9901, '订单资料卖家', 'ACTIVE',
      1, 1000, 1000, 1000, NULL, 2
    );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('seller-subject-1', 'SELLER_ORG_MEMBER', 1000),
      ('buyer-subject-1', 'BUYER_CUSTOMER', 1000),
      ('buyer-subject-2', 'BUYER_CUSTOMER', 1000);

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

    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'buyer-channel-evidence', 'E', '订单资料测试渠道',
      'ACTIVE', 1, 1, 1000, 1000, NULL
    );

    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code,
      buyer_channel_id, buyer_customer_no,
      buyer_sequence, first_valid_order_business_date,
      display_name, access_status,
      identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      (
        'buyer-1', 'buyer-subject-1', 'JP',
        'buyer-channel-evidence', NULL, NULL, NULL,
        '买家一', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'buyer-2', 'buyer-subject-2', 'JP',
        'buyer-channel-evidence', NULL, NULL, NULL,
        '买家二', 'ACTIVE', 'CLEAR', 1,
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
        'buyer_evidence_1', 'buyer_evidence_1',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL
      ),
      (
        'buyer-account-2', 'buyer-subject-2', 'BUYER',
        'buyer_evidence_2', 'buyer_evidence_2',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL
      ),
      (
        'seller-account-1', 'seller-subject-1', 'SELLER_MEMBER',
        'seller_evidence_1', 'seller_evidence_1',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL
      );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-1', 'seller-org-1', 'JP',
      '订单资料店铺', '订单资料店铺', 'ACTIVE',
      1, 1000, 1000, NULL
    );

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('product-a', 'seller-org-1', 'store-1', 'JP',
       'B0EVIDA001', 'B0EVIDA001', 'ACTIVE', 1, 1,
       1000, 1000, NULL),
      ('product-b', 'seller-org-1', 'store-1', 'JP',
       'B0EVIDB001', 'B0EVIDB001', 'ACTIVE', 1, 1,
       1000, 1000, NULL),
      ('product-c', 'seller-org-1', 'store-1', 'JP',
       'B0EVIDC001', 'B0EVIDC001', 'ACTIVE', 1, 1,
       1000, 1000, NULL),
      ('product-other', 'seller-org-1', 'store-1', 'JP',
       'B0EVIDO001', 'B0EVIDO001', 'ACTIVE', 1, 1,
       1000, 1000, NULL),
      ('product-pending', 'seller-org-1', 'store-1', 'JP',
       'B0EVIDP001', 'B0EVIDP001', 'ACTIVE', 1, 1,
       1000, 1000, NULL);

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode) VALUES
      ('product-a-v1', 'product-a', 1, '订单资料产品A',
       '["关键词A"]', 'https://www.amazon.co.jp/evidence-a',
       '公开说明A', '内部说明A', 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT'),
      ('product-b-v1', 'product-b', 1, '订单资料产品B',
       '["关键词B"]', 'https://www.amazon.co.jp/evidence-b',
       '公开说明B', '内部说明B', 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT'),
      ('product-c-v1', 'product-c', 1, '订单资料产品C',
       '["关键词C"]', 'https://www.amazon.co.jp/evidence-c',
       '公开说明C', '内部说明C', 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT'),
      ('product-other-v1', 'product-other', 1, '其他买家产品',
       '["关键词O"]', 'https://www.amazon.co.jp/evidence-o',
       '公开说明O', '内部说明O', 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT'),
      ('product-pending-v1', 'product-pending', 1, '待审核产品',
       '["关键词P"]', 'https://www.amazon.co.jp/evidence-p',
       '公开说明P', '内部说明P', 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT');

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
      approved_reservation_count
    ) VALUES
      ('demand-a', 'seller-org-1', 'store-1', 'JP',
       'product-a', 1, 'seller-member-1', 'IMAGE',
       3, '公开需求A', '内部需求A',
       1000, ${orderDeadline - 10000}, ${orderDeadline + 100},
       'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
       2, 1000, 1000, 1000, 1000, NULL, NULL, 0, 1),
      ('demand-b', 'seller-org-1', 'store-1', 'JP',
       'product-b', 1, 'seller-member-1', 'TEXT',
       3, '公开需求B', '内部需求B',
       1000, ${orderDeadline - 9000}, ${orderDeadline + 200},
       'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
       2, 1100, 1100, 1100, 1100, NULL, NULL, 0, 1),
      ('demand-c', 'seller-org-1', 'store-1', 'JP',
       'product-c', 1, 'seller-member-1', 'VIDEO',
       3, '公开需求C', '内部需求C',
       1000, ${orderDeadline - 8000}, ${orderDeadline + 300},
       'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
       2, 1200, 1200, 1200, 1200, NULL, NULL, 0, 1),
      ('demand-other', 'seller-org-1', 'store-1', 'JP',
       'product-other', 1, 'seller-member-1', 'RATING',
       3, '公开需求O', '内部需求O',
       1000, ${orderDeadline - 7000}, ${orderDeadline + 400},
       'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
       2, 1300, 1300, 1300, 1300, NULL, NULL, 0, 1),
      ('demand-pending', 'seller-org-1', 'store-1', 'JP',
       'product-pending', 1, 'seller-member-1', 'IMAGE',
       3, '公开需求P', '内部需求P',
       1000, ${orderDeadline - 6000}, ${orderDeadline + 500},
       'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
       2, 1400, 1400, 1400, 1400, NULL, NULL, 1, 0);

    INSERT INTO product_reservations (
      id, demand_batch_id, buyer_customer_id,
      organization_id, store_id, product_id,
      product_version_no, marketplace_code,
      status, precheck_snapshot_json,
      hold_expires_at, order_deadline_snapshot,
      version, submitted_at, updated_at,
      decided_by_staff_id, decision_reason, decided_at,
      cancelled_at, expired_at, reopened_count,
      buyer_self_pay_bps_snapshot,
      reference_order_amount_jpy_snapshot,
      estimated_self_pay_jpy_snapshot,
      estimated_refundable_principal_jpy_snapshot,
      buyer_self_pay_accepted_at,
      buyer_self_pay_accepted_demand_version
    ) VALUES
      ('reservation-a', 'demand-a', 'buyer-1',
       'seller-org-1', 'store-1', 'product-a', 1, 'JP',
       'APPROVED', '{}', ${orderDeadline - 1000},
       ${orderDeadline + 100}, 2, 2000, 3000,
       'staff-pre-sales', NULL, 3000, NULL, NULL, 0,
       0, 1980, 0, 1980, 2000, 2),
      ('reservation-b', 'demand-b', 'buyer-1',
       'seller-org-1', 'store-1', 'product-b', 1, 'JP',
       'APPROVED', '{}', ${orderDeadline - 900},
       ${orderDeadline + 200}, 2, 2100, 3100,
       'staff-pre-sales', NULL, 3100, NULL, NULL, 0,
       0, 1980, 0, 1980, 2100, 2),
      ('reservation-c', 'demand-c', 'buyer-1',
       'seller-org-1', 'store-1', 'product-c', 1, 'JP',
       'APPROVED', '{}', ${orderDeadline - 800},
       ${orderDeadline + 300}, 2, 2200, 3200,
       'staff-pre-sales', NULL, 3200, NULL, NULL, 0,
       0, 1980, 0, 1980, 2200, 2),
      ('reservation-other', 'demand-other', 'buyer-2',
       'seller-org-1', 'store-1', 'product-other', 1, 'JP',
       'APPROVED', '{}', ${orderDeadline - 700},
       ${orderDeadline + 400}, 2, 2300, 3300,
       'staff-pre-sales', NULL, 3300, NULL, NULL, 0,
       0, 1980, 0, 1980, 2300, 2),
      ('reservation-pending', 'demand-pending', 'buyer-1',
       'seller-org-1', 'store-1', 'product-pending', 1, 'JP',
       'PENDING_REVIEW', '{}', ${orderDeadline - 600},
       ${orderDeadline + 500}, 1, 2400, 2400,
       NULL, NULL, NULL, NULL, NULL, 0,
       NULL, NULL, NULL, NULL, NULL, NULL);
  `);

  for (const input of [
    {
      suffix: 'buyer-portal-a',
      reservationId: 'reservation-a',
      buyerCustomerId: 'buyer-1',
      productId: 'product-a',
      productVersionId: 'product-a-v1',
    },
    {
      suffix: 'buyer-portal-b',
      reservationId: 'reservation-b',
      buyerCustomerId: 'buyer-1',
      productId: 'product-b',
      productVersionId: 'product-b-v1',
    },
    {
      suffix: 'buyer-portal-c',
      reservationId: 'reservation-c',
      buyerCustomerId: 'buyer-1',
      productId: 'product-c',
      productVersionId: 'product-c-v1',
    },
    {
      suffix: 'buyer-portal-other',
      reservationId: 'reservation-other',
      buyerCustomerId: 'buyer-2',
      productId: 'product-other',
      productVersionId: 'product-other-v1',
    },
  ] as const) {
    await seedPhase3GInstructionFixture(target, {
      ...input,
      staffId: 'staff-pre-sales',
      publishedAt: now - 1_000,
      seedEvidenceFile: false,
    });
  }
}

function seedEvidenceFile(
  target: SqliteDatabase,
  input: {
    suffix: number;
    ownerBuyerId: string;
    visibility?: 'INTERNAL_ONLY' | 'BUYER_VISIBLE' | 'SELLER_VISIBLE';
    purpose?: 'ORDER_EVIDENCE' | 'PRODUCT_APPLICATION_IMAGE';
    verified?: boolean;
  },
): void {
  const visibility = input.visibility ?? 'BUYER_VISIBLE';
  const purpose = input.purpose ?? 'ORDER_EVIDENCE';
  const verified = input.verified ?? true;
  const hex = input.suffix.toString(16).padStart(64, '0');
  const uploadIntentId = `file-intent-${input.suffix}`;
  const fileObjectId = `file-object-${input.suffix}`;

  target.exec(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id,
      purpose, visibility, status,
      requested_file_count, manifest_hash,
      version, expires_at, failure_code,
      created_at, updated_at, completed_at
    ) VALUES (
      '${uploadIntentId}',
      'BUYER_CUSTOMER', '${input.ownerBuyerId}',
      '${purpose}', '${visibility}', 'ISSUED',
      1, '${hex}', 1,
      ${fixtureNow + 60 * 60 * 1000}, NULL,
      ${fixtureNow - 10}, ${fixtureNow - 10}, NULL
    );

    INSERT INTO file_objects (
      id, upload_intent_id, slot_no,
      purpose, visibility, object_key,
      client_file_name, extension, declared_mime,
      expected_byte_size, status, upload_token_hash,
      upload_expires_at, uploaded_byte_size,
      detected_mime, uploaded_sha256,
      failure_code, delete_attempt_count,
      next_delete_at, version,
      created_at, updated_at, uploaded_at,
      verified_at, deleted_at
    ) VALUES (
      '${fileObjectId}', '${uploadIntentId}', 1,
      '${purpose}', '${visibility}',
      'files/v1/2026/08/order_evidence/${hex}',
      'evidence-${input.suffix}.png', 'png', 'image/png',
      8, 'RESERVED', '${hex}',
      ${fixtureNow + 60 * 60 * 1000}, NULL,
      NULL, NULL, NULL, 0, NULL, 1,
      ${fixtureNow - 10}, ${fixtureNow - 10}, NULL,
      NULL, NULL
    );
  `);

  if (!verified) return;
  target.exec(`
    UPDATE file_upload_intents
    SET status='VERIFIED', version=2,
        updated_at=${fixtureNow}, completed_at=${fixtureNow}
    WHERE id='${uploadIntentId}';

    UPDATE file_objects
    SET status='VERIFIED', version=3,
        uploaded_byte_size=8,
        detected_mime='image/png',
        uploaded_sha256='${hex}',
        updated_at=${fixtureNow},
        uploaded_at=${fixtureNow - 1},
        verified_at=${fixtureNow}
    WHERE id='${fileObjectId}';
  `);
}
