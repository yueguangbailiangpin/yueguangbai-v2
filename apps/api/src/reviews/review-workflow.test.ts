import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  FilePurpose,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import type { FileAuthorizationService } from '../files/authorization';
import { confirmFormalOrder } from '../formal-orders/confirm-formal-order';
import type { FormalOrderStaffActor } from '../formal-orders/formal-order-shared';
import {
  approveReview,
  rejectReview,
  requestReviewChanges,
} from './decide-review';
import type {
  BuyerReviewActor,
  StaffReviewActor,
} from './review-shared';
import { submitReviewEvidence } from './submit-review-evidence';
import { withdrawReview } from './withdraw-review';

const NOW = Date.UTC(2026, 7, 1, 0, 0, 0);
const BUSINESS_DATE = '2026-08-01';
const LATER_BUSINESS_DATE = '2026-08-02';
const allowAllFiles: FileAuthorizationService = {
  assertCanCreateUpload: () => {},
  assertCanUpload: () => {},
  assertCanCompleteUpload: () => {},
  assertCanLink: () => {},
  assertCanRead: () => {},
};

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Phase 5A review evidence workflow', () => {
  it('submits a buyer-owned VERIFIED review file with exact explicit audiences', async () => {
    const fixture = await setupConfirmedOrder();
    seedReviewFile(database!, {
      suffix: 1,
      ownerBuyerId: 'buyer-review-1',
    });

    const result = await submitReviewEvidence(
      database!,
      allowAllFiles,
      {
        formalOrderId: fixture.formalOrderId,
        expectedVersion: 0,
        reviewType: 'IMAGE',
        evidenceFiles: [{
          fileObjectId: 'review-file-1',
          expectedFileVersion: 3,
        }],
        buyerNote: '评论截图与链接已提交',
      },
      buyerCommand('review:submit:0001'),
    );

    expect(result).toMatchObject({
      formal_order_id: fixture.formalOrderId,
      buyer_customer_id: 'buyer-review-1',
      review_type: 'IMAGE',
      status: 'PENDING_REVIEW',
      version: 1,
      current_evidence_version_no: 1,
      replayed: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /object_key|signed_url|https?:\/\//iu,
    );

    const linkId = result.evidence_files[0]?.file_entity_link_id;
    expect(linkId).toBeTruthy();
    const link = await database!.prepare(`
      SELECT authorization_mode, entity_type, entity_id, purpose
      FROM file_entity_links
      WHERE id=?
    `).bind(linkId).first<{
      authorization_mode: string;
      entity_type: string;
      entity_id: string;
      purpose: string;
    }>();
    expect(link).toEqual({
      authorization_mode: 'EXPLICIT_AUDIENCES',
      entity_type: 'REVIEW',
      entity_id: result.current_evidence_version_id,
      purpose: 'REVIEW_EVIDENCE',
    });

    const grants = await database!.prepare(`
      SELECT
        subject_type,
        buyer_customer_id,
        seller_organization_id,
        staff_permission_code,
        staff_scope_type
      FROM file_entity_audience_grants
      WHERE file_entity_link_id=?
      ORDER BY subject_type
    `).bind(linkId).all();
    expect(grants.results).toEqual([
      {
        subject_type: 'BUYER',
        buyer_customer_id: 'buyer-review-1',
        seller_organization_id: null,
        staff_permission_code: null,
        staff_scope_type: null,
      },
      {
        subject_type: 'SELLER_ORGANIZATION',
        buyer_customer_id: null,
        seller_organization_id: 'seller-org-review',
        staff_permission_code: null,
        staff_scope_type: null,
      },
      {
        subject_type: 'STAFF_INTERNAL',
        buyer_customer_id: null,
        seller_organization_id: null,
        staff_permission_code: 'REVIEW_VIEW',
        staff_scope_type: 'GLOBAL',
      },
    ]);
  });

  it('enforces order authority, reviewType, file status, purpose, owner, and version', async () => {
    const fixture = await setupConfirmedOrder();
    seedReviewFile(database!, { suffix: 2, ownerBuyerId: 'buyer-review-1' });

    await expect(submitReviewEvidence(
      database!,
      allowAllFiles,
      submitInput(fixture.formalOrderId, 'review-file-2'),
      buyerCommand('review:authority:other', 'buyer-review-other'),
    )).rejects.toMatchObject({
      code: 'FORMAL_ORDER_NOT_FOUND',
      status: 404,
    });
    await expect(submitReviewEvidence(
      database!,
      allowAllFiles,
      {
        ...submitInput(fixture.formalOrderId, 'review-file-2'),
        reviewType: 'TEXT',
      },
      buyerCommand('review:type:mismatch'),
    )).rejects.toMatchObject({
      code: 'FORMAL_ORDER_STATE_CONFLICT',
      status: 409,
    });
    await expect(submitReviewEvidence(
      database!,
      allowAllFiles,
      {
        ...submitInput(fixture.formalOrderId, 'review-file-2'),
        evidenceFiles: [{
          fileObjectId: 'review-file-2',
          expectedFileVersion: 2,
        }],
      },
      buyerCommand('review:file:version'),
    )).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    seedReviewFile(database!, {
      suffix: 3,
      ownerBuyerId: 'buyer-review-other',
    });
    await expect(submitReviewEvidence(
      database!,
      allowAllFiles,
      submitInput(fixture.formalOrderId, 'review-file-3'),
      buyerCommand('review:file:owner'),
    )).rejects.toMatchObject({ code: 'REVIEW_FILE_CONFLICT' });

    seedReviewFile(database!, {
      suffix: 4,
      ownerBuyerId: 'buyer-review-1',
      purpose: 'ORDER_EVIDENCE',
    });
    await expect(submitReviewEvidence(
      database!,
      allowAllFiles,
      submitInput(fixture.formalOrderId, 'review-file-4'),
      buyerCommand('review:file:purpose'),
    )).rejects.toMatchObject({ code: 'REVIEW_FILE_CONFLICT' });

    seedReviewFile(database!, {
      suffix: 5,
      ownerBuyerId: 'buyer-review-1',
      verified: false,
    });
    await expect(submitReviewEvidence(
      database!,
      allowAllFiles,
      {
        ...submitInput(fixture.formalOrderId, 'review-file-5'),
        evidenceFiles: [{
          fileObjectId: 'review-file-5',
          expectedFileVersion: 1,
        }],
      },
      buyerCommand('review:file:unverified'),
    )).rejects.toMatchObject({ code: 'FILE_NOT_VERIFIED' });
  });

  it('supports changes requested, monotonic evidence versions, and snapshot-only approval events', async () => {
    const fixture = await setupConfirmedOrder();
    seedReviewFile(database!, { suffix: 6, ownerBuyerId: 'buyer-review-1' });
    const submitted = await submitReviewEvidence(
      database!,
      allowAllFiles,
      submitInput(fixture.formalOrderId, 'review-file-6'),
      buyerCommand('review:state:submit'),
    );
    const changes = await requestReviewChanges(
      database!,
      {
        reviewCaseId: submitted.review_case_id,
        expectedVersion: 1,
        publicReason: '请补充包含订单信息的完整截图',
        internalNote: '证据不完整',
      },
      staffCommand(afterSalesActor(), 'review:state:changes'),
    );
    expect(changes).toMatchObject({
      status: 'CHANGES_REQUESTED',
      version: 2,
      current_evidence_version_no: 1,
    });

    seedReviewFile(database!, { suffix: 7, ownerBuyerId: 'buyer-review-1' });
    const resubmitted = await submitReviewEvidence(
      database!,
      allowAllFiles,
      {
        formalOrderId: fixture.formalOrderId,
        expectedVersion: 2,
        reviewType: 'IMAGE',
        evidenceFiles: [{
          fileObjectId: 'review-file-7',
          expectedFileVersion: 3,
        }],
      },
      buyerCommand('review:state:resubmit'),
    );
    expect(resubmitted).toMatchObject({
      review_case_id: submitted.review_case_id,
      status: 'PENDING_REVIEW',
      version: 3,
      current_evidence_version_no: 2,
    });

    seedLaterPricingRules(database!);
    const approved = await approveReview(
      database!,
      {
        reviewCaseId: submitted.review_case_id,
        expectedVersion: 3,
        internalNote: '人工核验通过',
      },
      staffCommand(
        ownerActor(),
        'review:state:approve',
        NOW + 24 * 60 * 60 * 1000 + 20_000,
      ),
    );
    expect(approved).toMatchObject({
      status: 'APPROVED',
      version: 4,
      current_evidence_version_no: 2,
      financial_events: [
        {
          event_type: 'BUYER_REFUND_BECAME_DUE',
          amount_cny_fen: '48840',
          formal_order_financial_snapshot_id: fixture.snapshotId,
        },
        {
          event_type: 'SELLER_SERVICE_FEE_ACCRUED',
          amount_cny_fen: '2500',
          formal_order_financial_snapshot_id: fixture.snapshotId,
        },
      ],
    });

    const events = await database!.prepare(`
      SELECT event_type, amount_cny_fen
      FROM review_events
      WHERE review_case_id=?
        AND event_type IN (
          'REVIEW_APPROVED',
          'BUYER_REFUND_BECAME_DUE',
          'SELLER_SERVICE_FEE_ACCRUED'
        )
      ORDER BY event_type
    `).bind(submitted.review_case_id).all();
    expect(events.results).toEqual([
      { event_type: 'BUYER_REFUND_BECAME_DUE', amount_cny_fen: 48840 },
      { event_type: 'REVIEW_APPROVED', amount_cny_fen: null },
      { event_type: 'SELLER_SERVICE_FEE_ACCRUED', amount_cny_fen: 2500 },
    ]);
  });

  it('is idempotent, rejects duplicate approval, and keeps terminal states terminal', async () => {
    const fixture = await setupConfirmedOrder();
    seedReviewFile(database!, { suffix: 8, ownerBuyerId: 'buyer-review-1' });
    const key = 'review:idempotency:submit';
    const first = await submitReviewEvidence(
      database!,
      allowAllFiles,
      submitInput(fixture.formalOrderId, 'review-file-8'),
      buyerCommand(key),
    );
    const replay = await submitReviewEvidence(
      database!,
      allowAllFiles,
      submitInput(fixture.formalOrderId, 'review-file-8'),
      buyerCommand(key, 'buyer-review-1', NOW + 1),
    );
    expect(replay).toEqual({ ...first, replayed: true });

    const approvalKey = 'review:idempotency:approve';
    const approved = await approveReview(
      database!,
      { reviewCaseId: first.review_case_id, expectedVersion: 1 },
      staffCommand(ownerActor(), approvalKey),
    );
    const approvalReplay = await approveReview(
      database!,
      { reviewCaseId: first.review_case_id, expectedVersion: 1 },
      staffCommand(ownerActor(), approvalKey, NOW + 2),
    );
    expect(approvalReplay).toEqual({ ...approved, replayed: true });

    await expect(approveReview(
      database!,
      { reviewCaseId: first.review_case_id, expectedVersion: 2 },
      staffCommand(ownerActor(), 'review:duplicate:approve'),
    )).rejects.toMatchObject({ code: 'REVIEW_STATE_CONFLICT' });
    await expect(withdrawReview(
      database!,
      { reviewCaseId: first.review_case_id, expectedVersion: 2 },
      buyerCommand('review:approved:withdraw'),
    )).rejects.toMatchObject({ code: 'REVIEW_STATE_CONFLICT' });
  });

  it('allows buyer withdrawal in allowed states and makes rejection terminal', async () => {
    const fixture = await setupConfirmedOrder();
    seedReviewFile(database!, { suffix: 9, ownerBuyerId: 'buyer-review-1' });
    const submitted = await submitReviewEvidence(
      database!,
      allowAllFiles,
      submitInput(fixture.formalOrderId, 'review-file-9'),
      buyerCommand('review:withdraw:submit'),
    );
    const withdrawn = await withdrawReview(
      database!,
      { reviewCaseId: submitted.review_case_id, expectedVersion: 1 },
      buyerCommand('review:withdraw:command'),
    );
    expect(withdrawn.status).toBe('WITHDRAWN');

    database!.close();
    const rejectedFixture = await setupConfirmedOrder();
    seedReviewFile(database!, { suffix: 10, ownerBuyerId: 'buyer-review-1' });
    const pending = await submitReviewEvidence(
      database!,
      allowAllFiles,
      submitInput(rejectedFixture.formalOrderId, 'review-file-10'),
      buyerCommand('review:reject:submit'),
    );
    const rejected = await rejectReview(
      database!,
      {
        reviewCaseId: pending.review_case_id,
        expectedVersion: 1,
        publicReason: '提交内容不属于该正式订单',
      },
      staffCommand(afterSalesActor(), 'review:reject:command'),
    );
    expect(rejected.status).toBe('REJECTED');
    await expect(withdrawReview(
      database!,
      { reviewCaseId: pending.review_case_id, expectedVersion: 2 },
      buyerCommand('review:reject:withdraw'),
    )).rejects.toMatchObject({ code: 'REVIEW_STATE_CONFLICT' });
  });

  it('requires owner/after_sales plus REVIEW_DECIDE, including effective personal deny', async () => {
    const fixture = await setupConfirmedOrder();
    seedReviewFile(database!, { suffix: 11, ownerBuyerId: 'buyer-review-1' });
    const submitted = await submitReviewEvidence(
      database!,
      allowAllFiles,
      submitInput(fixture.formalOrderId, 'review-file-11'),
      buyerCommand('review:permission:submit'),
    );

    await expect(approveReview(
      database!,
      { reviewCaseId: submitted.review_case_id, expectedVersion: 1 },
      staffCommand(otherRoleActor(), 'review:permission:role'),
    )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(approveReview(
      database!,
      { reviewCaseId: submitted.review_case_id, expectedVersion: 1 },
      staffCommand(afterSalesDeniedActor(), 'review:permission:deny'),
    )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('rolls back case, explicit links, grants, events, audit, and outbox on failure', async () => {
    const fixture = await setupConfirmedOrder();
    seedReviewFile(database!, { suffix: 12, ownerBuyerId: 'buyer-review-1' });
    database!.exec(`
      CREATE TRIGGER trg_phase5a_test_bridge_failure
      BEFORE INSERT ON review_evidence_version_files
      BEGIN
        SELECT RAISE(ABORT, 'phase5a_test_bridge_failure');
      END;
    `);

    await expect(submitReviewEvidence(
      database!,
      allowAllFiles,
      submitInput(fixture.formalOrderId, 'review-file-12'),
      buyerCommand('review:atomic:submit'),
    )).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      status: 503,
    });
    const facts = await database!.prepare(`
      SELECT
        (SELECT COUNT(*) FROM review_cases) AS review_cases,
        (SELECT COUNT(*) FROM review_evidence_versions) AS versions,
        (SELECT COUNT(*) FROM review_evidence_version_files) AS files,
        (SELECT COUNT(*) FROM review_events) AS review_events,
        (SELECT COUNT(*) FROM file_entity_links
          WHERE entity_type='REVIEW') AS links,
        (SELECT COUNT(*) FROM file_entity_audience_grants) AS grants,
        (SELECT COUNT(*) FROM file_audience_events) AS audience_events,
        (SELECT COUNT(*) FROM audit_events
          WHERE aggregate_type='REVIEW_CASE') AS review_audit,
        (SELECT COUNT(*) FROM integration_outbox
          WHERE aggregate_type='REVIEW_CASE') AS review_outbox
    `).first();
    expect(facts).toEqual({
      review_cases: 0,
      versions: 0,
      files: 0,
      review_events: 0,
      links: 0,
      grants: 0,
      audience_events: 0,
      review_audit: 0,
      review_outbox: 0,
    });
  });

  it('keeps events immutable and creates no actual payment, settlement, profit, or Amazon automation facts', async () => {
    const fixture = await setupConfirmedOrder();
    seedReviewFile(database!, { suffix: 13, ownerBuyerId: 'buyer-review-1' });
    const submitted = await submitReviewEvidence(
      database!,
      allowAllFiles,
      submitInput(fixture.formalOrderId, 'review-file-13'),
      buyerCommand('review:immutable:submit'),
    );
    await approveReview(
      database!,
      { reviewCaseId: submitted.review_case_id, expectedVersion: 1 },
      staffCommand(ownerActor(), 'review:immutable:approve'),
    );

    await expect(database!.prepare(`
      UPDATE review_events SET created_at=created_at+1
    `).run()).rejects.toThrow('review_events_are_immutable');
    await expect(database!.prepare(`
      DELETE FROM review_events
    `).run()).rejects.toThrow('review_events_are_immutable');

    const forbiddenTables = await database!.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type='table'
        AND name IN (
          'buyer_refunds',
          'seller_settlements',
          'internal_settlements',
          'review_profits',
          'amazon_accounts',
          'amazon_review_automation'
        )
    `).all();
    expect(forbiddenTables.results).toEqual([]);
    const state = await database!.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).first<{ schema_version: number }>();
    expect(state?.schema_version).toBe(16);
  });
});

function submitInput(formalOrderId: string, fileObjectId: string) {
  return {
    formalOrderId,
    expectedVersion: 0,
    reviewType: 'IMAGE' as const,
    evidenceFiles: [{ fileObjectId, expectedFileVersion: 3 }],
  };
}

function buyerCommand(
  idempotencyKey: string,
  buyerCustomerId = 'buyer-review-1',
  now = NOW + 10_000,
) {
  return {
    actor: { buyerCustomerId } satisfies BuyerReviewActor,
    idempotencyKey,
    requestId: `request:${idempotencyKey}`,
    now,
  };
}

function staffCommand(
  actor: StaffReviewActor,
  idempotencyKey: string,
  now = NOW + 20_000,
) {
  return {
    actor,
    idempotencyKey,
    requestId: `request:${idempotencyKey}`,
    now,
  };
}

function reviewActor(
  roles: readonly StaffRoleCode[],
  permissions: readonly StaffPermissionCode[],
  staffId: string,
): StaffReviewActor {
  return {
    staffId,
    displayName: staffId,
    roles,
    permissions: new Set(permissions),
  };
}

function ownerActor(): StaffReviewActor {
  return reviewActor(['owner'], ['REVIEW_DECIDE'], 'staff-review-owner');
}

function afterSalesActor(): StaffReviewActor {
  return reviewActor(
    ['after_sales'],
    ['REVIEW_DECIDE'],
    'staff-review-after-sales',
  );
}

function afterSalesDeniedActor(): StaffReviewActor {
  return reviewActor(['after_sales'], [], 'staff-review-after-sales');
}

function otherRoleActor(): StaffReviewActor {
  return reviewActor(
    ['seller_ops'],
    ['REVIEW_DECIDE'],
    'staff-review-other',
  );
}

async function setupConfirmedOrder(): Promise<{
  formalOrderId: string;
  snapshotId: string;
}> {
  database = createMigratedTestDatabase();
  seedFormalOrderPrerequisites(database);
  const result = await confirmFormalOrder(
    database,
    {
      orderEvidenceSubmissionId: 'evidence-review-submission',
      expectedVersion: 2,
    },
    {
      actor: {
        staffId: 'staff-review-pre-sales',
        displayName: '售前',
        roles: ['pre_sales'],
        permissions: new Set(['ORDER_CONFIRM']),
      } satisfies FormalOrderStaffActor,
      idempotencyKey: 'formal-order:review-fixture',
      requestId: 'request:formal-order:review-fixture',
      now: NOW,
    },
  );
  return {
    formalOrderId: result.formal_order_id,
    snapshotId: result.financial_snapshot.snapshot_id,
  };
}

function seedFormalOrderPrerequisites(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      ('staff-review-pre-sales', '售前', 'ACTIVE', 1, 1, 1000, 1000, NULL),
      ('staff-review-owner', '负责人', 'ACTIVE', 1, 1, 1000, 1000, NULL),
      ('staff-review-after-sales', '售后', 'ACTIVE', 1, 1, 1000, 1000, NULL),
      ('staff-review-other', '其他', 'ACTIVE', 1, 1, 1000, 1000, NULL);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-review', 'JP', 'ido-mango-9301',
      'seller-channel-ido-mango', 'seller-channel-ido-mango',
      9301, '评论流程测试卖家', 'ACTIVE',
      1, 1000, 1000, 1000, NULL, 2
    );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('seller-review-subject', 'SELLER_ORG_MEMBER', 1000),
      ('buyer-review-subject-1', 'BUYER_CUSTOMER', 1000),
      ('buyer-review-subject-other', 'BUYER_CUSTOMER', 1000);

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'seller-review-owner', 'seller-review-subject',
      'seller-org-review', 1, 'ido-mango-9301-1',
      '负责人', 'OWNER', 1, 'ACTIVE', 1,
      1000, 1000, 1000, NULL
    );

    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'buyer-channel-review', 'R', '评论流程测试渠道',
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
        'buyer-review-1', 'buyer-review-subject-1', 'JP',
        'buyer-channel-review', NULL, NULL, NULL,
        '评论买家', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'buyer-review-other', 'buyer-review-subject-other', 'JP',
        'buyer-channel-review', '20260731R99', 99, '2026-07-31',
        '其他买家', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-review', 'seller-org-review', 'JP',
      '评论流程测试店铺', '评论流程测试店铺', 'ACTIVE',
      1, 1000, 1000, NULL
    );

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'product-review', 'seller-org-review', 'store-review', 'JP',
      'B0REVIEW01', 'B0REVIEW01', 'ACTIVE',
      1, 1, 1000, 1000, NULL
    );

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ) VALUES (
      'product-review-v1', 'product-review', 1,
      '评论流程测试产品', '[]', NULL, NULL, NULL,
      'staff-review-pre-sales', 1000
    );

    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code,
      product_id, product_version_no,
      submitted_by_member_id, task_type,
      target_quantity, buyer_visible_notes, seller_notes,
      open_at, reservation_deadline, order_deadline,
      status, review_reason, close_reason,
      reviewed_by_staff_id, closed_by_staff_id,
      version, submitted_at, updated_at,
      reviewed_at, published_at, withdrawn_at, closed_at,
      held_reservation_count, approved_reservation_count
    ) VALUES (
      'demand-review', 'seller-org-review', 'store-review', 'JP',
      'product-review', 1, 'seller-review-owner', 'IMAGE',
      10, NULL, NULL, 2000, 5000, 20000,
      'PUBLISHED', NULL, NULL, 'staff-review-pre-sales', NULL,
      2, 1000, 3000, 3000, 3000, NULL, NULL, 0, 1
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
    ) VALUES (
      'reservation-review', 'demand-review', 'buyer-review-1',
      'seller-org-review', 'store-review', 'product-review', 1, 'JP',
      'APPROVED', '{}', 5000, 20000, 2, 4000, 6000,
      'staff-review-pre-sales', NULL, 6000, NULL, NULL, 0
    );

    INSERT INTO order_evidence_submissions (
      id, reservation_id, buyer_customer_id, marketplace_code,
      status, current_version_no, version,
      public_change_reason, internal_review_note,
      submitted_at, updated_at,
      verified_by_staff_id, verified_at,
      withdrawn_at, consumed_at, created_at
    ) VALUES (
      'evidence-review-submission', 'reservation-review',
      'buyer-review-1', 'JP',
      'PENDING_VERIFICATION', 1, 1, NULL, NULL,
      7000, 7000, NULL, NULL, NULL, NULL, 7000
    );

    INSERT INTO order_evidence_versions (
      id, submission_id, reservation_id, buyer_customer_id,
      marketplace_code, version_no,
      amazon_order_number_raw, amazon_order_number_normalized,
      final_paid_jpy, submitted_by_buyer_id, buyer_note, created_at
    ) VALUES (
      'evidence-review-version-1', 'evidence-review-submission',
      'reservation-review', 'buyer-review-1', 'JP', 1,
      '123-1234567-1234567', '123-1234567-1234567',
      8880, 'buyer-review-1', NULL, 7000
    );

    UPDATE order_evidence_submissions
    SET status='VERIFIED', version=2,
        verified_by_staff_id='staff-review-pre-sales',
        verified_at=8000, updated_at=8000
    WHERE id='evidence-review-submission';

    INSERT INTO buyer_daily_exchange_rates (
      id, business_date, version_no, status, cny_per_jpy_e8,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      'buyer-review-rate-v1', '${BUSINESS_DATE}', 1,
      'SUBMITTED', 5500000,
      'staff-review-owner', 1000, 1,
      NULL, NULL, NULL, NULL, NULL
    );
    UPDATE buyer_daily_exchange_rates
    SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='staff-review-owner', confirmed_at=2000
    WHERE id='buyer-review-rate-v1';

    INSERT INTO seller_agreement_rate_versions (
      id, organization_id, review_type, version_no,
      status, cny_per_jpy_e8, effective_from,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      'seller-review-rate-v1', 'seller-org-review', NULL, 1,
      'SUBMITTED', 6000000, 3000,
      'staff-review-owner', 1000, 1,
      NULL, NULL, NULL, NULL, NULL
    );
    UPDATE seller_agreement_rate_versions
    SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='staff-review-owner', confirmed_at=2000
    WHERE id='seller-review-rate-v1';

    INSERT INTO seller_service_fee_versions (
      id, organization_id, review_type, version_no,
      status, fee_cny_fen, effective_from,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      'service-review-fee-v1', 'seller-org-review', 'IMAGE', 1,
      'SUBMITTED', 2500, 3000,
      'staff-review-owner', 1000, 1,
      NULL, NULL, NULL, NULL, NULL
    );
    UPDATE seller_service_fee_versions
    SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='staff-review-owner', confirmed_at=2000
    WHERE id='service-review-fee-v1';
  `);
}

function seedLaterPricingRules(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO buyer_daily_exchange_rates (
      id, business_date, version_no, status, cny_per_jpy_e8,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      'buyer-review-rate-v2', '${LATER_BUSINESS_DATE}', 1,
      'SUBMITTED', 9999999,
      'staff-review-owner', ${NOW + 1}, 1,
      NULL, NULL, NULL, NULL, NULL
    );
    UPDATE buyer_daily_exchange_rates
    SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='staff-review-owner',
        confirmed_at=${NOW + 2}
    WHERE id='buyer-review-rate-v2';

    INSERT INTO seller_service_fee_versions (
      id, organization_id, review_type, version_no,
      status, fee_cny_fen, effective_from,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      'service-review-fee-v2', 'seller-org-review', 'IMAGE', 2,
      'SUBMITTED', 999999, ${NOW + 10_000},
      'staff-review-owner', ${NOW + 1}, 1,
      NULL, NULL, NULL, NULL, NULL
    );
    UPDATE seller_service_fee_versions
    SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='staff-review-owner',
        confirmed_at=${NOW + 2}
    WHERE id='service-review-fee-v2';
  `);
}

function seedReviewFile(
  db: SqliteDatabase,
  input: {
    suffix: number;
    ownerBuyerId: string;
    purpose?: FilePurpose;
    verified?: boolean;
  },
): void {
  const purpose = input.purpose ?? 'REVIEW_EVIDENCE';
  const verified = input.verified ?? true;
  const hex = input.suffix.toString(16).padStart(64, '0');
  const intentId = `review-intent-${input.suffix}`;
  const fileId = `review-file-${input.suffix}`;
  const objectKey = `files/v1/2026/08/review_evidence/${hex}`;
  db.exec(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id,
      purpose, visibility, status,
      requested_file_count, manifest_hash,
      version, expires_at, failure_code,
      created_at, updated_at, completed_at
    ) VALUES (
      '${intentId}', 'BUYER_CUSTOMER', '${input.ownerBuyerId}',
      '${purpose}', 'BUYER_VISIBLE', 'ISSUED',
      1, '${hex}', 1, ${NOW + 3600000}, NULL,
      ${NOW - 100}, ${NOW - 100}, NULL
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
      '${fileId}', '${intentId}', 1,
      '${purpose}', 'BUYER_VISIBLE', '${objectKey}',
      'review-${input.suffix}.png', 'png', 'image/png',
      8, 'RESERVED', '${hex}', ${NOW + 3600000},
      NULL, NULL, NULL, NULL, 0, NULL, 1,
      ${NOW - 100}, ${NOW - 100}, NULL, NULL, NULL
    );
  `);
  if (!verified) return;
  db.exec(`
    UPDATE file_upload_intents
    SET status='VERIFIED', version=2,
        updated_at=${NOW}, completed_at=${NOW}
    WHERE id='${intentId}';
    UPDATE file_objects
    SET status='VERIFIED', version=3,
        uploaded_byte_size=8,
        detected_mime='image/png',
        uploaded_sha256='${hex}',
        updated_at=${NOW},
        uploaded_at=${NOW - 1},
        verified_at=${NOW}
    WHERE id='${fileId}';
  `);
}
