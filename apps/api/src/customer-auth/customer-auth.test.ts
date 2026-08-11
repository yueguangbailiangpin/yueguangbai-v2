import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { CUSTOMER_PASSWORD_DEFAULT_ITERATIONS } from '@ygb/domain';
import type {
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import {
  createBuyerCustomer,
} from '../customers/create-buyer';
import {
  createSellerOrganization,
} from '../customers/create-seller-organization';
import type {
  CustomerMasterActor,
} from '../customers/master-data-shared';
import {
  activateBuyerCustomer,
} from './activate-buyer';
import {
  activateSellerOrganizationOwner,
} from './activate-seller-owner';
import {
  authenticateCustomerPassword,
  issueCustomerSession,
  resolveCustomerSession,
} from './authenticate-customer';
import {
  changeCustomerPassword,
} from './change-password';
import type {
  CustomerAccessActor,
} from './customer-auth-shared';

const SESSION_SECRET =
  'test-customer-session-secret-longer-than-thirty-two-bytes';

let database: SqliteDatabase | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  database?.close();
  database = null;
});

describe('customer activation, authentication, and session lifecycle', () => {
  it('uses the current password work factor for an unknown account', async () => {
    database = createMigratedTestDatabase();
    const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');

    await expect(authenticateCustomerPassword(database, {
      loginIdentifier: 'unknown_customer_account',
      password: 'Unknown-Password-2026!',
    })).resolves.toBeNull();

    expect(deriveBits).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'PBKDF2',
        iterations: CUSTOMER_PASSWORD_DEFAULT_ITERATIONS,
      }),
      expect.anything(),
      256,
    );
  });

  it('activates a buyer, returns the temporary password once, and forces change', async () => {
    database = createMigratedTestDatabase();
    seedStaffAndBuyerChannel(database);

    const buyer = await createBuyerCustomer(database, {
      marketplaceCode: 'JP',
      buyerChannelId: 'buyer-channel-b',
      displayName: '测试买家',
      wechatId: 'buyer_login_01',
    }, {
      actor: preSalesMasterActor(),
      idempotencyKey: 'buyer:create:auth:0001',
      now: 2000,
    });

    const activated = await activateBuyerCustomer(database, {
      buyerCustomerId: buyer.buyer_customer_id,
      passwordIterations: 10_000,
    }, {
      actor: preSalesAccessActor(),
      idempotencyKey: 'buyer:activate:0001',
      requestId: 'request-activate-1',
      now: 3000,
    });

    expect(activated.temporary_password_available).toBe(true);
    expect(activated.temporary_password).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%]{20}$/u,
    );
    expect(activated.password_change_required).toBe(true);

    const replay = await activateBuyerCustomer(database, {
      buyerCustomerId: buyer.buyer_customer_id,
      passwordIterations: 10_000,
    }, {
      actor: preSalesAccessActor(),
      idempotencyKey: 'buyer:activate:0001',
      requestId: 'request-activate-1',
      now: 3100,
    });
    expect(replay).toMatchObject({
      account_id: activated.account_id,
      temporary_password: null,
      temporary_password_available: false,
      replayed: true,
    });

    const authenticated = await authenticateCustomerPassword(
      database,
      {
        loginIdentifier: ' BUYER_LOGIN_01 ',
        password: String(activated.temporary_password),
      },
    );
    expect(authenticated).toMatchObject({
      accountId: activated.account_id,
      accountType: 'BUYER',
      sessionVersion: 1,
      passwordChangeRequired: true,
    });

    await expect(authenticateCustomerPassword(database, {
      loginIdentifier: 'buyer_login_01',
      password: 'Wrong-Password-2026!',
    })).resolves.toBeNull();
  });

  it('changes the password and invalidates the previous signed session', async () => {
    database = createMigratedTestDatabase();
    seedStaffAndBuyerChannel(database);

    const buyer = await createBuyerCustomer(database, {
      marketplaceCode: 'JP',
      buyerChannelId: 'buyer-channel-b',
      displayName: '改密买家',
      wechatId: 'buyer_password_01',
    }, {
      actor: preSalesMasterActor(),
      idempotencyKey: 'buyer:create:auth:0002',
      now: 2000,
    });
    const activated = await activateBuyerCustomer(database, {
      buyerCustomerId: buyer.buyer_customer_id,
      passwordIterations: 10_000,
    }, {
      actor: preSalesAccessActor(),
      idempotencyKey: 'buyer:activate:0002',
      now: 3000,
    });
    const authenticated = await authenticateCustomerPassword(
      database,
      {
        loginIdentifier: 'buyer_password_01',
        password: String(activated.temporary_password),
      },
    );
    if (!authenticated) throw new Error('expected_authentication');

    const oldSession = await issueCustomerSession(
      authenticated,
      SESSION_SECRET,
      {
        now: 4000,
        ttlMs: 60_000,
      },
    );
    await expect(resolveCustomerSession(
      database,
      oldSession,
      SESSION_SECRET,
      5000,
    )).resolves.toMatchObject({
      accountId: activated.account_id,
      sessionVersion: 1,
      passwordChangeRequired: true,
    });

    const changed = await changeCustomerPassword(database, {
      accountId: activated.account_id,
      currentPassword: String(activated.temporary_password),
      newPassword: 'New-Secure-Password-2026!',
      passwordIterations: 10_000,
    }, {
      idempotencyKey: 'customer:password:0001',
      now: 6000,
    });
    expect(changed).toEqual({
      account_id: activated.account_id,
      session_version: 2,
      password_change_required: false,
      replayed: false,
    });

    await expect(resolveCustomerSession(
      database,
      oldSession,
      SESSION_SECRET,
      7000,
    )).resolves.toBeNull();

    await expect(authenticateCustomerPassword(database, {
      loginIdentifier: 'buyer_password_01',
      password: String(activated.temporary_password),
    })).resolves.toBeNull();

    const authenticatedNew = await authenticateCustomerPassword(
      database,
      {
        loginIdentifier: 'buyer_password_01',
        password: 'New-Secure-Password-2026!',
      },
    );
    expect(authenticatedNew).toMatchObject({
      sessionVersion: 2,
      passwordChangeRequired: false,
    });
  });

  it('activates a seller organization and its primary OWNER together', async () => {
    database = createMigratedTestDatabase();
    seedStaffAndBuyerChannel(database);

    const seller = await createSellerOrganization(database, {
      marketplaceCode: 'JP',
      sellerChannelId: 'seller-channel-ido-mango',
      organizationName: '登录测试卖家',
      ownerDisplayName: '卖家负责人',
      ownerWechatId: 'seller_login_01',
    }, {
      actor: sellerOpsMasterActor(),
      idempotencyKey: 'seller:create:auth:0001',
      now: 2000,
    });

    const activated = await activateSellerOrganizationOwner(
      database,
      {
        sellerOrganizationId: seller.seller_organization_id,
        passwordIterations: 10_000,
      },
      {
        actor: sellerOpsAccessActor(),
        idempotencyKey: 'seller:activate:0001',
        now: 3000,
      },
    );

    expect(activated).toMatchObject({
      seller_organization_id: seller.seller_organization_id,
      owner_member_id: seller.owner_member_id,
      session_version: 1,
      password_change_required: true,
      temporary_password_available: true,
    });

    const authenticated = await authenticateCustomerPassword(
      database,
      {
        loginIdentifier: 'SELLER_LOGIN_01',
        password: String(activated.temporary_password),
      },
    );
    expect(authenticated).toMatchObject({
      accountType: 'SELLER_MEMBER',
      passwordChangeRequired: true,
    });

    const statuses = await database.prepare(`
      SELECT
        organization.status AS organization_status,
        member.status AS member_status,
        account.status AS account_status
      FROM seller_organizations organization
      JOIN seller_organization_members member
        ON member.organization_id=organization.id
        AND member.primary_owner=1
      JOIN customer_login_accounts account
        ON account.identity_subject_id=member.identity_subject_id
      WHERE organization.id=?
    `).bind(
      seller.seller_organization_id,
    ).first<{
      organization_status: string;
      member_status: string;
      account_status: string;
    }>();

    expect(statuses).toEqual({
      organization_status: 'ACTIVE',
      member_status: 'ACTIVE',
      account_status: 'ACTIVE',
    });
  });

  it('blocks buyer activation when identity review is required or permission is absent', async () => {
    database = createMigratedTestDatabase();
    seedStaffAndBuyerChannel(database);

    const buyer = await createBuyerCustomer(database, {
      marketplaceCode: 'JP',
      buyerChannelId: 'buyer-channel-b',
      displayName: '待核验买家',
      wechatId: 'buyer_review_01',
    }, {
      actor: preSalesMasterActor(),
      idempotencyKey: 'buyer:create:auth:0003',
      now: 2000,
    });

    database.exec(`
      UPDATE buyer_customers
      SET identity_review_status='REVIEW_REQUIRED'
      WHERE id='${buyer.buyer_customer_id}';
    `);

    await expect(activateBuyerCustomer(database, {
      buyerCustomerId: buyer.buyer_customer_id,
      passwordIterations: 10_000,
    }, {
      actor: preSalesAccessActor(),
      idempotencyKey: 'buyer:activate:0003',
      now: 3000,
    })).rejects.toMatchObject({
      code: 'IDENTITY_REVIEW_REQUIRED',
      status: 409,
    });

    await expect(activateBuyerCustomer(database, {
      buyerCustomerId: buyer.buyer_customer_id,
      passwordIterations: 10_000,
    }, {
      actor: {
        ...preSalesAccessActor(),
        permissions: new Set(),
      },
      idempotencyKey: 'buyer:activate:0004',
      now: 3100,
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });
});

function seedStaffAndBuyerChannel(
  database: SqliteDatabase,
): void {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      (
        'staff-pre-sales', '售前', 'ACTIVE', 1,
        1, 1000, 1000, NULL
      ),
      (
        'staff-seller-ops', '卖家对接', 'ACTIVE', 1,
        1, 1000, 1000, NULL
      );

    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES
      (
        'staff-pre-sales', 'pre_sales', 'ACTIVE', NULL,
        1000, NULL, 1000, 1000
      ),
      (
        'staff-seller-ops', 'seller_ops', 'ACTIVE', NULL,
        1000, NULL, 1000, 1000
      );
    INSERT INTO staff_marketplace_scopes (
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES
      ('scope-auth-pre-jp','staff-pre-sales','pre_sales','AMAZON_JP',
       'ACTIVE','zz-phase3h-test-owner',1000,NULL,'TEST_PRIMARY',1000,1000,'PRIMARY'),
      ('scope-auth-seller-jp','staff-seller-ops','seller_ops','AMAZON_JP',
       'ACTIVE','zz-phase3h-test-owner',1000,NULL,'TEST_PRIMARY',1000,1000,'PRIMARY');

    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'buyer-channel-b', 'B', '买家渠道B',
      'ACTIVE', 1, 1, 1000, 1000, NULL
    );
  `);
}

function actor(input: {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: readonly StaffPermissionCode[];
}): CustomerMasterActor & CustomerAccessActor {
  return {
    staffId: input.staffId,
    displayName: input.displayName,
    roles: input.roles,
    permissions: new Set(input.permissions),
  };
}

function preSalesMasterActor(): CustomerMasterActor {
  return actor({
    staffId: 'staff-pre-sales',
    displayName: '售前',
    roles: ['pre_sales'],
    permissions: [
      'BUYER_CREATE',
      'BUYER_ACTIVATE_STANDARD',
    ],
  });
}

function preSalesAccessActor(): CustomerAccessActor {
  return actor({
    staffId: 'staff-pre-sales',
    displayName: '售前',
    roles: ['pre_sales'],
    permissions: [
      'BUYER_ACTIVATE_STANDARD',
    ],
  });
}

function sellerOpsMasterActor(): CustomerMasterActor {
  return actor({
    staffId: 'staff-seller-ops',
    displayName: '卖家对接',
    roles: ['seller_ops'],
    permissions: [
      'SELLER_MANAGE',
    ],
  });
}

function sellerOpsAccessActor(): CustomerAccessActor {
  return actor({
    staffId: 'staff-seller-ops',
    displayName: '卖家对接',
    roles: ['seller_ops'],
    permissions: [
      'SELLER_MANAGE',
    ],
  });
}
