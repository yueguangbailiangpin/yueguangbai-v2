import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import {
  boundedReconciliationLimit,
  reconcilePendingStaffWorkItems,
} from './reconciliation-service';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('historical staff work-item reconciliation', () => {
  it('is bounded and idempotently repairs a pending product application', async () => {
    expect(boundedReconciliationLimit()).toBe(50);
    expect(boundedReconciliationLimit(100)).toBe(100);
    expect(() => boundedReconciliationLimit(101)).toThrow('VALIDATION_ERROR');

    database = createMigratedTestDatabase();
    database.exec(`
      INSERT INTO staff_users (
        id,display_name,status,authorization_version,version,
        created_at,updated_at,disabled_at
      ) VALUES ('reconcile-seller-ops','Reconciliation Seller Ops',
        'ACTIVE',1,1,1000,1000,NULL);
      INSERT INTO staff_role_assignments (
        staff_id,role_code,status,assigned_by_staff_id,
        assigned_at,revoked_at,created_at,updated_at
      ) VALUES ('reconcile-seller-ops','seller_ops','ACTIVE',
        'zz-phase3h-test-owner',1000,NULL,1000,1000);
      INSERT INTO staff_marketplace_scopes (
        id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
        assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
      ) VALUES ('scope-reconcile-seller-jp','reconcile-seller-ops','seller_ops',
        'AMAZON_JP','ACTIVE','zz-phase3h-test-owner',1000,NULL,
        'TEST_PRIMARY',1000,1000,'PRIMARY');
      INSERT INTO seller_organizations (
        id, marketplace_code, seller_code,
        origin_channel_id, current_channel_id, seller_sequence,
        organization_name, status, version, created_at, updated_at,
        activated_at, disabled_at, next_member_number
      ) VALUES (
        'reconcile-seller', 'JP', 'reconcile-seller-1',
        'seller-channel-ido-mango', 'seller-channel-ido-mango', 9001,
        'Reconciliation Seller', 'ACTIVE', 1, 1000, 1000,
        1000, NULL, 2
      );
      INSERT INTO customer_identity_subjects (id, subject_type, created_at)
      VALUES ('reconcile-member-subject', 'SELLER_ORG_MEMBER', 1000);
      INSERT INTO seller_organization_members (
        id, identity_subject_id, organization_id, member_number,
        username_fallback, display_name, role, primary_owner, status, version,
        created_at, updated_at, activated_at, disabled_at
      ) VALUES (
        'reconcile-member', 'reconcile-member-subject', 'reconcile-seller', 1,
        'reconcile-seller-1-1', 'Reconciliation Member', 'OWNER', 1, 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      );
      INSERT INTO seller_stores (
        id, organization_id, marketplace_code, display_name, normalized_name,
        status, version, created_at, updated_at, disabled_at
      ) VALUES (
        'reconcile-store', 'reconcile-seller', 'JP', 'Reconciliation Store',
        'reconciliation-store', 'ACTIVE', 1, 1000, 1000, NULL
      );
      INSERT INTO product_applications (
        id, organization_id, store_id, marketplace_code, submitted_by_member_id,
        asin_display, asin_normalized, product_name, search_keywords_json,
        product_url, buyer_visible_notes, seller_notes, status, review_reason,
        reviewed_by_staff_id, product_id, version, submitted_at, updated_at,
        reviewed_at, withdrawn_at
      ) VALUES (
        'reconcile-application', 'reconcile-seller', 'reconcile-store', 'JP',
        'reconcile-member', 'B0RECON001', 'B0RECON001', 'Reconciliation Product',
        '[]', NULL, NULL, NULL, 'SUBMITTED', NULL, NULL, NULL, 1, 1100, 1100,
        NULL, NULL
      );
    `);

    const first = await reconcilePendingStaffWorkItems(database, {
      marketplaceCode: 'JP',
      limit: 1,
      now: 2000,
    });
    expect(first).toMatchObject({ scanned: 1, prepared: 1, replayed: 0, skipped: 0 });
    expect(database.raw.prepare(`
      SELECT work_type, source_entity_type, source_entity_id, status
      FROM staff_work_items
      WHERE source_entity_id='reconcile-application'
    `).get()).toEqual({
      work_type: 'PRODUCT_APPLICATION_REVIEW',
      source_entity_type: 'PRODUCT_APPLICATION',
      source_entity_id: 'reconcile-application',
      status: 'OPEN',
    });

    const second = await reconcilePendingStaffWorkItems(database, {
      marketplaceCode: 'JP',
      now: 2100,
    });
    expect(second).toMatchObject({ scanned: 0, prepared: 0, replayed: 0, skipped: 0 });
  });
});
