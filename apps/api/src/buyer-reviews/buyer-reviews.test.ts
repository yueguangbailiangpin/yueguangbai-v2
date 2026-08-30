import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SqlDatabase } from '@ygb/contracts';
import type { BuyerPortalContext } from '../buyer-portal/buyer-context';
import {
  normalizeBuyerReviewPortalError,
} from './errors';
import { buyerReviewFileAuthorization } from './file-authorization';
import {
  decodeBuyerReviewCursor,
  decodeEligibleReviewOrderCursor,
} from './pagination';
import {
  buyerReviewAllowedActions,
  getBuyerReview,
  listBuyerReviewEligibleOrders,
  listBuyerReviews,
} from './read-model';

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

const buyer: BuyerPortalContext = {
  buyerCustomerId: 'buyer-1',
  marketplaceCode: 'AMAZON_JP',
  accessStatus: 'ACTIVE',
  identityReviewStatus: 'CLEAR',
  customerNumber: 'B000001',
  displayName: '测试买家',
  refundAccountName: null,
  refundAccountIdentifier: null,
  sessionExpiresAt: 999999,
};

const approvedReviewRow = {
  review_case_id: 'review-1',
  formal_order_id: 'formal-1',
  marketplace_code: 'AMAZON_JP',
  amazon_order_number_normalized: '123-1234567-1234567',
  asin_normalized: 'B0REVIEW01',
  product_name_snapshot: '评论测试产品',
  order_review_type: 'IMAGE',
  confirmed_at: 1000,
  confirmed_business_date: '2026-08-01',
  order_status: 'CONFIRMED',
  review_type: 'IMAGE',
  review_status: 'APPROVED',
  review_version: 2,
  current_evidence_version_no: 1,
  current_evidence_version_id: 'review-evidence-1',
  submitted_at: 2000,
  updated_at: 3000,
  public_change_reason: null,
  review_approved_at: 3000,
  buyer_refund_due_amount_cny_fen: 4884,
  buyer_refund_became_due_at: 3000,
  file_count: 1,
} as const;

const reviewFileRow = {
  file_object_id: 'review-file-1',
  file_entity_link_id: 'review-link-1',
  client_file_name: 'review.png',
  mime: 'image/png',
  byte_size: 128,
  file_status: 'VERIFIED',
  file_version: 3,
  verified_at: 1900,
} as const;

describe('Phase 4B4 buyer review API read projection', () => {
  it('lists only the eligible no-case and CHANGES_REQUESTED shapes', async () => {
    const database = fakeDatabase({
      all: [[
        {
          formal_order_id: 'formal-2',
          marketplace_code: 'AMAZON_JP',
          amazon_order_number_normalized: '222-1234567-1234567',
          asin_normalized: 'B0REVIEW02',
          product_name_snapshot: '待提交产品',
          review_type: 'TEXT',
          confirmed_at: 2000,
          confirmed_business_date: '2026-08-01',
          order_status: 'CONFIRMED',
          review_case_id: null,
          review_status: null,
          review_version: null,
        },
        {
          formal_order_id: 'formal-1',
          marketplace_code: 'AMAZON_JP',
          amazon_order_number_normalized: '123-1234567-1234567',
          asin_normalized: 'B0REVIEW01',
          product_name_snapshot: '待修改产品',
          review_type: 'IMAGE',
          confirmed_at: 1000,
          confirmed_business_date: '2026-08-01',
          order_status: 'CONFIRMED',
          review_case_id: 'review-1',
          review_status: 'CHANGES_REQUESTED',
          review_version: 2,
        },
      ]],
    });

    const result = await listBuyerReviewEligibleOrders(
      database,
      buyer,
      { limit: 20, cursor: null },
    );
    expect(result.next_cursor).toBeNull();
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      current_review: null,
      allowed_actions: ['SUBMIT'],
    });
    expect(result.items[1]).toMatchObject({
      current_review: {
        review_case_id: 'review-1',
        status: 'CHANGES_REQUESTED',
        version: 2,
      },
      allowed_actions: ['RESUBMIT', 'WITHDRAW'],
    });
    expect(database.calls[0]?.sql).toContain(
      "review_case.status='CHANGES_REQUESTED'",
    );
    expect(database.calls[0]?.sql).toContain(
      'ORDER BY formal_order.confirmed_at DESC, formal_order.id DESC',
    );
    expect(database.calls[0]?.bindings[0]).toBe('buyer-1');
  });

  it('filters the own-reviews list by status at the SQL layer', async () => {
    const database = fakeDatabase({ all: [[approvedReviewRow]] });
    const page = await listBuyerReviews(database, buyer, {
      limit: 2,
      cursor: null,
      status: ['CHANGES_REQUESTED', 'PENDING_REVIEW'],
    });
    expect(page.items.map((item) => item.review_case_id))
      .toEqual(['review-1']);
    expect(database.calls[0]?.sql).toContain(
      'review_case.status IN (?,?)',
    );
    expect(database.calls[0]?.bindings).toEqual([
      'buyer-1',
      'CHANGES_REQUESTED',
      'PENDING_REVIEW',
      3,
    ]);

    const unfiltered = fakeDatabase({ all: [[approvedReviewRow]] });
    await listBuyerReviews(unfiltered, buyer, {
      limit: 2,
      cursor: null,
    });
    expect(unfiltered.calls[0]?.sql).not.toContain('status IN');
    expect(unfiltered.calls[0]?.bindings).toEqual(['buyer-1', 3]);
  });

  it('traverses eligible orders across two stable pages', async () => {
    const rows: Record<string, unknown>[] = [
      {
        formal_order_id: 'formal-3',
        marketplace_code: 'AMAZON_JP',
        amazon_order_number_normalized: '333-1234567-1234567',
        asin_normalized: 'B0REVIEW03',
        product_name_snapshot: '第三个产品',
        review_type: 'IMAGE',
        confirmed_at: 3000,
        confirmed_business_date: '2026-08-01',
        order_status: 'CONFIRMED',
        review_case_id: null,
        review_status: null,
        review_version: null,
      },
      {
        formal_order_id: 'formal-2',
        marketplace_code: 'AMAZON_JP',
        amazon_order_number_normalized: '222-1234567-1234567',
        asin_normalized: 'B0REVIEW02',
        product_name_snapshot: '第二个产品',
        review_type: 'TEXT',
        confirmed_at: 2000,
        confirmed_business_date: '2026-08-01',
        order_status: 'CONFIRMED',
        review_case_id: null,
        review_status: null,
        review_version: null,
      },
      {
        formal_order_id: 'formal-1',
        marketplace_code: 'AMAZON_JP',
        amazon_order_number_normalized: '111-1234567-1234567',
        asin_normalized: 'B0REVIEW01',
        product_name_snapshot: '第一个产品',
        review_type: 'IMAGE',
        confirmed_at: 1000,
        confirmed_business_date: '2026-08-01',
        order_status: 'CONFIRMED',
        review_case_id: 'review-1',
        review_status: 'CHANGES_REQUESTED',
        review_version: 2,
      },
    ];
    const database = fakeDatabase({
      all: [[rows[0]!, rows[1]!, rows[2]!], [rows[2]!]],
    });

    const first = await listBuyerReviewEligibleOrders(database, buyer, {
      limit: 2,
      cursor: null,
    });
    expect(first.items.map((item) => item.order.formal_order_id))
      .toEqual(['formal-3', 'formal-2']);
    const cursor = decodeEligibleReviewOrderCursor(first.next_cursor!);
    const second = await listBuyerReviewEligibleOrders(database, buyer, {
      limit: 2,
      cursor,
    });
    expect(second.items.map((item) => item.order.formal_order_id))
      .toEqual(['formal-1']);
    expect(second.next_cursor).toBeNull();
  });

  it('traverses the own-reviews list across two stable pages', async () => {
    const secondRow = {
      ...approvedReviewRow,
      review_case_id: 'review-2',
      formal_order_id: 'formal-2',
      updated_at: 2000,
    };
    const database = fakeDatabase({
      all: [[approvedReviewRow, secondRow], [secondRow]],
    });

    const first = await listBuyerReviews(database, buyer, {
      limit: 1,
      cursor: null,
    });
    expect(first.items.map((item) => item.review_case_id)).toEqual(['review-1']);
    const cursor = decodeBuyerReviewCursor(first.next_cursor!);
    const second = await listBuyerReviews(database, buyer, {
      limit: 1,
      cursor,
    });
    expect(second.items.map((item) => item.review_case_id)).toEqual(['review-2']);
    expect(second.next_cursor).toBeNull();
  });

  it('projects only buyer-public review and due-obligation fields', async () => {
    const database = fakeDatabase({ all: [[approvedReviewRow]] });
    const result = await listBuyerReviews(
      database,
      buyer,
      { limit: 20, cursor: null },
    );
    expect(result.items[0]).toMatchObject({
      review_case_id: 'review-1',
      review_type: 'IMAGE',
      status: 'APPROVED',
      version: 2,
      review_url: null,
      review_approved_at: 3000,
      buyer_refund_due: {
        amount_cny_fen: '4884',
      },
      allowed_actions: [],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /internal_review_note|staff|seller_service_fee|settlement|paid_at|payment|object_key|permanent_url/iu,
    );
    expect(database.calls[0]?.sql).toContain(
      "due.event_type='BUYER_REFUND_BECAME_DUE'",
    );
    expect(database.calls[0]?.sql).not.toContain(
      'SELLER_SERVICE_FEE_ACCRUED',
    );
  });

  it('returns only current VERIFIED explicit-grant files in detail', async () => {
    const database = fakeDatabase({
      first: [approvedReviewRow],
      all: [[reviewFileRow]],
    });
    const result = await getBuyerReview(
      database,
      buyer,
      'review-1',
      4000,
    );
    expect(result.files).toEqual([{
      file_object_id: 'review-file-1',
      file_entity_link_id: 'review-link-1',
      client_file_name: 'review.png',
      mime: 'image/png',
      byte_size: 128,
      status: 'VERIFIED',
      version: 3,
      verified_at: 1900,
      allowed_actions: ['CREATE_READ_INTENT'],
    }]);
    expect(JSON.stringify(result.files)).not.toMatch(
      /object_key|signed_url|permanent_url/iu,
    );
    const fileQuery = database.calls[1]?.sql ?? '';
    expect(fileQuery).toContain("link.authorization_mode='EXPLICIT_AUDIENCES'");
    expect(fileQuery).toContain("buyer_grant.subject_type='BUYER'");
    expect(database.calls[1]?.bindings).toContain('buyer-1');
  });

  it('keeps terminal reviews read-only', () => {
    expect(buyerReviewAllowedActions('PENDING_REVIEW')).toEqual(['WITHDRAW']);
    expect(buyerReviewAllowedActions('CHANGES_REQUESTED')).toEqual([
      'RESUBMIT',
      'WITHDRAW',
    ]);
    expect(buyerReviewAllowedActions('APPROVED')).toEqual([]);
    expect(buyerReviewAllowedActions('REJECTED')).toEqual([]);
    expect(buyerReviewAllowedActions('WITHDRAWN')).toEqual([]);
  });
});

describe('Phase 4B4 buyer review API security boundaries', () => {
  it('hides foreign order/case/file errors as NOT_FOUND', () => {
    for (const code of [
      'FORMAL_ORDER_NOT_FOUND',
      'REVIEW_CASE_NOT_FOUND',
      'FILE_OBJECT_NOT_FOUND',
      'REVIEW_FILE_CONFLICT',
      'FILE_READ_INTENT_NOT_FOUND',
    ] as const) {
      expect(normalizeBuyerReviewPortalError({ code })).toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    }
    expect(normalizeBuyerReviewPortalError({
      code: 'VERSION_CONFLICT',
    })).toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
  });

  it('allows only buyer-owned REVIEW_EVIDENCE links', () => {
    expect(() => buyerReviewFileAuthorization.assertCanLink(
      { type: 'BUYER_CUSTOMER', id: 'buyer-1', roles: [] },
      {
        uploadIntentId: 'intent-1',
        fileObjectId: 'file-1',
        ownerActorType: 'BUYER_CUSTOMER',
        ownerActorId: 'buyer-1',
        purpose: 'REVIEW_EVIDENCE',
        visibility: 'BUYER_VISIBLE',
        entityType: 'REVIEW',
        entityId: 'evidence-1',
      },
    )).not.toThrow();

    expect(() => buyerReviewFileAuthorization.assertCanLink(
      { type: 'BUYER_CUSTOMER', id: 'buyer-2', roles: [] },
      {
        uploadIntentId: 'intent-1',
        fileObjectId: 'file-1',
        ownerActorType: 'BUYER_CUSTOMER',
        ownerActorId: 'buyer-1',
        purpose: 'REVIEW_EVIDENCE',
        visibility: 'BUYER_VISIBLE',
        entityType: 'REVIEW',
        entityId: 'evidence-1',
      },
    )).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('wires all routes through session and all writes through origin guard', () => {
    const root = path.resolve(MODULE_DIRECTORY, '../../../..');
    const routeSource = readFileSync(
      path.join(root, 'apps/api/src/buyer-reviews/routes.ts'),
      'utf8',
    );
    for (const route of [
      '/api/buyer-portal/reviews/eligible-orders',
      '/api/buyer-portal/reviews',
      '/api/buyer-portal/reviews/:id',
      '/api/buyer-portal/reviews/:id/resubmit',
      '/api/buyer-portal/reviews/:id/withdraw',
      '/api/buyer-portal/reviews/:id/files/:fileLinkId/read-intent',
    ]) {
      expect(routeSource).toContain(route);
    }
    expect(routeSource.match(/customerAuthOriginGuard\(\)/gu)).toHaveLength(4);
    expect(routeSource.match(/\bsession\b/gu)?.length).toBeGreaterThanOrEqual(8);
    expect(routeSource).toContain('submitReviewEvidence(');
    expect(routeSource).toContain('withdrawReview(');
    expect(routeSource).toContain('createFileReadIntent(');
    expect(routeSource).toContain("type: 'BUYER_SESSION'");
    expect(routeSource).not.toMatch(
      /INSERT\s+INTO\s+file_entity_audience_grants/iu,
    );
  });

  it('keeps the Wave 12 schema and forbidden domains unchanged', () => {
    const root = path.resolve(MODULE_DIRECTORY, '../../../..');
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(36);
    expect(migrations.at(-1)).toBe('0036_stage75r5_settlement_cancelled_reason_reserved.sql');

    const source = readFileSync(
      path.join(root, 'apps/api/src/buyer-reviews/read-model.ts'),
      'utf8',
    );
    expect(source).not.toContain('internal_review_note AS');
    expect(source).not.toContain('seller_service_fee');
    expect(source).not.toContain('actual_refund');
  });
});

interface FakeOptions {
  all?: readonly (readonly Record<string, unknown>[])[];
  first?: readonly (Record<string, unknown> | null)[];
}

function fakeDatabase(options: FakeOptions): SqlDatabase & {
  calls: { sql: string; bindings: readonly unknown[] }[];
} {
  const allQueue = [...(options.all ?? [])];
  const firstQueue = [...(options.first ?? [])];
  const calls: { sql: string; bindings: readonly unknown[] }[] = [];
  const database = {
    calls,
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          calls.push({ sql, bindings });
          return {
            async all() {
              return { results: allQueue.shift() ?? [] };
            },
            async first() {
              return firstQueue.shift() ?? null;
            },
          };
        },
      };
    },
  };
  return database as unknown as SqlDatabase & {
    calls: { sql: string; bindings: readonly unknown[] }[];
  };
}
