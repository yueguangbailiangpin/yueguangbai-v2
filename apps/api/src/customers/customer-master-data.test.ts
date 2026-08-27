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
  createBuyerCustomer,
} from './create-buyer';
import {
  createSellerOrganization,
} from './create-seller-organization';
import type {
  CustomerMasterActor,
} from './master-data-shared';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('customer master data', () => {
  it('creates a disabled buyer with an immediately allocated number and replays', async () => {
    database = createMigratedTestDatabase();
    seedStaffAndBuyerChannel(database);

    const first = await createBuyerCustomer(database, {
      marketplaceCode: 'AMAZON_JP',
      buyerChannelId: 'buyer-channel-wechat-b',
      displayName: ' 测试买家 ',
      wechatId: ' Buyer_Test_01 ',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'buyer:create:0001',
      requestId: 'request-buyer-1',
      now: 2000,
    });

    // Stage 6.6 (D-056): the final buyer number is allocated the moment the
    // profile is created, even while the buyer is still DISABLED.
    expect(first).toMatchObject({
      access_status: 'DISABLED',
      buyer_customer_no: '19700101B1001',
      replayed: false,
    });

    const replay = await createBuyerCustomer(database, {
      marketplaceCode: 'AMAZON_JP',
      buyerChannelId: 'buyer-channel-wechat-b',
      displayName: '测试买家',
      wechatId: 'buyer_test_01',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'buyer:create:0001',
      requestId: 'request-buyer-1',
      now: 2100,
    });

    expect(replay).toEqual({
      ...first,
      replayed: true,
    });

    const row = await database.prepare(`
      SELECT
        buyer.display_name,
        buyer.access_status,
        buyer.buyer_customer_no,
        claim.normalized_wechat,
        claim.status AS claim_status
      FROM buyer_customers buyer
      JOIN wechat_identity_claims claim
        ON claim.identity_subject_id=buyer.identity_subject_id
        AND claim.status='ACTIVE'
      WHERE buyer.id=?
    `).bind(first.buyer_customer_id).first<{
      display_name: string;
      access_status: string;
      buyer_customer_no: string | null;
      normalized_wechat: string;
      claim_status: string;
    }>();

    expect(row).toEqual({
      display_name: '测试买家',
      access_status: 'DISABLED',
      buyer_customer_no: '19700101B1001',
      normalized_wechat: 'buyer_test_01',
      claim_status: 'ACTIVE',
    });

    // Allocating on channel B never consumes another channel's sequence.
    const channels = await database.prepare(`
      SELECT id, next_sequence
      FROM buyer_channels
      WHERE id IN ('buyer-channel-wechat-b', 'buyer-channel-wechat-c')
      ORDER BY id
    `).all<{ id: string; next_sequence: number }>();
    expect(channels.results).toEqual([
      { id: 'buyer-channel-wechat-b', next_sequence: 1002 },
      { id: 'buyer-channel-wechat-c', next_sequence: 1 },
    ]);
  });

  it('continues B/C numbering from the historical maximum sequence (D-056)', async () => {
    database = createMigratedTestDatabase();
    seedStaffAndBuyerChannel(database);
    // Simulate the pre-launch raise of the channel counters to the historical
    // maximum sequence (buyer number 19700101B4321 => sequence 4321).
    database.raw.exec(
      `UPDATE buyer_channels SET next_sequence=4321 WHERE id='buyer-channel-wechat-b'`,
    );
    const created = await createBuyerCustomer(database, {
      marketplaceCode: 'AMAZON_JP',
      buyerChannelId: 'buyer-channel-wechat-b',
      displayName: '历史最大号后续买家',
      wechatId: 'historic_max_buyer_01',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'buyer:create:historic-max:0001',
      now: 2500,
    });
    expect(created.buyer_customer_no).toBe('19700101B4321');
    const row = database.raw
      .prepare(`SELECT next_sequence FROM buyer_channels WHERE id='buyer-channel-wechat-b'`)
      .get() as { next_sequence: number };
    expect(row.next_sequence).toBe(4322);
  });

  it('enforces global WeChat uniqueness across buyer and seller member identities', async () => {
    database = createMigratedTestDatabase();
    seedStaffAndBuyerChannel(database);

    await createBuyerCustomer(database, {
      marketplaceCode: 'AMAZON_JP',
      buyerChannelId: 'buyer-channel-wechat-b',
      displayName: '买家',
      wechatId: 'Shared_Wechat_01',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'buyer:create:0002',
      now: 2000,
    });

    await expect(createSellerOrganization(database, {
      marketplaceCode: 'AMAZON_JP',
      sellerChannelId: 'seller-channel-ido-mango',
      organizationName: '测试卖家',
      ownerDisplayName: '卖家负责人',
      ownerWechatId: ' shared_wechat_01 ',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'seller:create:0001',
      now: 2100,
    })).rejects.toMatchObject({
      code: 'WECHAT_ID_CONFLICT',
      status: 409,
    });
  });

  it('creates seller organizations with independent channel sequences', async () => {
    database = createMigratedTestDatabase();
    seedStaffAndBuyerChannel(database);

    const firstMango = await createSellerOrganization(database, {
      marketplaceCode: 'AMAZON_JP',
      sellerChannelId: 'seller-channel-ido-mango',
      organizationName: '卖家一',
      ownerDisplayName: '负责人一',
      ownerWechatId: 'seller_owner_01',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'seller:create:0002',
      now: 2000,
    });
    const secondMango = await createSellerOrganization(database, {
      marketplaceCode: 'AMAZON_JP',
      sellerChannelId: 'seller-channel-ido-mango',
      organizationName: '卖家二',
      ownerDisplayName: '负责人二',
      ownerWechatId: 'seller_owner_02',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'seller:create:0003',
      now: 2100,
    });
    const firstYgb = await createSellerOrganization(database, {
      marketplaceCode: 'AMAZON_JP',
      sellerChannelId: 'seller-channel-ygbceping',
      organizationName: '卖家三',
      ownerDisplayName: '负责人三',
      ownerWechatId: 'seller_owner_03',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'seller:create:0004',
      now: 2200,
    });

    expect(firstMango.seller_code).toBe('ido-mango-1');
    expect(secondMango.seller_code).toBe('ido-mango-2');
    expect(firstYgb.seller_code).toBe('ygbceping-1');

    const mangoChannel = await database.prepare(`
      SELECT created_at, updated_at, next_sequence
      FROM seller_channels
      WHERE id='seller-channel-ido-mango'
    `).first<{
      created_at: number;
      updated_at: number;
      next_sequence: number;
    }>();
    expect(mangoChannel?.next_sequence).toBe(3);
    expect(Number(mangoChannel?.updated_at))
      .toBeGreaterThan(Number(mangoChannel?.created_at));

    const owner = await database.prepare(`
      SELECT
        member.role,
        member.primary_owner,
        member.status,
        member.username_fallback,
        organization.status AS organization_status
      FROM seller_organization_members member
      JOIN seller_organizations organization
        ON organization.id=member.organization_id
      WHERE member.id=?
    `).bind(firstMango.owner_member_id).first<{
      role: string;
      primary_owner: number;
      status: string;
      username_fallback: string;
      organization_status: string;
    }>();

    expect(owner).toEqual({
      role: 'OWNER',
      primary_owner: 1,
      status: 'DISABLED',
      username_fallback: 'ido-mango-1-1',
      organization_status: 'DISABLED',
    });
  });

  // DELETED (subject removed by D-056): "allocates a buyer number only after
  // activation and never consumes another channel sequence" — buyer numbers
  // are now allocated at profile creation and the separate
  // allocateBuyerCustomerNumber command no longer exists. The
  // channel-isolation intent survives in the first test's channel C assertion.

  it('maps invalid WeChat input to a validation error', async () => {
    database = createMigratedTestDatabase();
    seedStaffAndBuyerChannel(database);

    await expect(createBuyerCustomer(database, {
      marketplaceCode: 'AMAZON_JP',
      buyerChannelId: 'buyer-channel-wechat-b',
      displayName: '无效微信买家',
      wechatId: 'bad wechat',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'buyer:create:invalid-wechat',
      now: 2000,
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    // DELETED (subject removed by D-056): the invalid
    // first-valid-order-business-date allocation half of this case — the
    // separate buyer-number allocation command no longer exists and numbers
    // are allocated at creation.
  });

  it('does not expose seller management to an actor without permission', async () => {
    database = createMigratedTestDatabase();
    seedStaffAndBuyerChannel(database);

    await expect(createSellerOrganization(database, {
      marketplaceCode: 'AMAZON_JP',
      sellerChannelId: 'seller-channel-ido-mango',
      organizationName: '无权限卖家',
      ownerDisplayName: '负责人',
      ownerWechatId: 'seller_forbidden_01',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'seller:create:forbidden',
      now: 2000,
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
      ('scope-customer-pre-jp','staff-pre-sales','pre_sales','AMAZON_JP',
       'ACTIVE','zz-phase3h-test-owner',1000,NULL,'TEST_PRIMARY',1000,1000,'PRIMARY'),
      ('scope-customer-seller-jp','staff-seller-ops','seller_ops','AMAZON_JP',
       'ACTIVE','zz-phase3h-test-owner',1000,NULL,'TEST_PRIMARY',1000,1000,'PRIMARY');

    -- The operational B/C channels are pre-seeded by migration 0027 (their
    -- codes are UNIQUE). Buyer numbers must be 13+ characters, so start the
    -- channel B counter at a four-digit sequence.
    UPDATE buyer_channels
    SET next_sequence=1001
    WHERE id='buyer-channel-wechat-b';
  `);
}

function actor(input: {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: readonly StaffPermissionCode[];
}): CustomerMasterActor {
  return {
    staffId: input.staffId,
    displayName: input.displayName,
    roles: input.roles,
    permissions: new Set(input.permissions),
  };
}

function preSalesActor(): CustomerMasterActor {
  return actor({
    staffId: 'staff-pre-sales',
    displayName: '售前',
    roles: ['pre_sales'],
    permissions: [
      'BUYER_CREATE',
      'ORDER_CONFIRM',
    ],
  });
}

function sellerOpsActor(): CustomerMasterActor {
  return actor({
    staffId: 'staff-seller-ops',
    displayName: '卖家对接',
    roles: ['seller_ops'],
    permissions: [
      'SELLER_MANAGE',
    ],
  });
}
