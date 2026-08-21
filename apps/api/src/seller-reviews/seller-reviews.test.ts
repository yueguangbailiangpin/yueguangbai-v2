import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  PricingReviewType,
  ReviewCaseStatus,
  SellerMemberRole,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import type { SellerPortalActor } from '../seller-portal/actor';
import { decodeSellerPortalCursor } from '../seller-portal/pagination';
import {
  getSellerReview,
  listSellerReviews,
  requireSellerReviewEvidenceFile,
} from './read-model';

const NOW = Date.UTC(2026, 7, 1, 8, 0, 0);
const NO_FILTERS = Object.freeze({
  store_id: null,
  status: null,
  asin: null,
  review_type: null,
  formal_order_id: null,
  amazon_order_number: null,
});

describe('Phase 4C3 seller review read model', () => {
  it('applies organization and store scope for all four seller roles', async () => {
    for (const role of [
      'OWNER',
      'OPERATIONS',
      'FINANCE',
      'VIEWER',
    ] as const) {
      const database = fakeDatabase({
        all: [[caseRow()], [fileRow()]],
      });
      const page = await listSellerReviews(
        database,
        actor(role, role === 'OWNER'),
        { limit: 25, cursor: null },
        NO_FILTERS,
        NOW,
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.review_case_id).toBe('review-case-1');
      expect(page.items[0]?.allowed_actions).toEqual([
        'VIEW',
        'READ_EVIDENCE',
      ]);
      const caseQuery = database.calls[0]!;
      expect(caseQuery.sql).toContain(
        'review_case.seller_organization_id=?',
      );
      expect(caseQuery.bindings[0]).toBe('org-1');
      if (role === 'OWNER') {
        expect(caseQuery.sql).not.toContain(
          'formal_order.store_id IN',
        );
      } else {
        expect(caseQuery.sql).toContain(
          'formal_order.store_id IN (?)',
        );
        expect(caseQuery.bindings).toContain('store-1');
      }
    }
  });

  it('uses bounded stable pagination and declared filters', async () => {
    const database = fakeDatabase({
      all: [[
        caseRow({
          review_case_id: 'review-case-3',
          updated_at: 3000,
        }),
        caseRow({
          review_case_id: 'review-case-2',
          updated_at: 2000,
        }),
        caseRow({
          review_case_id: 'review-case-1',
          updated_at: 1000,
        }),
      ], []],
    });
    const page = await listSellerReviews(
      database,
      actor('OWNER', true),
      { limit: 2, cursor: null },
      {
        store_id: 'store-1',
        status: 'APPROVED',
        asin: 'B0REVIEW01',
        review_type: 'IMAGE',
        formal_order_id: 'formal-order-1',
        amazon_order_number: '111-1234567-1234567',
      },
      NOW,
    );
    expect(page.items.map((item) => item.review_case_id)).toEqual([
      'review-case-3',
      'review-case-2',
    ]);
    expect(page.page.next_cursor).toEqual(expect.any(String));
    expect(decodeSellerPortalCursor(
      page.page.next_cursor,
      isCursor,
    )).toEqual({
      updated_at: 2000,
      review_case_id: 'review-case-2',
    });

    const query = database.calls[0]!;
    for (const fragment of [
      'formal_order.store_id=?',
      'review_case.status=?',
      'formal_order.asin_normalized=?',
      'review_case.review_type=?',
      'formal_order.id=?',
      'formal_order.amazon_order_number_normalized=?',
      'ORDER BY review_case.updated_at DESC, review_case.id DESC',
    ]) {
      expect(query.sql).toContain(fragment);
    }
    expect(query.bindings.at(-1)).toBe(3);
  });

  it('returns a seller-safe DTO and keeps review_url nullable null', async () => {
    const database = fakeDatabase({
      first: [caseRow()],
      all: [[fileRow()]],
    });
    const review = await getSellerReview(
      database,
      actor('OWNER', true),
      'review-case-1',
      NOW,
    );
    expect(review).toEqual({
      review_case_id: 'review-case-1',
      formal_order: {
        id: 'formal-order-1',
        amazon_order_number: '111-1234567-1234567',
      },
      store: {
        id: 'store-1',
        display_name: 'Alpha 店铺',
      },
      marketplace_code: 'JP',
      asin: 'B0REVIEW01',
      product_name: '评论产品一',
      review_type: 'IMAGE',
      status: 'APPROVED',
      version: 2,
      review_url: null,
      submitted_at: 1000,
      approved_at: 2000,
      evidence: {
        version_id: 'evidence-version-1',
        version_no: 1,
        submitted_at: 1000,
        files: [{
          file_entity_link_id: 'file-link-1',
          file_version: 3,
          content_type: 'image/jpeg',
          byte_size: 1234,
          created_at: 1000,
        }],
      },
      service_fee_accrued: {
        amount_cny_fen: '2500',
        accrued_at: 2000,
      },
      allowed_actions: ['VIEW', 'READ_EVIDENCE'],
    });

    const serialized = JSON.stringify(review);
    for (const forbidden of [
      'buyer_customer_id',
      'buyer_customer_no',
      'wechat',
      'buyer_rate',
      'buyer_expected_principal',
      'BUYER_REFUND_BECAME_DUE',
      'internal_review_note',
      'decided_by_staff_id',
      'idempotency',
      'audit',
      'profit',
      'settlement',
      'object_key',
      'permanent_url',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('exposes no evidence action when seller grant visibility query returns none', async () => {
    const database = fakeDatabase({
      first: [caseRow({
        review_status: 'PENDING_REVIEW',
        decided_at: null,
        service_fee_amount_cny_fen: null,
        service_fee_accrued_at: null,
      })],
      all: [[]],
    });
    const review = await getSellerReview(
      database,
      actor('VIEWER', false),
      'review-case-1',
      NOW,
    );
    expect(review.evidence.files).toEqual([]);
    expect(review.allowed_actions).toEqual(['VIEW']);
    expect(review.approved_at).toBeNull();
    expect(review.service_fee_accrued).toBeNull();

    const fileQuery = database.calls[1]!;
    expect(fileQuery.sql).toContain(
      "seller_grant.subject_type='SELLER_ORGANIZATION'",
    );
    expect(fileQuery.sql).toContain('seller_grant.revoked_at IS NULL');
    expect(fileQuery.sql).toContain('seller_grant.expires_at>?');
    expect(fileQuery.sql).toContain('link.revoked_at IS NULL');
    expect(fileQuery.sql).not.toContain("subject_type='BUYER'");
  });

  it('treats organization, store, buyer-only grant, and revoked grant misses as not found', async () => {
    for (const missing of [
      'cross-organization',
      'outside-store',
      'buyer-only-grant',
      'revoked-seller-grant',
    ]) {
      const database = fakeDatabase({ first: [null] });
      await expect(requireSellerReviewEvidenceFile(
        database,
        actor('VIEWER', false),
        'review-case-hidden',
        `file-link-${missing}`,
        NOW,
      )).rejects.toMatchObject({
        code: 'SELLER_REVIEW_FILE_NOT_FOUND',
        status: 404,
      });
      const query = database.calls[0]!;
      expect(query.sql).toContain('review_case.seller_organization_id=?');
      expect(query.sql).toContain('formal_order.store_id IN (?)');
      expect(query.sql).toContain("authorization_mode='EXPLICIT_AUDIENCES'");
      expect(query.sql).toContain(
        "seller_grant.subject_type='SELLER_ORGANIZATION'",
      );
    }

    const database = fakeDatabase({ first: [null] });
    await expect(getSellerReview(
      database,
      actor('VIEWER', false),
      'review-case-outside-scope',
      NOW,
    )).rejects.toMatchObject({
      code: 'SELLER_REVIEW_NOT_FOUND',
      status: 404,
    });
  });

  it('returns internal file authority only after exact scoped seller grant', async () => {
    const database = fakeDatabase({
      first: [{
        review_case_id: 'review-case-1',
        file_object_id: 'file-object-1',
        file_entity_link_id: 'file-link-1',
        file_version: 3,
      }],
    });
    const access = await requireSellerReviewEvidenceFile(
      database,
      actor('FINANCE', false),
      'review-case-1',
      'file-link-1',
      NOW,
    );
    expect(access).toEqual({
      reviewCaseId: 'review-case-1',
      fileObjectId: 'file-object-1',
      fileEntityLinkId: 'file-link-1',
      fileVersion: 3,
    });
    expect(database.calls[0]?.bindings).toContain('org-1');
    expect(database.calls[0]?.bindings).toContain('store-1');
    expect(database.calls[0]?.bindings).toContain('file-link-1');
  });
});

describe('Phase 4C3 route and schema guardrails', () => {
  it('reuses seller session ACTIVE checks and exposes only declared routes', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const routeSource = readFileSync(
      path.join(root, 'apps/api/src/seller-reviews/routes.ts'),
      'utf8',
    );
    const actorSource = readFileSync(
      path.join(root, 'apps/api/src/seller-portal/actor.ts'),
      'utf8',
    );
    expect(routeSource).toContain('customerSessionMiddleware()');
    expect(routeSource).toContain('customerAuthOriginGuard()');
    expect(routeSource).toContain('resolveSellerPortalActor(context)');
    expect(routeSource).toContain("'/api/seller-portal/reviews'");
    expect(routeSource).toContain("'/api/seller-portal/reviews/:id'");
    expect(routeSource).toContain(
      "'/api/seller-portal/reviews/:id/files/:fileLinkId/read-intent'",
    );
    expect(routeSource).not.toMatch(/app\.(put|patch|delete)\(/u);
    expect(routeSource.match(/app\.post\(/gu)).toHaveLength(1);
    expect(routeSource).not.toContain('approveReview');
    expect(routeSource).not.toContain('requestReviewChanges');
    expect(routeSource).not.toContain('rejectReview');

    expect(actorSource).toContain("session.accountType !== 'SELLER_MEMBER'");
    expect(actorSource).toContain("member.status='ACTIVE'");
    expect(actorSource).toContain("organization.status='ACTIVE'");
    expect(actorSource).toContain('rows.results.length !== 1');
  });

  it('keeps the Wave 12 schema and does not add refund or mutable profit storage', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(70);
    expect(migrations[0]).toMatch(/^0001_/u);
    expect(migrations[25]).toBe('0026_financial_export_audit.sql');
    expect(migrations[42]).toBe('0043_seller_principal_rate_integrity_hardening.sql');
    expect(migrations.at(-1)).toBe('0070_buyer_refund_reminders.sql');

    const source = [
      'read-model.ts',
      'routes.ts',
      'errors.ts',
    ].map((name) => readFileSync(
      path.join(root, 'apps/api/src/seller-reviews', name),
      'utf8',
    )).join('\n');
    for (const forbidden of [
      'INSERT INTO buyer_refunds',
      'INSERT INTO seller_settlements',
      'INSERT INTO internal_settlements',
      'review_profits',
      'settled_amount',
      'cash_difference',
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('review_url: null');
  });
});

function actor(
  role: SellerMemberRole,
  allActiveStores: boolean,
): SellerPortalActor {
  return {
    accountId: `account-${role.toLowerCase()}`,
    identitySubjectId: `subject-${role.toLowerCase()}`,
    memberId: `member-${role.toLowerCase()}`,
    sellerOrganizationId: 'org-1',
    role,
    storeIds: allActiveStores ? [] : ['store-1'],
    allActiveStores,
    canManageProducts: role === 'OWNER' || role === 'OPERATIONS',
    me: {} as SellerPortalActor['me'],
  };
}

interface SellerReviewFixtureRow {
  review_case_id: string;
  formal_order_id: string;
  amazon_order_number: string;
  store_id: string;
  store_display_name: string;
  marketplace_code: 'JP';
  asin: string;
  product_name: string;
  review_type: PricingReviewType;
  review_status: ReviewCaseStatus;
  review_version: number;
  submitted_at: number;
  updated_at: number;
  decided_at: number | null;
  evidence_version_id: string;
  evidence_version_no: number;
  evidence_submitted_at: number;
  service_fee_amount_cny_fen: number | string | null;
  service_fee_accrued_at: number | null;
}

function caseRow(
  overrides: Partial<SellerReviewFixtureRow> = {},
): SellerReviewFixtureRow {
  return { ...baseCaseRow(), ...overrides };
}

function baseCaseRow(): SellerReviewFixtureRow {
  return {
    review_case_id: 'review-case-1',
    formal_order_id: 'formal-order-1',
    amazon_order_number: '111-1234567-1234567',
    store_id: 'store-1',
    store_display_name: 'Alpha 店铺',
    marketplace_code: 'JP' as const,
    asin: 'B0REVIEW01',
    product_name: '评论产品一',
    review_type: 'IMAGE',
    review_status: 'APPROVED',
    review_version: 2,
    submitted_at: 1000,
    updated_at: 2000,
    decided_at: 2000,
    evidence_version_id: 'evidence-version-1',
    evidence_version_no: 1,
    evidence_submitted_at: 1000,
    service_fee_amount_cny_fen: 2500,
    service_fee_accrued_at: 2000,
  };
}

function fileRow() {
  return {
    review_case_id: 'review-case-1',
    file_entity_link_id: 'file-link-1',
    file_version: 3,
    detected_mime: 'image/jpeg' as const,
    uploaded_byte_size: 1234,
    linked_at: 1000,
  };
}

function isCursor(value: unknown): value is {
  updated_at: number;
  review_case_id: string;
} {
  return typeof value === 'object'
    && value !== null
    && Number.isSafeInteger(
      (value as { updated_at?: unknown }).updated_at,
    )
    && typeof (value as { review_case_id?: unknown }).review_case_id
      === 'string';
}

function fakeDatabase(result: {
  all?: readonly (readonly unknown[])[];
  first?: readonly (unknown | null)[];
}): SqlDatabase & {
  calls: Array<{
    sql: string;
    bindings: unknown[];
    method: 'all' | 'first' | null;
  }>;
} {
  const calls: Array<{
    sql: string;
    bindings: unknown[];
    method: 'all' | 'first' | null;
  }> = [];
  const all = [...(result.all ?? [])];
  const first = [...(result.first ?? [])];
  return {
    calls,
    prepare(sql: string): SqlStatement {
      const call = {
        sql,
        bindings: [] as unknown[],
        method: null as 'all' | 'first' | null,
      };
      calls.push(call);
      const statement: SqlStatement = {
        bind(...bindings: unknown[]) {
          call.bindings = bindings;
          return statement;
        },
        async all<T>() {
          call.method = 'all';
          return { results: (all.shift() ?? []) as T[] };
        },
        async first<T>() {
          call.method = 'first';
          return (first.shift() ?? null) as T | null;
        },
        async run() {
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
    async batch(statements: readonly SqlStatement[]) {
      return statements.map(() => ({ meta: { changes: 0 } }));
    },
  };
}
