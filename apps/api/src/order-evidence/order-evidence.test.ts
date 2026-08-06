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
import {
  listOrderEvidenceForReview,
  readBuyerOrderEvidence,
  readStaffOrderEvidence,
} from './read-order-evidence';
import {
  requestOrderEvidenceChanges,
  verifyOrderEvidence,
} from './review-order-evidence';
import { submitOrderEvidence } from './submit-order-evidence';
import {
  normalizeAmazonOrderNumber,
  type BuyerOrderEvidenceActor,
  type StaffOrderEvidenceActor,
} from './order-evidence-shared';
import { withdrawOrderEvidence } from './withdraw-order-evidence';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Amazon order number normalization', () => {
  it('normalizes Unicode dashes and whitespace to the canonical layout', () => {
    expect(normalizeAmazonOrderNumber(
      ' 123－1234567 – 1234567 ',
    )).toEqual({
      raw: '123-1234567 – 1234567',
      normalized: '123-1234567-1234567',
    });
    expect(normalizeAmazonOrderNumber(
      '12312345671234567',
    ).normalized).toBe('123-1234567-1234567');
  });

  it('rejects non-digits and incorrect digit counts', () => {
    expect(() => normalizeAmazonOrderNumber(
      'ABC-1234567-1234567',
    )).toThrow('VALIDATION_ERROR');
    expect(() => normalizeAmazonOrderNumber(
      '12-1234567-1234567',
    )).toThrow('VALIDATION_ERROR');
  });
});

describe('Phase 3D order evidence workflow', () => {
  it('submits only for the buyer-owned APPROVED reservation and replays', async () => {
    database = createMigratedTestDatabase();
    seedOrderEvidenceFixture(database);
    seedVerifiedEvidenceFile(database, {
      suffix: 1,
      ownerBuyerId: 'buyer-1',
    });

    const first = await submitOrderEvidence(database, {
      reservationId: 'reservation-1',
      expectedVersion: 0,
      marketplace: 'JP',
      amazonOrderNumber: '123 1234567 1234567',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 3980,
      evidenceFileObjectIds: ['file-object-1'],
      buyerNote: '订单截图已上传',
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'order-evidence:submit:0001',
      now: 7000,
    });

    expect(first).toMatchObject({
      reservation_id: 'reservation-1',
      buyer_customer_id: 'buyer-1',
      status: 'PENDING_VERIFICATION',
      version: 1,
      current_evidence_version_no: 1,
      amazon_order_number_normalized: '123-1234567-1234567',
      final_paid_jpy: 3980,
      evidence_file_count: 1,
      replayed: false,
    });

    const replay = await submitOrderEvidence(database, {
      reservationId: 'reservation-1',
      expectedVersion: 0,
      marketplace: 'JP',
      amazonOrderNumber: '123 1234567 1234567',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 3980,
      evidenceFileObjectIds: ['file-object-1'],
      buyerNote: '订单截图已上传',
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'order-evidence:submit:0001',
      now: 7100,
    });
    expect(replay).toEqual({
      ...first,
      replayed: true,
    });

    const businessLink = await database.prepare(`
      SELECT
        version_file.submission_id,
        link.entity_type,
        link.entity_id,
        link.purpose,
        link.visibility
      FROM order_evidence_version_files version_file
      JOIN file_entity_links link
        ON link.id=version_file.file_entity_link_id
      WHERE version_file.file_object_id='file-object-1'
    `).first<{
      submission_id: string;
      entity_type: string;
      entity_id: string;
      purpose: string;
      visibility: string;
    }>();
    expect(businessLink).toMatchObject({
      submission_id: first.submission_id,
      entity_type: 'ORDER',
      entity_id: first.current_evidence_version_id,
      purpose: 'ORDER_EVIDENCE',
      visibility: 'BUYER_VISIBLE',
    });

    await expect(submitOrderEvidence(database, {
      reservationId: 'reservation-1',
      expectedVersion: 0,
      marketplace: 'JP',
      amazonOrderNumber: '123-1234567-1234567',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 3980,
      evidenceFileObjectIds: ['file-object-1'],
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'order-evidence:submit:payload-conflict',
      now: 7200,
    })).rejects.toMatchObject({
      code: 'ORDER_EVIDENCE_ALREADY_EXISTS',
      status: 409,
    });
  });

  it('hides resources from another buyer and rejects non-APPROVED reservations', async () => {
    database = createMigratedTestDatabase();
    seedOrderEvidenceFixture(database);
    seedVerifiedEvidenceFile(database, {
      suffix: 2,
      ownerBuyerId: 'buyer-2',
    });
    seedVerifiedEvidenceFile(database, {
      suffix: 3,
      ownerBuyerId: 'buyer-1',
    });

    await expect(submitOrderEvidence(database, {
      reservationId: 'reservation-1',
      expectedVersion: 0,
      marketplace: 'JP',
      amazonOrderNumber: '222-1234567-1234567',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 1,
      evidenceFileObjectIds: ['file-object-2'],
    }, {
      actor: buyerActor('buyer-2'),
      idempotencyKey: 'order-evidence:isolation:0001',
      now: 7000,
    })).rejects.toMatchObject({
      code: 'RESERVATION_NOT_FOUND',
      status: 404,
    });

    await expect(submitOrderEvidence(database, {
      reservationId: 'reservation-pending',
      expectedVersion: 0,
      marketplace: 'JP',
      amazonOrderNumber: '333-1234567-1234567',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 1,
      evidenceFileObjectIds: ['file-object-3'],
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'order-evidence:pending:0001',
      now: 7000,
    })).rejects.toMatchObject({
      code: 'ORDER_EVIDENCE_STATE_CONFLICT',
      status: 409,
    });
  });

  it('accepts only verified buyer-owned ORDER_EVIDENCE files hidden from sellers', async () => {
    database = createMigratedTestDatabase();
    seedOrderEvidenceFixture(database);
    seedVerifiedEvidenceFile(database, {
      suffix: 4,
      ownerBuyerId: 'buyer-2',
    });
    seedVerifiedEvidenceFile(database, {
      suffix: 5,
      ownerBuyerId: 'buyer-1',
      visibility: 'SELLER_VISIBLE',
    });
    seedVerifiedEvidenceFile(database, {
      suffix: 6,
      ownerBuyerId: 'buyer-1',
      purpose: 'PRODUCT_APPLICATION_IMAGE',
    });
    seedUnverifiedEvidenceFile(database, {
      suffix: 7,
      ownerBuyerId: 'buyer-1',
    });

    for (const [fileObjectId, expectedCode] of [
      ['file-object-4', 'ORDER_EVIDENCE_FILE_CONFLICT'],
      ['file-object-5', 'ORDER_EVIDENCE_FILE_CONFLICT'],
      ['file-object-6', 'ORDER_EVIDENCE_FILE_CONFLICT'],
      ['file-object-7', 'FILE_NOT_VERIFIED'],
    ] as const) {
      await expect(submitOrderEvidence(database, {
        reservationId: 'reservation-1',
        expectedVersion: 0,
        marketplace: 'JP',
        amazonOrderNumber: '444-1234567-1234567',
      amazonOrderDate: '2026-08-01',
        finalPaidJpy: 0,
        evidenceFileObjectIds: [fileObjectId],
      }, {
        actor: buyerActor('buyer-1'),
        idempotencyKey: `order-evidence:file-check:${fileObjectId}`,
        now: 7000,
      })).rejects.toMatchObject({
        code: expectedCode,
        status: 409,
      });
    }
  });

  it('requests changes, creates a new immutable version, then verifies', async () => {
    database = createMigratedTestDatabase();
    seedOrderEvidenceFixture(database);
    seedVerifiedEvidenceFile(database, {
      suffix: 8,
      ownerBuyerId: 'buyer-1',
    });
    seedVerifiedEvidenceFile(database, {
      suffix: 9,
      ownerBuyerId: 'buyer-1',
    });

    const submitted = await submitOrderEvidence(database, {
      reservationId: 'reservation-1',
      expectedVersion: 0,
      marketplace: 'JP',
      amazonOrderNumber: '555-1234567-1234567',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 5000,
      evidenceFileObjectIds: ['file-object-8'],
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'order-evidence:lifecycle:submit',
      now: 7000,
    });

    const changes = await requestOrderEvidenceChanges(database, {
      submissionId: submitted.submission_id,
      expectedVersion: 1,
      publicReason: '请补充最终付款截图',
      internalNote: '截图金额区域不清晰',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'order-evidence:lifecycle:changes',
      now: 8000,
    });
    expect(changes).toMatchObject({
      status: 'CHANGES_REQUESTED',
      version: 2,
      public_change_reason: '请补充最终付款截图',
    });

    const buyerProjection = await readBuyerOrderEvidence(
      database,
      { submissionId: submitted.submission_id },
      buyerActor('buyer-1'),
    );
    expect(buyerProjection.public_change_reason)
      .toBe('请补充最终付款截图');
    expect('internal_review_note' in buyerProjection).toBe(false);

    const resubmitted = await submitOrderEvidence(database, {
      reservationId: 'reservation-1',
      expectedVersion: 2,
      marketplace: 'JP',
      amazonOrderNumber: '555-1234567-7654321',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 4980,
      evidenceFileObjectIds: ['file-object-9'],
      buyerNote: '已补充清晰截图',
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'order-evidence:lifecycle:resubmit',
      now: 9000,
    });
    expect(resubmitted).toMatchObject({
      status: 'PENDING_VERIFICATION',
      version: 3,
      current_evidence_version_no: 2,
      final_paid_jpy: 4980,
      evidence_file_count: 1,
    });

    const verified = await verifyOrderEvidence(database, {
      submissionId: submitted.submission_id,
      expectedVersion: 3,
      internalNote: '金额与证据一致',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'order-evidence:lifecycle:verify',
      now: 10_000,
    });
    expect(verified).toMatchObject({
      status: 'VERIFIED',
      version: 4,
      verified_at: 10_000,
      verified_by_staff_id: 'staff-pre-sales',
    });

    const versions = await database.prepare(`
      SELECT version_no, final_paid_jpy
      FROM order_evidence_versions
      WHERE submission_id=?
      ORDER BY version_no
    `).bind(submitted.submission_id).all<{
      version_no: number;
      final_paid_jpy: number;
    }>();
    expect(versions.results).toEqual([
      { version_no: 1, final_paid_jpy: 5000 },
      { version_no: 2, final_paid_jpy: 4980 },
    ]);

    await expect(database.prepare(`
      UPDATE order_evidence_versions
      SET final_paid_jpy=1
      WHERE submission_id=? AND version_no=1
    `).bind(submitted.submission_id).run()).rejects.toThrow(
      'order_evidence_versions_are_immutable',
    );
    await expect(submitOrderEvidence(database, {
      reservationId: 'reservation-1',
      expectedVersion: 4,
      marketplace: 'JP',
      amazonOrderNumber: '555-1234567-7654321',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 4980,
      evidenceFileObjectIds: ['file-object-9'],
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'order-evidence:lifecycle:verified-edit',
      now: 11_000,
    })).rejects.toMatchObject({
      code: 'ORDER_EVIDENCE_STATE_CONFLICT',
      status: 409,
    });
  });

  it('rejects an order number already claimed by another submission', async () => {
    database = createMigratedTestDatabase();
    seedOrderEvidenceFixture(database);
    seedVerifiedEvidenceFile(database, {
      suffix: 10,
      ownerBuyerId: 'buyer-1',
    });
    seedVerifiedEvidenceFile(database, {
      suffix: 11,
      ownerBuyerId: 'buyer-2',
    });

    const first = await submitOrderEvidence(database, {
      reservationId: 'reservation-1',
      expectedVersion: 0,
      marketplace: 'JP',
      amazonOrderNumber: '666-1234567-1234567',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 1000,
      evidenceFileObjectIds: ['file-object-10'],
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'order-evidence:duplicate:first',
      now: 7000,
    });
    await expect(submitOrderEvidence(database, {
      reservationId: 'reservation-2',
      expectedVersion: 0,
      marketplace: 'JP',
      amazonOrderNumber: '66612345671234567',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 2000,
      evidenceFileObjectIds: ['file-object-11'],
    }, {
      actor: buyerActor('buyer-2'),
      idempotencyKey: 'order-evidence:duplicate:second',
      now: 7100,
    })).rejects.toMatchObject({
      code: 'ORDER_NUMBER_ALREADY_CLAIMED',
      status: 409,
    });

    const activeClaim = await database.prepare(`
      SELECT evidence_submission_id, status
      FROM formal_order_number_claims
      WHERE marketplace_code='JP'
        AND amazon_order_number_normalized='666-1234567-1234567'
        AND status IN ('PROVISIONAL','FINAL')
    `).first<{ evidence_submission_id: string; status: string }>();
    expect(activeClaim).toEqual({
      evidence_submission_id: first.submission_id,
      status: 'PROVISIONAL',
    });
  });

  it('allows withdrawal only before verification and enforces permissions', async () => {
    database = createMigratedTestDatabase();
    seedOrderEvidenceFixture(database);
    seedVerifiedEvidenceFile(database, {
      suffix: 12,
      ownerBuyerId: 'buyer-1',
    });
    const submitted = await submitOrderEvidence(database, {
      reservationId: 'reservation-1',
      expectedVersion: 0,
      marketplace: 'JP',
      amazonOrderNumber: '777-1234567-1234567',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 777,
      evidenceFileObjectIds: ['file-object-12'],
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'order-evidence:withdraw:submit',
      now: 7000,
    });

    await expect(verifyOrderEvidence(database, {
      submissionId: submitted.submission_id,
      expectedVersion: 1,
    }, {
      actor: {
        ...preSalesActor(),
        permissions: new Set<StaffPermissionCode>(['ORDER_VIEW']),
      },
      idempotencyKey: 'order-evidence:permission:verify',
      now: 8000,
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    const withdrawn = await withdrawOrderEvidence(database, {
      submissionId: submitted.submission_id,
      expectedVersion: 1,
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'order-evidence:withdraw:command',
      now: 8000,
    });
    expect(withdrawn).toMatchObject({
      status: 'WITHDRAWN',
      version: 2,
      withdrawn_at: 8000,
    });

    await expect(requestOrderEvidenceChanges(database, {
      submissionId: submitted.submission_id,
      expectedVersion: 2,
      publicReason: '不应允许',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'order-evidence:withdraw:review',
      now: 9000,
    })).rejects.toMatchObject({
      code: 'ORDER_EVIDENCE_STATE_CONFLICT',
      status: 409,
    });

    await expect(readBuyerOrderEvidence(
      database,
      { submissionId: submitted.submission_id },
      buyerActor('buyer-2'),
    )).rejects.toMatchObject({
      code: 'ORDER_EVIDENCE_NOT_FOUND',
      status: 404,
    });
  });

  it('keeps events immutable and creates no formal order or financial facts', async () => {
    database = createMigratedTestDatabase();
    seedOrderEvidenceFixture(database);
    seedVerifiedEvidenceFile(database, {
      suffix: 13,
      ownerBuyerId: 'buyer-1',
    });
    const submitted = await submitOrderEvidence(database, {
      reservationId: 'reservation-1',
      expectedVersion: 0,
      marketplace: 'JP',
      amazonOrderNumber: '888-1234567-1234567',
      amazonOrderDate: '2026-08-01',
      finalPaidJpy: 888,
      evidenceFileObjectIds: ['file-object-13'],
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'order-evidence:boundary:submit',
      now: 7000,
    });

    const queue = await listOrderEvidenceForReview(
      database,
      { limit: 10 },
      preSalesActor(),
    );
    expect(queue.map((item) => item.submission_id))
      .toContain(submitted.submission_id);

    await expect(database.prepare(`
      UPDATE order_evidence_events
      SET next_status='WITHDRAWN'
      WHERE submission_id=?
    `).bind(submitted.submission_id).run()).rejects.toThrow(
      'order_evidence_events_are_immutable',
    );

    const forbiddenTables = await database.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type='table'
        AND name IN (
          'orders',
          'order_financial_snapshots',
          'buyer_refunds',
          'seller_settlements'
        )
    `).all();
    expect(forbiddenTables.results).toEqual([]);

    const versionColumns = await database.prepare(`
      PRAGMA table_info(order_evidence_versions)
    `).all<{ name: string; type: string }>();
    expect(versionColumns.results.find(
      (column) => column.name === 'final_paid_jpy',
    )?.type).toBe('INTEGER');
    for (const forbiddenColumn of [
      'buyer_number',
      'business_order_number',
      'buyer_rate_snapshot',
      'seller_rate_snapshot',
      'service_fee_snapshot',
      'profit_cny_fen',
      'refund_amount',
      'settlement_amount',
    ]) {
      expect(versionColumns.results.some(
        (column) => column.name === forbiddenColumn,
      )).toBe(false);
    }
  });
});

function buyerActor(
  buyerCustomerId: string,
): BuyerOrderEvidenceActor {
  return {
    buyerCustomerId,
    marketplaceCode: 'JP',
    accessStatus: 'ACTIVE',
    identityReviewStatus: 'CLEAR',
  };
}

function preSalesActor(): StaffOrderEvidenceActor {
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

function seedOrderEvidenceFixture(database: SqliteDatabase): void {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'staff-pre-sales', '售前', 'ACTIVE', 1,
      1, 1000, 1000, NULL
    );
    INSERT INTO staff_departments (
      id, code, name, status, version, created_at, updated_at, disabled_at
    ) VALUES ('department-order-evidence','order-evidence','Order Evidence',
      'ACTIVE',1,1000,1000,NULL);
    INSERT INTO staff_teams (
      id, department_id, code, name, status, version,
      created_at, updated_at, disabled_at
    ) VALUES ('team-order-evidence','department-order-evidence','order-evidence',
      'Order Evidence','ACTIVE',1,1000,1000,NULL);
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, created_at, updated_at
    ) VALUES ('staff-pre-sales','pre_sales','ACTIVE',NULL,1000,NULL,1000,1000);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
    ) VALUES ('staff-pre-sales','team-order-evidence','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
    ) VALUES ('zz-phase3h-test-owner','team-order-evidence','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_team_leaders (
      staff_id, team_id, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('staff-pre-sales','team-order-evidence','ACTIVE',
      'zz-phase3h-test-owner',1000,NULL,1000,1000);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-evidence', 'JP', 'ido-mango-9101',
      'seller-channel-ido-mango',
      'seller-channel-ido-mango',
      9101, '证据测试卖家', 'ACTIVE',
      1, 1000, 1000, 1000, NULL, 2
    );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('seller-evidence-subject', 'SELLER_ORG_MEMBER', 1000),
      ('buyer-evidence-subject-1', 'BUYER_CUSTOMER', 1000),
      ('buyer-evidence-subject-2', 'BUYER_CUSTOMER', 1000);

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'seller-evidence-owner', 'seller-evidence-subject',
      'seller-org-evidence', 1, 'ido-mango-9101-1',
      '负责人', 'OWNER', 1, 'ACTIVE', 1,
      1000, 1000, 1000, NULL
    );

    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'buyer-channel-evidence', 'E', '证据测试渠道',
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
        'buyer-1', 'buyer-evidence-subject-1', 'JP',
        'buyer-channel-evidence', NULL, NULL, NULL,
        '买家一', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'buyer-2', 'buyer-evidence-subject-2', 'JP',
        'buyer-channel-evidence', NULL, NULL, NULL,
        '买家二', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-evidence', 'seller-org-evidence', 'JP',
      '证据测试店铺', '证据测试店铺', 'ACTIVE',
      1, 1000, 1000, NULL
    );

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES
      (
        'product-evidence-1', 'seller-org-evidence',
        'store-evidence', 'JP',
        'B0EVID0001', 'B0EVID0001', 'ACTIVE',
        1, 1, 1000, 1000, NULL
      ),
      (
        'product-evidence-2', 'seller-org-evidence',
        'store-evidence', 'JP',
        'B0EVID0002', 'B0EVID0002', 'ACTIVE',
        1, 1, 1000, 1000, NULL
      ),
      (
        'product-evidence-3', 'seller-org-evidence',
        'store-evidence', 'JP',
        'B0EVID0003', 'B0EVID0003', 'ACTIVE',
        1, 1, 1000, 1000, NULL
      );

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode,
          default_buyer_self_pay_bps) VALUES
      (
        'product-evidence-1-v1', 'product-evidence-1', 1,
        '证据产品一', '["证据一"]',
        'https://www.amazon.co.jp/evidence-one',
        '公开说明一', '内部说明一',
        'staff-pre-sales', 1000
      ,
          1980, 'MAIN_IMAGE_VARIANT', 1000),
      (
        'product-evidence-2-v1', 'product-evidence-2', 1,
        '证据产品二', '["证据二"]',
        'https://www.amazon.co.jp/evidence-two',
        '公开说明二', '内部说明二',
        'staff-pre-sales', 1000
      ,
          1980, 'MAIN_IMAGE_VARIANT', 1000),
      (
        'product-evidence-3-v1', 'product-evidence-3', 1,
        '证据产品三', '["证据三"]',
        'https://www.amazon.co.jp/evidence-three',
        '公开说明三', '内部说明三',
        'staff-pre-sales', 1000
      ,
          1980, 'MAIN_IMAGE_VARIANT', 1000);

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
        'demand-evidence-1', 'seller-org-evidence',
        'store-evidence', 'JP',
        'product-evidence-1', 1, 'seller-evidence-owner', 'IMAGE',
        3, '公开说明', '内部说明',
        2000, 5000, 20000,
        'PUBLISHED', NULL, NULL,
        'staff-pre-sales', NULL,
        2, 1000, 3000, 3000, 3000, NULL, NULL,
        0, 1, 1000, 'PRODUCT_DEFAULT', NULL
      ),
      (
        'demand-evidence-2', 'seller-org-evidence',
        'store-evidence', 'JP',
        'product-evidence-2', 1, 'seller-evidence-owner', 'TEXT',
        3, '公开说明', '内部说明',
        2000, 5000, 20000,
        'PUBLISHED', NULL, NULL,
        'staff-pre-sales', NULL,
        2, 1000, 3000, 3000, 3000, NULL, NULL,
        0, 1, 1000, 'PRODUCT_DEFAULT', NULL
      ),
      (
        'demand-evidence-3', 'seller-org-evidence',
        'store-evidence', 'JP',
        'product-evidence-3', 1, 'seller-evidence-owner', 'VIDEO',
        3, '公开说明', '内部说明',
        2000, 5000, 20000,
        'PUBLISHED', NULL, NULL,
        'staff-pre-sales', NULL,
        2, 1000, 3000, 3000, 3000, NULL, NULL,
        1, 0, 1000, 'PRODUCT_DEFAULT', NULL
      );

    INSERT INTO product_reservations (
      id, demand_batch_id, buyer_customer_id,
      organization_id, store_id, product_id,
      product_version_no, marketplace_code,
      status, precheck_snapshot_json,
      hold_expires_at, order_deadline_snapshot,
      version, submitted_at, updated_at,
      decided_by_staff_id, decision_reason, decided_at,
      cancelled_at, expired_at, reopened_count
      , buyer_self_pay_bps_snapshot,
      reference_order_amount_jpy_snapshot,
      estimated_self_pay_jpy_snapshot,
      estimated_refundable_principal_jpy_snapshot,
      buyer_self_pay_accepted_at,
      buyer_self_pay_accepted_demand_version
    ) VALUES
      (
        'reservation-1', 'demand-evidence-1', 'buyer-1',
        'seller-org-evidence', 'store-evidence',
        'product-evidence-1', 1, 'JP',
        'APPROVED', '{}', 5000, 20000,
        2, 4000, 6000,
        'staff-pre-sales', NULL, 6000,
        NULL, NULL, 0, 1000, 1980, 198, 1782, 4000, 2
      ),
      (
        'reservation-2', 'demand-evidence-2', 'buyer-2',
        'seller-org-evidence', 'store-evidence',
        'product-evidence-2', 1, 'JP',
        'APPROVED', '{}', 5000, 20000,
        2, 4000, 6000,
        'staff-pre-sales', NULL, 6000,
        NULL, NULL, 0, 1000, 1980, 198, 1782, 4000, 2
      ),
      (
        'reservation-pending', 'demand-evidence-3', 'buyer-1',
        'seller-org-evidence', 'store-evidence',
        'product-evidence-3', 1, 'JP',
        'PENDING_REVIEW', '{}', 9000, 20000,
        1, 4000, 4000,
        NULL, NULL, NULL,
        NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL
      );
  `);
  seedActiveInstruction(database, {
    suffix: '1',
    reservationId: 'reservation-1',
    buyerCustomerId: 'buyer-1',
    productId: 'product-evidence-1',
    productVersionId: 'product-evidence-1-v1',
  });
  seedActiveInstruction(database, {
    suffix: '2',
    reservationId: 'reservation-2',
    buyerCustomerId: 'buyer-2',
    productId: 'product-evidence-2',
    productVersionId: 'product-evidence-2-v1',
  });
}

function seedActiveInstruction(
  database: SqliteDatabase,
  input: {
    suffix: string;
    reservationId: string;
    buyerCustomerId: string;
    productId: string;
    productVersionId: string;
  },
): void {
  const instructionId = `instruction-${input.suffix}`;
  const versionId = `instruction-version-${input.suffix}`;
  const intentId = `instruction-main-intent-${input.suffix}`;
  const objectId = `instruction-main-object-${input.suffix}`;
  const linkId = `instruction-main-link-${input.suffix}`;
  database.prepare(`
    INSERT INTO order_instructions (
      id, reservation_id, buyer_customer_id, marketplace_code,
      status, current_version_no, version, published_at,
      initial_deadline_at, resubmission_deadline_at,
      expired_at, cancelled_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'JP', 'UNPUBLISHED', 0, 1, NULL,
      NULL, NULL, NULL, NULL, NULL, 6000, 6000)
  `).bind(instructionId, input.reservationId, input.buyerCustomerId).run();
  database.prepare(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility, status,
      requested_file_count, manifest_hash, version, expires_at,
      failure_code, created_at, updated_at, completed_at
    ) VALUES (?, 'STAFF', 'staff-pre-sales', 'PRODUCT_IMAGE',
      'BUYER_VISIBLE', 'ISSUED', 1, ?, 1, 30000000,
      NULL, 5000, 5000, NULL)
  `).bind(intentId, input.suffix.padStart(64, '0')).run();
  database.prepare(`
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size,
      status, upload_token_hash, upload_expires_at, uploaded_byte_size,
      detected_mime, uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at, uploaded_at,
      verified_at, deleted_at
    ) VALUES (?, ?, 1, 'PRODUCT_IMAGE', 'BUYER_VISIBLE', ?,
      'main.png', 'png', 'image/png', 8, 'RESERVED', ?, 30000000,
      NULL, NULL, NULL, NULL, 0, NULL, 1, 5000, 5000,
      NULL, NULL, NULL)
  `).bind(
    objectId,
    intentId,
    `files/v1/2026/08/instruction-main-${input.suffix.padEnd(30, 'x')}`,
    'a'.repeat(64),
  ).run();
  database.prepare(`
    UPDATE file_upload_intents
    SET status='VERIFIED', version=2, updated_at=5001, completed_at=5001
    WHERE id=?
  `).bind(intentId).run();
  database.prepare(`
    UPDATE file_objects
    SET status='VERIFIED', version=2, uploaded_byte_size=8,
        detected_mime='image/png', uploaded_sha256=?,
        updated_at=5001, uploaded_at=5001, verified_at=5001
    WHERE id=?
  `).bind('b'.repeat(64), objectId).run();
  database.prepare(`
    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (?, ?, 'ORDER_INSTRUCTION_VERSION', ?, 'PRODUCT_IMAGE',
      'BUYER_VISIBLE', 'STAFF', 'staff-pre-sales', 6000,
      'EXPLICIT_AUDIENCES', NULL, NULL)
  `).bind(linkId, objectId, versionId).run();
  database.prepare(`
    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type, buyer_customer_id,
      seller_organization_id, staff_permission_code, staff_scope_type,
      staff_team_id, granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES (?, ?, 'BUYER', ?, NULL, NULL, NULL, NULL,
      'STAFF', 'staff-pre-sales', 6000, NULL, NULL)
  `).bind(
    `instruction-main-grant-${input.suffix}`,
    linkId,
    input.buyerCustomerId,
  ).run();
  database.prepare(`
    INSERT INTO order_instruction_versions (
      id, instruction_id, version_no, reservation_id,
      product_id, product_version_id, product_version_no,
      main_image_file_entity_link_id, store_display_name_snapshot,
      demand_buyer_visible_notes_snapshot, staff_public_note,
      reference_order_amount_jpy, buyer_self_pay_bps,
      estimated_self_pay_jpy, estimated_refundable_principal_jpy,
      color_spec_mode, content_hash, generator_version,
      published_by_staff_id, published_at, initial_deadline_at, created_at
    ) VALUES (?, ?, 1, ?, ?, ?, 1, ?, '证据测试店铺',
      '公开说明', NULL, 1980, 1000, 198, 1782,
      'MAIN_IMAGE_VARIANT', ?, 'fixture-v1',
      'staff-pre-sales', 6000, 21606000, 6000)
  `).bind(
    versionId,
    instructionId,
    input.reservationId,
    input.productId,
    input.productVersionId,
    linkId,
    'c'.repeat(64),
  ).run();
  database.prepare(`
    UPDATE order_instructions
    SET status='ACTIVE', current_version_no=1, version=2,
        published_at=6000, initial_deadline_at=21606000,
        updated_at=6001
    WHERE id=? AND version=1
  `).bind(instructionId).run();
}

function seedVerifiedEvidenceFile(
  database: SqliteDatabase,
  input: {
    suffix: number;
    ownerBuyerId: string;
    visibility?: 'INTERNAL_ONLY' | 'BUYER_VISIBLE' | 'SELLER_VISIBLE';
    purpose?: 'ORDER_EVIDENCE' | 'PRODUCT_APPLICATION_IMAGE';
  },
): void {
  const visibility = input.visibility ?? 'BUYER_VISIBLE';
  const purpose = input.purpose ?? 'ORDER_EVIDENCE';
  const hex = input.suffix.toString(16).padStart(64, '0');
  const uploadIntentId = `file-intent-${input.suffix}`;
  const fileObjectId = `file-object-${input.suffix}`;
  database.exec(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id,
      purpose, visibility, status,
      requested_file_count, manifest_hash,
      version, expires_at, failure_code,
      created_at, updated_at, completed_at
    ) VALUES (
      '${uploadIntentId}', 'BUYER_CUSTOMER', '${input.ownerBuyerId}',
      '${purpose}', '${visibility}', 'ISSUED',
      1, '${hex}', 1, 100000, NULL,
      1000, 1000, NULL
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
      100000, NULL, NULL, NULL,
      NULL, 0, NULL, 1,
      1000, 1000, NULL, NULL, NULL
    );

    UPDATE file_upload_intents
    SET status='VERIFIED', version=2,
        updated_at=2000, completed_at=2000
    WHERE id='${uploadIntentId}';

    UPDATE file_objects
    SET status='VERIFIED', version=3,
        uploaded_byte_size=8,
        detected_mime='image/png',
        uploaded_sha256='${hex}',
        updated_at=2000,
        uploaded_at=1500,
        verified_at=2000
    WHERE id='${fileObjectId}';
  `);
}

function seedUnverifiedEvidenceFile(
  database: SqliteDatabase,
  input: {
    suffix: number;
    ownerBuyerId: string;
  },
): void {
  const hex = input.suffix.toString(16).padStart(64, '0');
  database.exec(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id,
      purpose, visibility, status,
      requested_file_count, manifest_hash,
      version, expires_at, failure_code,
      created_at, updated_at, completed_at
    ) VALUES (
      'file-intent-${input.suffix}',
      'BUYER_CUSTOMER', '${input.ownerBuyerId}',
      'ORDER_EVIDENCE', 'BUYER_VISIBLE', 'ISSUED',
      1, '${hex}', 1, 100000, NULL,
      1000, 1000, NULL
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
      'file-object-${input.suffix}',
      'file-intent-${input.suffix}', 1,
      'ORDER_EVIDENCE', 'BUYER_VISIBLE',
      'files/v1/2026/08/order_evidence/${hex}',
      'evidence-${input.suffix}.png', 'png', 'image/png',
      8, 'RESERVED', '${hex}',
      100000, NULL, NULL, NULL,
      NULL, 0, NULL, 1,
      1000, 1000, NULL, NULL, NULL
    );
  `);
}
