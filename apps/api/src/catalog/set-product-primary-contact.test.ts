import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { StaffPermissionCode } from '@ygb/contracts';
import {
  setProductPrimaryContact,
} from './set-product-primary-contact';
import type { CatalogStaffActor } from './catalog-shared';

let database: SqliteDatabase | null = null;

beforeEach(() => {
  database = createMigratedTestDatabase();
  seedFixture(database);
});
afterEach(() => {
  database?.close();
  database = null;
});

describe('D-056 §4.4 product primary contact', () => {
  it('sets, transfers and clears the single primary contact with audited events', async () => {
    const d = database!;
    const first = await setProductPrimaryContact(d, {
      productId: 'product-contact-1',
      primaryContactMemberId: 'member-contact-1',
      expectedVersion: 1,
      reason: '首次指定对接人',
    }, command('contact-set-0001'));
    expect(first.replayed).toBe(false);
    expect(first.product.primary_contact_member_id).toBe('member-contact-1');
    expect(d.raw.prepare(`SELECT version FROM products WHERE id='product-contact-1'`)
      .get()).toEqual({ version: 2 });

    const transfer = await setProductPrimaryContact(d, {
      productId: 'product-contact-1',
      primaryContactMemberId: 'member-contact-2',
      expectedVersion: 2,
      reason: '对接人休假',
    }, command('contact-set-0002', 8100));
    expect(transfer.product.primary_contact_member_id).toBe('member-contact-2');

    const cleared = await setProductPrimaryContact(d, {
      productId: 'product-contact-1',
      primaryContactMemberId: null,
      expectedVersion: 3,
      reason: '清空对接人',
    }, command('contact-set-0003', 8200));
    expect(cleared.product.primary_contact_member_id).toBeNull();

    expect(d.raw.prepare(`SELECT COUNT(*) AS c FROM seller_product_primary_contact_events
      WHERE product_id='product-contact-1'`).get()).toEqual({ c: 3 });
    const events = d.raw.prepare(`SELECT previous_member_id, next_member_id, reason
      FROM seller_product_primary_contact_events WHERE product_id='product-contact-1'
      ORDER BY created_at`).all();
    expect(events[0]).toMatchObject({
      previous_member_id: null,
      next_member_id: 'member-contact-1',
    });
    expect(events[1]).toMatchObject({
      previous_member_id: 'member-contact-1',
      next_member_id: 'member-contact-2',
    });
    expect(events[2]).toMatchObject({
      previous_member_id: 'member-contact-2',
      next_member_id: null,
    });
    expect(d.raw.prepare(`SELECT COUNT(*) AS c FROM audit_events
      WHERE event_type='PRODUCT_PRIMARY_CONTACT_CHANGED'`).get()).toEqual({ c: 3 });
  });

  it('rejects cross-organization or inactive members at trigger level', async () => {
    const d = database!;
    await expect(setProductPrimaryContact(d, {
      productId: 'product-contact-1',
      primaryContactMemberId: 'member-other-org',
      expectedVersion: 1,
      reason: '跨组织成员',
    }, command('contact-set-wrong-org'))).rejects.toThrow();
    await expect(setProductPrimaryContact(d, {
      productId: 'product-contact-1',
      primaryContactMemberId: 'member-disabled',
      expectedVersion: 1,
      reason: '停用成员',
    }, command('contact-set-disabled'))).rejects.toThrow();
  });

  it('fails closed without SELLER_MANAGE or outside the seller_ops/owner roles', async () => {
    const d = database!;
    await expect(setProductPrimaryContact(d, {
      productId: 'product-contact-1',
      primaryContactMemberId: 'member-contact-1',
      expectedVersion: 1,
      reason: '无权限',
    }, command('contact-set-forbidden', {
      roles: ['pre_sales'],
      permissions: ['SELLER_MANAGE', 'PRODUCT_VIEW'],
    }))).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(setProductPrimaryContact(d, {
      productId: 'product-contact-1',
      primaryContactMemberId: 'member-contact-1',
      expectedVersion: 1,
      reason: '无权限码',
    }, command('contact-set-no-perm', {
      roles: ['seller_ops'],
      permissions: ['PRODUCT_VIEW'],
    }))).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('replays idempotently and rejects stale versions', async () => {
    const d = database!;
    const input = {
      productId: 'product-contact-1',
      primaryContactMemberId: 'member-contact-1',
      expectedVersion: 1,
      reason: '幂等重放',
    };
    await setProductPrimaryContact(d, input, command('contact-replay-0001'));
    const replay = await setProductPrimaryContact(d, input, command('contact-replay-0001'));
    expect(replay.replayed).toBe(true);
    expect(d.raw.prepare(`SELECT COUNT(*) AS c FROM seller_product_primary_contact_events`)
      .get()).toEqual({ c: 1 });
    await expect(setProductPrimaryContact(d, input, command('contact-stale-0001')))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
  });
});

function command(
  idempotencyKey: string,
  overridesOrNow: { roles?: string[]; permissions?: string[] } | number = {},
) {
  const overrides = typeof overridesOrNow === 'number' ? {} : overridesOrNow;
  const now = typeof overridesOrNow === 'number' ? overridesOrNow : 8000;
  return {
    actor: actor(overrides),
    idempotencyKey,
    now,
    requestId: `request-${idempotencyKey}`,
  };
}

function actor(
  overrides: { roles?: string[]; permissions?: string[] },
): CatalogStaffActor {
  return {
    staffId: 'staff-contact-owner',
    displayName: '对接人管理员',
    roles: (overrides.roles ?? ['seller_ops']) as CatalogStaffActor['roles'],
    permissions: new Set(
      (overrides.permissions ?? ['SELLER_MANAGE', 'PRODUCT_VIEW']) as StaffPermissionCode[],
    ),
    dataScope: {
      type: 'GLOBAL',
      marketplaceCodes: [],
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
    },
  };
}

export function seedFixture(d: SqliteDatabase): void {
  d.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES ('staff-contact-owner','对接人管理员','ACTIVE',1,1,1000,1000,NULL);

    INSERT INTO seller_channels (
      id, code, prefix, name, status, version, created_at, updated_at, disabled_at
    ) VALUES ('seller-channel-contact','contact','contact-','对接渠道','ACTIVE',1,1000,1000,NULL);
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status, version,
      created_at, updated_at, activated_at, next_member_number
    ) VALUES
      ('org-contact-1','AMAZON_JP','contact-org-1','seller-channel-contact','seller-channel-contact',
       9601,'对接组织一','ACTIVE',1,1000,1000,1000,4),
      ('org-contact-other','AMAZON_JP','contact-org-2','seller-channel-contact','seller-channel-contact',
       9602,'对接组织二','ACTIVE',1,1000,1000,1000,2);
    INSERT INTO customer_identity_subjects (id, subject_type, created_at) VALUES
      ('subject-contact-1','SELLER_ORG_MEMBER',1000),
      ('subject-contact-2','SELLER_ORG_MEMBER',1000),
      ('subject-contact-disabled','SELLER_ORG_MEMBER',1000),
      ('subject-contact-other','SELLER_ORG_MEMBER',1000);
    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id, member_number, username_fallback,
      display_name, role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('member-contact-1','subject-contact-1','org-contact-1',1,'contact-org-1-1',
       '成员一','OPERATIONS',0,'ACTIVE',1,1000,1000,1000,NULL),
      ('member-contact-2','subject-contact-2','org-contact-1',2,'contact-org-1-2',
       '成员二','OPERATIONS',0,'ACTIVE',1,1000,1000,1000,NULL),
      ('member-disabled','subject-contact-disabled','org-contact-1',3,'contact-org-1-3',
       '停用成员','OPERATIONS',0,'DISABLED',2,1000,2000,1000,2000),
      ('member-other-org','subject-contact-other','org-contact-other',1,'contact-org-2-1',
       '他组成员','OPERATIONS',0,'ACTIVE',1,1000,1000,1000,NULL);
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name, normalized_name,
      status, version, created_at, updated_at, disabled_at
    ) VALUES ('store-contact-1','org-contact-1','AMAZON_JP','对接店铺','对接店铺',
      'ACTIVE',1,1000,1000,NULL);
    INSERT INTO products (
      id, organization_id, store_id, marketplace_code, asin_display, asin_normalized,
      status, current_version_no, version, created_at, updated_at, disabled_at
    ) VALUES ('product-contact-1','org-contact-1','store-contact-1','AMAZON_JP',
      'B0CONTACT1','B0CONTACT1','ACTIVE',1,1,1000,1000,NULL);
  `);
}
