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
import { approveReview } from '../reviews/decide-review';
import type {
  BuyerReviewActor,
  StaffReviewActor,
} from '../reviews/review-shared';
import { submitReviewEvidence } from '../reviews/submit-review-evidence';
import { ensureBuyerRefundObligationFromDueEvent } from './ensure-buyer-refund-obligation';
import { getBuyerRefundLedger } from './get-buyer-refund-ledger';
import { recordBuyerRefundPayment } from './record-buyer-refund-payment';
import { reverseBuyerRefundPayment } from './reverse-buyer-refund-payment';
import type { BuyerRefundStaffActor } from './buyer-refund-shared';

const NOW = Date.UTC(2026, 7, 1, 0, 0, 0);
const BUSINESS_DATE = '2026-08-01';
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

describe('Phase 5B immutable buyer refund ledger', () => {
  it('creates one obligation from BUYER_REFUND_BECAME_DUE and replays exactly', async () => {
    const fixture = await setupDueRefund();
    const first = await createObligation(fixture.dueEventId);
    expect(first).toMatchObject({
      source_review_event_id: fixture.dueEventId,
      formal_order_id: fixture.formalOrderId,
      review_case_id: fixture.reviewCaseId,
      due_amount_cny_fen: '48840',
      net_paid_cny_fen: '0',
      status: 'DUE',
      version: 1,
      replayed: false,
    });

    const replay = await createObligation(fixture.dueEventId);
    expect(replay).toEqual({ ...first, replayed: true });

    const source = await database!.prepare(`
      SELECT amount_cny_fen
      FROM review_events
      WHERE id=?
    `).bind(fixture.dueEventId).first<{ amount_cny_fen: number }>();
    const obligation = await database!.prepare(`
      SELECT due_amount_cny_fen
      FROM buyer_refund_obligations
      WHERE id=?
    `).bind(first.obligation_id).first<{ due_amount_cny_fen: number }>();
    expect(obligation?.due_amount_cny_fen).toBe(source?.amount_cny_fen);

    const sellerFeeEvent = await database!.prepare(`
      SELECT id
      FROM review_events
      WHERE review_case_id=?
        AND event_type='SELLER_SERVICE_FEE_ACCRUED'
    `).bind(fixture.reviewCaseId).first<{ id: string }>();
    await expect(ensureBuyerRefundObligationFromDueEvent(
      database!,
      {
        sourceReviewEventId: sellerFeeEvent!.id,
        expectedVersion: 0,
      },
      systemCommand('buyer-refund:wrong-event'),
    )).rejects.toMatchObject({
      code: 'BUYER_REFUND_NOT_FOUND',
      status: 404,
    });
  });

  it('derives partial, paid, and overpaid states without truncating facts', async () => {
    const fixture = await setupDueRefund();
    const obligation = await createObligation(fixture.dueEventId);

    seedRefundProof(database!, 1);
    const partial = await recordPayment(
      obligation.obligation_id,
      1,
      10_000,
      1,
      'buyer-refund:payment:partial',
    );
    expect(partial.obligation).toMatchObject({
      gross_paid_cny_fen: '10000',
      net_paid_cny_fen: '10000',
      status: 'PARTIALLY_PAID',
      version: 2,
    });

    seedRefundProof(database!, 2);
    const paid = await recordPayment(
      obligation.obligation_id,
      2,
      38_840,
      2,
      'buyer-refund:payment:paid',
    );
    expect(paid.obligation).toMatchObject({
      gross_paid_cny_fen: '48840',
      net_paid_cny_fen: '48840',
      status: 'PAID',
      version: 3,
    });

    seedRefundProof(database!, 3);
    const overpaid = await recordPayment(
      obligation.obligation_id,
      3,
      1,
      3,
      'buyer-refund:payment:overpaid',
    );
    expect(overpaid.obligation).toMatchObject({
      gross_paid_cny_fen: '48841',
      net_paid_cny_fen: '48841',
      status: 'OVERPAID',
      version: 4,
    });

    const linkId = overpaid.payment.proof_files[0]?.file_entity_link_id;
    const link = await database!.prepare(`
      SELECT
        entity_type,
        entity_id,
        purpose,
        visibility,
        authorization_mode
      FROM file_entity_links
      WHERE id=?
    `).bind(linkId).first();
    expect(link).toEqual({
      entity_type: 'BUYER_REFUND',
      entity_id: overpaid.payment.payment_entry_id,
      purpose: 'BUYER_REFUND_PROOF',
      visibility: 'INTERNAL_ONLY',
      authorization_mode: 'EXPLICIT_AUDIENCES',
    });
    const grants = await database!.prepare(`
      SELECT
        subject_type,
        buyer_customer_id,
        seller_organization_id,
        staff_permission_code,
        staff_scope_type,
        staff_team_id
      FROM file_entity_audience_grants
      WHERE file_entity_link_id=?
    `).bind(linkId).all();
    expect(grants.results).toEqual([{
      subject_type: 'STAFF_INTERNAL',
      buyer_customer_id: null,
      seller_organization_id: null,
      staff_permission_code: 'BUYER_REFUND_VIEW',
      staff_scope_type: 'GLOBAL',
      staff_team_id: null,
    }]);
  });

  it('reverses by append-only entries and rejects cumulative excess', async () => {
    const fixture = await setupDueRefund();
    const obligation = await createObligation(fixture.dueEventId);
    seedRefundProof(database!, 4);
    const paid = await recordPayment(
      obligation.obligation_id,
      1,
      48_840,
      4,
      'buyer-refund:payment:reverse-base',
    );

    const first = await reverseBuyerRefundPayment(
      database!,
      {
        obligationId: obligation.obligation_id,
        originalPaymentEntryId: paid.payment.payment_entry_id,
        expectedVersion: 2,
        amountCnyFen: 10_000,
        reversedAt: NOW + 40_000,
        chinaBusinessDate: BUSINESS_DATE,
        publicNote: '原付款部分冲销',
        internalNote: '测试冲销',
      },
      refundCommand('buyer-refund:reverse:partial', NOW + 40_001),
    );
    expect(first.obligation).toMatchObject({
      reversed_cny_fen: '10000',
      net_paid_cny_fen: '38840',
      status: 'PARTIALLY_PAID',
      version: 3,
    });

    const second = await reverseBuyerRefundPayment(
      database!,
      {
        obligationId: obligation.obligation_id,
        originalPaymentEntryId: paid.payment.payment_entry_id,
        expectedVersion: 3,
        amountCnyFen: 38_840,
        reversedAt: NOW + 50_000,
        chinaBusinessDate: BUSINESS_DATE,
      },
      refundCommand('buyer-refund:reverse:remaining', NOW + 50_001),
    );
    expect(second.obligation).toMatchObject({
      reversed_cny_fen: '48840',
      net_paid_cny_fen: '0',
      status: 'DUE',
      version: 4,
    });

    await expect(reverseBuyerRefundPayment(
      database!,
      {
        obligationId: obligation.obligation_id,
        originalPaymentEntryId: paid.payment.payment_entry_id,
        expectedVersion: 4,
        amountCnyFen: 1,
        reversedAt: NOW + 60_000,
        chinaBusinessDate: BUSINESS_DATE,
      },
      refundCommand('buyer-refund:reverse:excess', NOW + 60_001),
    )).rejects.toMatchObject({
      code: 'BUYER_REFUND_REVERSAL_EXCEEDS_PAYMENT',
      status: 409,
    });

    const entries = await database!.prepare(`
      SELECT entry_type, amount_cny_fen, original_payment_entry_id
      FROM buyer_refund_payment_entries
      WHERE obligation_id=?
      ORDER BY created_at, id
    `).bind(obligation.obligation_id).all();
    expect(entries.results).toHaveLength(3);
    expect(entries.results.filter(
      (entry) => entry['entry_type'] === 'REVERSAL',
    )).toHaveLength(2);
  });

  it('enforces permissions, personal denies, versions, proof purpose, and idempotency conflicts', async () => {
    const fixture = await setupDueRefund();
    const obligation = await createObligation(fixture.dueEventId);

    const readOnly = await getBuyerRefundLedger(
      database!,
      obligation.obligation_id,
      buyerSupportActor(),
    );
    expect(readOnly.status).toBe('DUE');

    seedRefundProof(database!, 5);
    await expect(recordBuyerRefundPayment(
      database!,
      allowAllFiles,
      paymentInput(obligation.obligation_id, 1, 100, 5),
      {
        actor: buyerSupportActor(),
        idempotencyKey: 'buyer-refund:forbidden:buyer-support',
        now: NOW + 70_000,
      },
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(getBuyerRefundLedger(
      database!,
      obligation.obligation_id,
      deniedAfterSalesActor(),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });

    seedRefundProof(database!, 6, { purpose: 'ORDER_EVIDENCE' });
    await expect(recordPayment(
      obligation.obligation_id,
      1,
      100,
      6,
      'buyer-refund:wrong-proof-purpose',
    )).rejects.toMatchObject({ code: 'BUYER_REFUND_FILE_CONFLICT' });
    expect((await getBuyerRefundLedger(
      database!,
      obligation.obligation_id,
      ownerRefundActor(),
    )).version).toBe(1);

    seedRefundProof(database!, 7);
    const first = await recordPayment(
      obligation.obligation_id,
      1,
      100,
      7,
      'buyer-refund:idempotency:payment',
    );
    const replay = await recordPayment(
      obligation.obligation_id,
      1,
      100,
      7,
      'buyer-refund:idempotency:payment',
    );
    expect(replay).toEqual({ ...first, replayed: true });

    await expect(recordBuyerRefundPayment(
      database!,
      allowAllFiles,
      {
        ...paymentInput(obligation.obligation_id, 1, 101, 7),
      },
      refundCommand('buyer-refund:idempotency:payment', NOW + 80_000),
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    seedRefundProof(database!, 8);
    await expect(recordPayment(
      obligation.obligation_id,
      1,
      100,
      8,
      'buyer-refund:version-conflict',
    )).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('keeps payments, reversals, proof bindings, and events immutable', async () => {
    const fixture = await setupDueRefund();
    const obligation = await createObligation(fixture.dueEventId);
    seedRefundProof(database!, 9);
    const paid = await recordPayment(
      obligation.obligation_id,
      1,
      100,
      9,
      'buyer-refund:immutable:payment',
    );

    expect(() => database!.exec(`
      UPDATE buyer_refund_payment_entries
      SET amount_cny_fen=200
      WHERE id='${paid.payment.payment_entry_id}'
    `)).toThrow('buyer_refund_payment_entries_are_immutable');
    expect(() => database!.exec(`
      DELETE FROM buyer_refund_payment_entries
      WHERE id='${paid.payment.payment_entry_id}'
    `)).toThrow('buyer_refund_payment_entries_are_immutable');
    expect(() => database!.exec(`
      UPDATE buyer_refund_events
      SET amount_cny_fen=200
      WHERE payment_entry_id='${paid.payment.payment_entry_id}'
    `)).toThrow('buyer_refund_events_are_immutable');
    expect(() => database!.exec(`
      DELETE FROM buyer_refund_payment_entry_files
      WHERE payment_entry_id='${paid.payment.payment_entry_id}'
    `)).toThrow('buyer_refund_payment_entry_files_are_immutable');

    const obligationColumns = await database!.prepare(`
      PRAGMA table_info(buyer_refund_obligations)
    `).all<{ name: string; type: string }>();
    expect(obligationColumns.results.some(
      (column) => column.name === 'status',
    )).toBe(false);
    expect(obligationColumns.results.find(
      (column) => column.name === 'due_amount_cny_fen',
    )?.type).toBe('INTEGER');
    const entryColumns = await database!.prepare(`
      PRAGMA table_info(buyer_refund_payment_entries)
    `).all<{ name: string; type: string }>();
    expect(entryColumns.results.find(
      (column) => column.name === 'amount_cny_fen',
    )?.type).toBe('INTEGER');
  });

  it('leaves no partial payment, link, event, audit, or version change on failure', async () => {
    const fixture = await setupDueRefund();
    const obligation = await createObligation(fixture.dueEventId);
    seedRefundProof(database!, 10);
    seedRefundProof(database!, 11);
    let linkCalls = 0;
    const failSecondLink: FileAuthorizationService = {
      ...allowAllFiles,
      assertCanLink: () => {
        linkCalls += 1;
        if (linkCalls === 2) throw new Error('forced_link_failure');
      },
    };

    const before = await refundFactCounts(obligation.obligation_id);
    await expect(recordBuyerRefundPayment(
      database!,
      failSecondLink,
      {
        ...paymentInput(obligation.obligation_id, 1, 100, 10),
        proofFiles: [
          { fileObjectId: 'refund-file-10', expectedFileVersion: 3 },
          { fileObjectId: 'refund-file-11', expectedFileVersion: 3 },
        ],
      },
      refundCommand('buyer-refund:atomic:failure', NOW + 90_000),
    )).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });

    expect(await refundFactCounts(obligation.obligation_id)).toEqual(before);
    expect((await getBuyerRefundLedger(
      database!,
      obligation.obligation_id,
      ownerRefundActor(),
    )).version).toBe(1);
  });
});

async function setupDueRefund(): Promise<{
  formalOrderId: string;
  reviewCaseId: string;
  dueEventId: string;
}> {
  database = createMigratedTestDatabase();
  seedFormalOrderPrerequisites(database);
  const formalOrder = await confirmFormalOrder(
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
      idempotencyKey: 'formal-order:refund-fixture',
      requestId: 'request:formal-order:refund-fixture',
      now: NOW,
    },
  );
  seedReviewFile(database, 1);
  const submitted = await submitReviewEvidence(
    database,
    allowAllFiles,
    {
      formalOrderId: formalOrder.formal_order_id,
      expectedVersion: 0,
      reviewType: 'IMAGE',
      evidenceFiles: [{
        fileObjectId: 'review-file-refund-1',
        expectedFileVersion: 3,
      }],
    },
    {
      actor: { buyerCustomerId: 'buyer-review-1' } satisfies BuyerReviewActor,
      idempotencyKey: 'review:refund-fixture:submit',
      now: NOW + 10_000,
    },
  );
  await approveReview(
    database,
    {
      reviewCaseId: submitted.review_case_id,
      expectedVersion: 1,
    },
    {
      actor: reviewOwnerActor(),
      idempotencyKey: 'review:refund-fixture:approve',
      now: NOW + 20_000,
    },
  );
  const due = await database.prepare(`
    SELECT id
    FROM review_events
    WHERE review_case_id=?
      AND event_type='BUYER_REFUND_BECAME_DUE'
  `).bind(submitted.review_case_id).first<{ id: string }>();
  if (!due) throw new Error('due_event_missing');
  return {
    formalOrderId: formalOrder.formal_order_id,
    reviewCaseId: submitted.review_case_id,
    dueEventId: due.id,
  };
}

async function createObligation(sourceReviewEventId: string) {
  return ensureBuyerRefundObligationFromDueEvent(
    database!,
    { sourceReviewEventId, expectedVersion: 0 },
    systemCommand('buyer-refund:ensure:fixture'),
  );
}

function systemCommand(idempotencyKey: string) {
  return {
    actor: { type: 'SYSTEM' as const, systemId: 'review-finance-projector' },
    idempotencyKey,
    requestId: `request:${idempotencyKey}`,
    now: NOW + 25_000,
  };
}

async function recordPayment(
  obligationId: string,
  expectedVersion: number,
  amountCnyFen: number,
  proofSuffix: number,
  idempotencyKey: string,
) {
  return recordBuyerRefundPayment(
    database!,
    allowAllFiles,
    paymentInput(
      obligationId,
      expectedVersion,
      amountCnyFen,
      proofSuffix,
    ),
    refundCommand(idempotencyKey, NOW + 30_000 + proofSuffix),
  );
}

function paymentInput(
  obligationId: string,
  expectedVersion: number,
  amountCnyFen: number,
  proofSuffix: number,
) {
  return {
    obligationId,
    expectedVersion,
    amountCnyFen,
    paidAt: NOW + 30_000 + proofSuffix,
    chinaBusinessDate: BUSINESS_DATE,
    paymentChannel: 'WECHAT' as const,
    proofFiles: [{
      fileObjectId: `refund-file-${proofSuffix}`,
      expectedFileVersion: 3,
    }],
    publicNote: '人工返款已完成',
    internalNote: '内部流水已核对',
  };
}

function refundCommand(idempotencyKey: string, now: number) {
  return {
    actor: ownerRefundActor(),
    idempotencyKey,
    requestId: `request:${idempotencyKey}`,
    now,
  };
}

function refundActor(
  roles: readonly StaffRoleCode[],
  permissions: readonly StaffPermissionCode[],
  staffId: string,
): BuyerRefundStaffActor {
  return {
    staffId,
    displayName: staffId,
    roles,
    permissions: new Set(permissions),
  };
}

function ownerRefundActor(): BuyerRefundStaffActor {
  return refundActor(
    ['owner'],
    ['BUYER_REFUND_VIEW', 'BUYER_REFUND_RECORD'],
    'staff-review-owner',
  );
}

function buyerSupportActor(): BuyerRefundStaffActor {
  return refundActor(
    ['buyer_support'],
    ['BUYER_REFUND_VIEW'],
    'staff-review-buyer-support',
  );
}

function deniedAfterSalesActor(): BuyerRefundStaffActor {
  return refundActor(['after_sales'], [], 'staff-review-after-sales');
}

function reviewOwnerActor(): StaffReviewActor {
  return {
    staffId: 'staff-review-owner',
    displayName: '负责人',
    roles: ['owner'],
    permissions: new Set(['REVIEW_DECIDE']),
  };
}

async function refundFactCounts(obligationId: string) {
  return database!.prepare(`
    SELECT
      (SELECT COUNT(*) FROM buyer_refund_payment_entries
        WHERE obligation_id=?) AS entries,
      (SELECT COUNT(*) FROM buyer_refund_payment_entry_files
        WHERE obligation_id=?) AS files,
      (SELECT COUNT(*) FROM buyer_refund_events
        WHERE obligation_id=?) AS events,
      (SELECT COUNT(*) FROM audit_events
        WHERE aggregate_type='BUYER_REFUND_OBLIGATION'
          AND aggregate_id=?) AS audits,
      (SELECT COUNT(*) FROM file_entity_links
        WHERE entity_type='BUYER_REFUND') AS links
  `).bind(
    obligationId,
    obligationId,
    obligationId,
    obligationId,
  ).first();
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
      ('staff-review-buyer-support', '买家客服', 'ACTIVE', 1, 1, 1000, 1000, NULL);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-review', 'JP', 'ido-mango-9301',
      'seller-channel-ido-mango', 'seller-channel-ido-mango',
      9301, '返款流程测试卖家', 'ACTIVE',
      1, 1000, 1000, 1000, NULL, 2
    );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('seller-review-subject', 'SELLER_ORG_MEMBER', 1000),
      ('buyer-review-subject-1', 'BUYER_CUSTOMER', 1000);

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
      'buyer-channel-review', 'R', '返款流程测试渠道',
      'ACTIVE', 1, 1, 1000, 1000, NULL
    );

    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code,
      buyer_channel_id, buyer_customer_no,
      buyer_sequence, first_valid_order_business_date,
      display_name, access_status,
      identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'buyer-review-1', 'buyer-review-subject-1', 'JP',
      'buyer-channel-review', NULL, NULL, NULL,
      '返款买家', 'ACTIVE', 'CLEAR', 1,
      1000, 1000, 1000, NULL
    );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-review', 'seller-org-review', 'JP',
      '返款流程测试店铺', '返款流程测试店铺', 'ACTIVE',
      1, 1000, 1000, NULL
    );

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'product-review', 'seller-org-review', 'store-review', 'JP',
      'B0REFUND01', 'B0REFUND01', 'ACTIVE',
      1, 1, 1000, 1000, NULL
    );

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode) VALUES (
      'product-review-v1', 'product-review', 1,
      '返款流程测试产品', '[]', NULL, NULL, NULL,
      'staff-review-pre-sales', 1000
    ,
          1980, 'MAIN_IMAGE_VARIANT');

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

function seedReviewFile(db: SqliteDatabase, suffix: number): void {
  const hex = suffix.toString(16).padStart(64, '0');
  const intentId = `review-intent-refund-${suffix}`;
  const fileId = `review-file-refund-${suffix}`;
  const objectKey = `files/v1/2026/08/review_evidence/${hex}`;
  db.exec(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id,
      purpose, visibility, status,
      requested_file_count, manifest_hash,
      version, expires_at, failure_code,
      created_at, updated_at, completed_at
    ) VALUES (
      '${intentId}', 'BUYER_CUSTOMER', 'buyer-review-1',
      'REVIEW_EVIDENCE', 'BUYER_VISIBLE', 'ISSUED',
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
      'REVIEW_EVIDENCE', 'BUYER_VISIBLE', '${objectKey}',
      'review-${suffix}.png', 'png', 'image/png',
      8, 'RESERVED', '${hex}', ${NOW + 3600000},
      NULL, NULL, NULL, NULL, 0, NULL, 1,
      ${NOW - 100}, ${NOW - 100}, NULL, NULL, NULL
    );
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

function seedRefundProof(
  db: SqliteDatabase,
  suffix: number,
  options: { purpose?: FilePurpose; verified?: boolean } = {},
): void {
  const purpose = options.purpose ?? 'BUYER_REFUND_PROOF';
  const verified = options.verified ?? true;
  const hex = (suffix + 100).toString(16).padStart(64, '0');
  const intentId = `refund-intent-${suffix}`;
  const fileId = `refund-file-${suffix}`;
  const objectKey = `files/v1/2026/08/buyer_refund_proof/${hex}`;
  db.exec(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id,
      purpose, visibility, status,
      requested_file_count, manifest_hash,
      version, expires_at, failure_code,
      created_at, updated_at, completed_at
    ) VALUES (
      '${intentId}', 'STAFF', 'staff-review-owner',
      '${purpose}', 'INTERNAL_ONLY', 'ISSUED',
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
      '${purpose}', 'INTERNAL_ONLY', '${objectKey}',
      'refund-${suffix}.png', 'png', 'image/png',
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
