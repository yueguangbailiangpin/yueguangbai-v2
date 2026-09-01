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
  authenticateCustomerPassword,
} from '../customer-auth/authenticate-customer';
import {
  createBuyerCustomer,
} from '../customers/create-buyer';
import {
  resolveSellerMemberStoreAccess,
} from '../catalog/seller-member-store-access';
import type {
  CustomerMasterActor,
} from '../customers/master-data-shared';
import {
  activateSellerOrganizationMember,
} from './activate-seller-member';
import {
  createSellerOrganizationMember,
} from './create-seller-member';
import type {
  SellerMemberStaffActor,
} from './seller-member-shared';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('seller member lifecycle', () => {
  it('creates sequential disabled members with explicit store scopes and idempotent replay', async () => {
    database = createMigratedTestDatabase();
    seedSellerMemberFixture(database);

    const first = await createSellerOrganizationMember(
      database,
      {
        sellerOrganizationId: 'seller-org-1',
        displayName: '运营成员',
        wechatId: 'seller_ops_member_01',
        role: 'OPERATIONS',
      },
      {
        actor: sellerOpsActor(),
        idempotencyKey: 'seller-member:create:0001',
        now: 2000,
      },
    );

    expect(first).toMatchObject({
      seller_organization_id: 'seller-org-1',
      member_number: 2,
      username_fallback: 'ido-mango-5001-2',
      role: 'OPERATIONS',
      status: 'DISABLED',
      replayed: false,
    });

    const replay = await createSellerOrganizationMember(
      database,
      {
        sellerOrganizationId: 'seller-org-1',
        displayName: '运营成员',
        wechatId: 'SELLER_OPS_MEMBER_01',
        role: 'OPERATIONS',
      },
      {
        actor: sellerOpsActor(),
        idempotencyKey: 'seller-member:create:0001',
        now: 2100,
      },
    );
    expect(replay).toEqual({
      ...first,
      replayed: true,
    });

    const second = await createSellerOrganizationMember(
      database,
      {
        sellerOrganizationId: 'seller-org-1',
        displayName: '财务成员',
        wechatId: 'seller_finance_member_01',
        role: 'FINANCE',
      },
      {
        actor: sellerOpsActor(),
        idempotencyKey: 'seller-member:create:0002',
        now: 2200,
      },
    );
    expect(second.member_number).toBe(3);
    expect(second.username_fallback)
      .toBe('ido-mango-5001-3');

    const organization = await database.prepare(`
      SELECT next_member_number, version
      FROM seller_organizations
      WHERE id='seller-org-1'
    `).first<{
      next_member_number: number;
      version: number;
    }>();
    expect(organization).toEqual({
      next_member_number: 4,
      version: 3,
    });

    await expect(resolveSellerMemberStoreAccess(
      database,
      first.seller_member_id,
    )).resolves.toBeNull();
  });

  it('activates a member, exposes the temporary password once, and enables scoped login', async () => {
    database = createMigratedTestDatabase();
    seedSellerMemberFixture(database);

    const created = await createSellerOrganizationMember(
      database,
      {
        sellerOrganizationId: 'seller-org-1',
        displayName: '待激活运营',
        wechatId: 'seller_member_login_01',
        role: 'OPERATIONS',
      },
      {
        actor: sellerOpsActor(),
        idempotencyKey: 'seller-member:create:0003',
        now: 2000,
      },
    );

    const activated = await activateSellerOrganizationMember(
      database,
      {
        sellerMemberId: created.seller_member_id,
        passwordIterations: 10_000,
      },
      {
        actor: sellerOpsActor(),
        idempotencyKey: 'seller-member:activate:0001',
        now: 3000,
      },
    );

    expect(activated.temporary_password_available).toBe(true);
    expect(activated.temporary_password).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%]{20}$/u,
    );

    const replay = await activateSellerOrganizationMember(
      database,
      {
        sellerMemberId: created.seller_member_id,
        passwordIterations: 10_000,
      },
      {
        actor: sellerOpsActor(),
        idempotencyKey: 'seller-member:activate:0001',
        now: 3100,
      },
    );
    expect(replay).toMatchObject({
      account_id: activated.account_id,
      temporary_password: null,
      temporary_password_available: false,
      replayed: true,
    });

    const authenticated = await authenticateCustomerPassword(
      database,
      {
        loginIdentifier: 'SELLER_MEMBER_LOGIN_01',
        password: String(activated.temporary_password),
      },
    );
    expect(authenticated).toMatchObject({
      accountId: activated.account_id,
      accountType: 'SELLER_MEMBER',
      passwordChangeRequired: true,
    });

    const access = await resolveSellerMemberStoreAccess(
      database,
      created.seller_member_id,
    );
    expect(access).toMatchObject({
      memberId: created.seller_member_id,
      sellerOrganizationId: 'seller-org-1',
      role: 'OPERATIONS',
      allActiveStores: true,
      canManageProducts: true,
    });
  });

  it('enforces global WeChat uniqueness across buyers and new seller members', async () => {
    database = createMigratedTestDatabase();
    seedSellerMemberFixture(database);

    await createBuyerCustomer(database, {
      marketplaceCode: 'AMAZON_JP',
      buyerChannelId: 'buyer-channel-wechat-b',
      displayName: '冲突买家',
      wechatId: 'shared_member_wechat_01',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'buyer:create:member-conflict:0001',
      now: 2000,
    });

    await expect(createSellerOrganizationMember(
      database,
      {
        sellerOrganizationId: 'seller-org-1',
        displayName: '冲突成员',
        wechatId: ' SHARED_MEMBER_WECHAT_01 ',
        role: 'VIEWER',
      },
      {
        actor: sellerOpsActor(),
        idempotencyKey: 'seller-member:create:conflict:0001',
        now: 2100,
      },
    )).rejects.toMatchObject({
      code: 'WECHAT_ID_CONFLICT',
      status: 409,
    });
  });

  it('creates OWNER members without store scoping and rejects missing permission', async () => {
    database = createMigratedTestDatabase();
    seedSellerMemberFixture(database);

    // D-056 §4.4: creation no longer carries store scopes at all; an OWNER
    // member can be created directly.
    const ownerMember = await createSellerOrganizationMember(
      database,
      {
        sellerOrganizationId: 'seller-org-1',
        displayName: '次级负责人',
        wechatId: 'secondary_owner_01',
        role: 'OWNER',
      },
      {
        actor: sellerOpsActor(),
        idempotencyKey: 'seller-member:create:owner:0001',
        now: 2000,
      },
    );
    expect(ownerMember.role).toBe('OWNER');

    await expect(createSellerOrganizationMember(
      database,
      {
        sellerOrganizationId: 'seller-org-1',
        displayName: '无权限成员',
        wechatId: 'forbidden_member_01',
        role: 'VIEWER',
      },
      {
        actor: {
          ...sellerOpsActor(),
          permissions: new Set(),
        },
        idempotencyKey: 'seller-member:create:forbidden:0001',
        now: 2200,
      },
    )).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('keeps seller member events immutable', async () => {
    database = createMigratedTestDatabase();
    seedSellerMemberFixture(database);

    const created = await createSellerOrganizationMember(
      database,
      {
        sellerOrganizationId: 'seller-org-1',
        displayName: '审计成员',
        wechatId: 'audit_member_01',
        role: 'VIEWER',
      },
      {
        actor: sellerOpsActor(),
        idempotencyKey: 'seller-member:create:audit:0001',
        now: 2000,
      },
    );

    await expect(database.prepare(`
      UPDATE seller_member_events
      SET event_type='SELLER_MEMBER_DISABLED'
      WHERE member_id=?
    `).bind(created.seller_member_id).run())
      .rejects.toThrow(
        'seller_member_events_are_immutable',
      );

    await expect(database.prepare(`
      DELETE FROM seller_member_events
      WHERE member_id=?
    `).bind(created.seller_member_id).run())
      .rejects.toThrow(
        'seller_member_events_are_immutable',
      );
  });
});

function seedSellerMemberFixture(
  database: SqliteDatabase,
): void {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      (
        'staff-seller-ops', '卖家对接', 'ACTIVE', 1,
        1, 1000, 1000, NULL
      ),
      (
        'staff-pre-sales', '售前', 'ACTIVE', 1,
        1, 1000, 1000, NULL
      );

    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES
      (
        'staff-seller-ops', 'seller_ops', 'ACTIVE', NULL,
        1000, NULL, 1000, 1000
      ),
      (
        'staff-pre-sales', 'pre_sales', 'ACTIVE', NULL,
        1000, NULL, 1000, 1000
      );
    INSERT INTO staff_marketplace_scopes (
      id, staff_id, role_code, marketplace_code, status,
      assigned_by_staff_id, assigned_at, revoked_at, reason,
      created_at, updated_at, scope_kind
    ) VALUES ('scope-member-pre-sales-jp', 'staff-pre-sales', 'pre_sales',
      'AMAZON_JP', 'ACTIVE', NULL, 1000, NULL, 'TEST',
      1000, 1000, 'PRIMARY');

    -- Buyer numbers must be at least 13 characters (YYYYMMDD + B/C + 4+
    -- digits), so seed the operational channel counter high enough for the
    -- locally allocated numbers to satisfy the format.
    UPDATE buyer_channels
    SET next_sequence=1001
    WHERE id='buyer-channel-wechat-b';

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES
      (
        'seller-org-1', 'AMAZON_JP', 'ido-mango-5001',
        'seller-channel-ido-mango',
        'seller-channel-ido-mango',
        5001, '卖家组织一', 'ACTIVE',
        1, 1000, 1000, 1000, NULL, 2
      ),
      (
        'seller-org-2', 'AMAZON_JP', 'ygbceping-5001',
        'seller-channel-ygbceping',
        'seller-channel-ygbceping',
        5001, '卖家组织二', 'ACTIVE',
        1, 1000, 1000, 1000, NULL, 2
      );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES (
      'subject-primary-owner',
      'SELLER_ORG_MEMBER',
      1000
    );

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'primary-owner-member',
      'subject-primary-owner',
      'seller-org-1',
      1,
      'ido-mango-5001-1',
      '主负责人',
      'OWNER',
      1,
      'ACTIVE',
      1,
      1000,
      1000,
      1000,
      NULL
    );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES
      (
        'store-1', 'seller-org-1', 'AMAZON_JP',
        '店铺一', '店铺一', 'ACTIVE',
        1, 1000, 1000, NULL
      ),
      (
        'store-2', 'seller-org-1', 'AMAZON_JP',
        '店铺二', '店铺二', 'ACTIVE',
        1, 1000, 1000, NULL
      ),
      (
        'store-other-org', 'seller-org-2', 'AMAZON_JP',
        '其他组织店铺', '其他组织店铺', 'ACTIVE',
        1, 1000, 1000, NULL
      );
  `);
}

function actor(input: {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: readonly StaffPermissionCode[];
}): SellerMemberStaffActor {
  return {
    staffId: input.staffId,
    displayName: input.displayName,
    roles: input.roles,
    permissions: new Set(input.permissions),
  };
}

function sellerOpsActor(): SellerMemberStaffActor {
  return actor({
    staffId: 'staff-seller-ops',
    displayName: '卖家对接',
    roles: ['seller_ops'],
    permissions: ['SELLER_MANAGE'],
  });
}

function preSalesActor(): CustomerMasterActor {
  return {
    staffId: 'staff-pre-sales',
    displayName: '售前',
    roles: ['pre_sales'],
    permissions: new Set(['BUYER_CREATE']),
  };
}
