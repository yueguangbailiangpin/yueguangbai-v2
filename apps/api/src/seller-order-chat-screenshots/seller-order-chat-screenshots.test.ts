import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  FileActor,
  FileReadPrincipal,
} from '@ygb/contracts';
import { SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS } from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { sha256Hex } from '@ygb/domain';
import { createApp } from '../app';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import {
  resolveAssignmentStaffAuthorization,
  type AssignmentStaffAuthorization,
} from '../staff-assignment';
import { DenyAllFileAuthorizationService } from '../files/authorization';
import {
  consumeFileReadIntent,
  createFileReadIntent,
} from '../files/file-read-service';
import { MockObjectStorage } from '../files/mock-object-storage';
import { attachSellerOrderChatScreenshot } from './command';
import {
  requireSellerOrderChatScreenshot,
  type SellerOrderChatScreenshotAccess,
} from './read-model';
import { registerSellerOrderChatScreenshotRoutes } from './routes';
import { listSellerFormalOrders } from '../seller-formal-orders/read-model';

const BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const NOW = 10_000;
const ORIGIN = 'https://portal.local.test';
const SESSION_SECRET =
  'seller-order-chat-screenshot-secret-at-least-thirty-two-bytes';

let database: SqliteDatabase;
let storage: MockObjectStorage;

beforeEach(async () => {
  database = createMigratedTestDatabase();
  storage = new MockObjectStorage();
  await seedChatFixture(database, storage);
});

afterEach(() => database.close());

describe('seller order chat screenshot access Change', () => {
  it('uses the real Staff authorization resolver to enforce Personal DENY with no business partial write', async () => {
    database.exec(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at,
        created_at, updated_at
      ) VALUES (
        'staff-chat-owner', 'ORDER_CONFIRM', 'DENY', 'ACTIVE',
        'chat screenshot Personal DENY regression',
        'staff-chat-owner', 9000, NULL, 9000, 9000
      )
    `);
    const denied = await resolveAssignmentStaffAuthorization(
      database,
      'staff-chat-owner',
    );
    expect(denied).not.toBeNull();
    expect(denied?.roles).toEqual(new Set(['owner']));
    expect(denied?.permissions.has('ORDER_CONFIRM')).toBe(false);
    const before = await attachmentSideEffects();
    await expect(attachSellerOrderChatScreenshot(
      database,
      { formalOrderId: 'formal-order-1', fileObjectId: 'chat-file-1', expectedFileVersion: 2 },
      { actor: denied!, idempotencyKey: 'chat-denied', now: NOW },
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await attachmentSideEffects()).toEqual(before);
  });

  it('binds a verified Staff-owned screenshot to exactly one formal order with explicit Seller audience', async () => {
    const result = await attachSellerOrderChatScreenshot(
      database,
      { formalOrderId: 'formal-order-1', fileObjectId: 'chat-file-1', expectedFileVersion: 2 },
      { actor: staffActor(), idempotencyKey: 'chat-attach-1', now: NOW },
    );
    expect(result).toMatchObject({
      formal_order_id: 'formal-order-1',
      file_object_id: 'chat-file-1',
      replayed: false,
    });
    const attachment = await database.prepare(`
      SELECT order_evidence_submission_id, file_entity_link_id
      FROM order_evidence_internal_files
      WHERE id=?
    `).bind(result.screenshot_id).first<{
      order_evidence_submission_id: string;
      file_entity_link_id: string;
    }>();
    expect(attachment).toMatchObject({
      order_evidence_submission_id: 'submission-1',
    });
    await expect(database.prepare(`
      SELECT visibility, purpose, authorization_mode
      FROM file_entity_links WHERE id=?
    `).bind(attachment?.file_entity_link_id).first()).resolves.toMatchObject({
      visibility: 'SELLER_VISIBLE',
      purpose: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
      authorization_mode: 'EXPLICIT_AUDIENCES',
    });
  });

  it('attaches a platform screenshot, projects AVAILABLE, and issues an opaque one-time short read intent', async () => {
    seedPlatformChatFormalOrder(database);
    const owner = sellerActor(
      'member-owner', 'account-owner', 'subject-owner', 'org-1', true, [],
    );
    const before = await listSellerFormalOrders(
      database,
      owner,
      { cursor: null, limit: 20 },
      platformFormalOrderFilters(),
    );
    expect(before.items).toHaveLength(1);
    expect(before.items[0]?.chat_screenshot).toEqual({
      status: 'NONE', file_version: null,
    });
    await expect(requireSellerOrderChatScreenshot(
      database, owner, 'platform-formal-chat', NOW,
    )).rejects.toMatchObject({ code: 'FORMAL_ORDER_NOT_FOUND' });

    const attached = await attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'platform-formal-chat',
        fileObjectId: 'chat-file-1',
        expectedFileVersion: 2,
      },
      { actor: staffActor(), idempotencyKey: 'platform-chat-attach', now: NOW },
    );
    expect(attached).toMatchObject({
      formal_order_id: 'platform-formal-chat',
      file_object_id: 'chat-file-1',
      replayed: false,
    });
    await expect(database.prepare(`
      SELECT
        attachment.platform_formal_order_id,
        evidence.evidence_type,
        evidence.seller_organization_id,
        evidence.seller_store_id,
        file_link.entity_type,
        file_link.purpose,
        file_link.authorization_mode,
        grant.subject_type,
        grant.seller_organization_id AS grant_seller_organization_id
      FROM platform_order_evidence_internal_files attachment
      JOIN platform_order_evidence_records evidence
        ON evidence.id=attachment.platform_order_evidence_record_id
      JOIN file_entity_links file_link
        ON file_link.id=attachment.file_entity_link_id
      JOIN file_entity_audience_grants grant
        ON grant.file_entity_link_id=file_link.id
    `).first()).resolves.toMatchObject({
      platform_formal_order_id: 'platform-formal-chat',
      evidence_type: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
      seller_organization_id: 'org-1',
      seller_store_id: 'store-platform-chat',
      entity_type: 'ORDER_EVIDENCE_SUBMISSION',
      purpose: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
      authorization_mode: 'EXPLICIT_AUDIENCES',
      subject_type: 'SELLER_ORGANIZATION',
      grant_seller_organization_id: 'org-1',
    });

    const after = await listSellerFormalOrders(
      database,
      owner,
      { cursor: null, limit: 20 },
      platformFormalOrderFilters(),
    );
    expect(after.items[0]?.chat_screenshot).toEqual({
      status: 'AVAILABLE', file_version: 2,
    });

    const app = routeApp(staffActor());
    const response = await sellerReadIntentRequest(
      app,
      'platform-formal-chat',
      'owner',
      { expected_file_version: 2 },
      'platform-chat-read-intent',
    );
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    expect(body.data.read_intent).toMatchObject({
      read_intent_id: expect.any(String),
      access_token: expect.any(String),
      access_token_available: true,
      expires_at: expect.any(Number),
      replayed: false,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('chat-file-1');
    expect(serialized).not.toContain('files/v1/');
    expect(serialized).not.toContain('object_key');
    expect(serialized).not.toContain('http://');
    expect(serialized).not.toContain('https://');

    const access = await requireSellerOrderChatScreenshot(
      database, owner, 'platform-formal-chat', NOW,
    );
    const issued = await issue(
      access,
      sellerFileActor('member-owner'),
      sellerPrincipal('account-owner', 'subject-owner'),
      'platform-chat-direct-intent',
      20_000,
    );
    const content = await consume(
      issued,
      sellerFileActor('member-owner'),
      sellerPrincipal('account-owner', 'subject-owner'),
      20_001,
    );
    expect(content.contentType).toBe('image/png');
  });

  it('conceals platform attach from Staff Personal DENY and wrong organization scope without partial writes', async () => {
    seedPlatformChatFormalOrder(database);
    database.exec(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES (
        'staff-chat-owner', 'ORDER_CONFIRM', 'DENY', 'ACTIVE',
        'platform screenshot Personal DENY', 'staff-chat-owner',
        9000, NULL, 9000, 9000
      )
    `);
    const denied = await resolvedStaff('staff-chat-owner');
    const beforeDeny = await attachmentSideEffects();
    await expect(attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'platform-formal-chat',
        fileObjectId: 'chat-file-1',
        expectedFileVersion: 2,
      },
      { actor: denied, idempotencyKey: 'platform-personal-deny', now: NOW },
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await attachmentSideEffects()).toEqual(beforeDeny);

    const scoped = await resolvedStaff('staff-chat-scoped');
    database.exec(`
      INSERT INTO seller_staff_assignments (
        id, seller_organization_id, duty_code, staff_id, status, source,
        assigned_by_actor_type, assigned_by_actor_id, reason, version,
        created_at, updated_at, revoked_at
      ) VALUES (
        'platform-chat-wrong-org', 'org-2', 'SELLER_ACCOUNT_MANAGER',
        'staff-chat-scoped', 'ACTIVE', 'MANUAL_REASSIGN',
        'STAFF', 'staff-chat-owner', 'platform wrong scope', 1,
        9000, 9000, NULL
      )
    `);
    await expect(attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'platform-formal-chat',
        fileObjectId: 'chat-file-1',
        expectedFileVersion: 2,
      },
      { actor: scoped, idempotencyKey: 'platform-wrong-org', now: NOW },
    )).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await attachmentSideEffects()).toEqual(beforeDeny);
  });

  it.each(['link', 'grant', 'file', 'store', 'member'] as const)(
    'dynamically conceals a platform screenshot after %s revocation',
    async (authority) => {
      seedPlatformChatFormalOrder(database);
      if (authority === 'member') {
        database.exec(`
          INSERT INTO seller_member_store_scopes (
            member_id, store_id, organization_id, status,
            assigned_by_staff_id, assigned_at, revoked_at,
            created_at, updated_at
          ) VALUES (
            'member-operator', 'store-platform-chat', 'org-1', 'ACTIVE',
            'staff-chat-owner', 1, NULL, 1, 1
          )
        `);
      }
      await attachSellerOrderChatScreenshot(
        database,
        {
          formalOrderId: 'platform-formal-chat',
          fileObjectId: 'chat-file-1',
          expectedFileVersion: 2,
        },
        { actor: staffActor(), idempotencyKey: `platform-${authority}-attach`, now: NOW },
      );
      const seller = authority === 'member'
        ? sellerActor(
            'member-operator', 'account-operator', 'subject-operator',
            'org-1', false, ['store-1', 'store-platform-chat'],
          )
        : sellerActor(
            'member-owner', 'account-owner', 'subject-owner',
            'org-1', true, [],
          );
      const fileActor = authority === 'member'
        ? sellerFileActor('member-operator')
        : sellerFileActor('member-owner');
      const principal = authority === 'member'
        ? sellerPrincipal('account-operator', 'subject-operator')
        : sellerPrincipal('account-owner', 'subject-owner');
      const access = await requireSellerOrderChatScreenshot(
        database,
        seller,
        'platform-formal-chat',
        NOW,
      );
      const issued = await issue(
        access,
        fileActor,
        principal,
        `platform-${authority}-issued`,
        NOW,
      );
      await revokePlatformScreenshotAuthority(authority, access, NOW + 1);

      const app = routeApp(staffActor());
      const response = await sellerReadIntentRequest(
        app,
        'platform-formal-chat',
        authority === 'member' ? 'operator' : 'owner',
        { expected_file_version: 2 },
        `platform-${authority}-after-revoke`,
      );
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'FORMAL_ORDER_NOT_FOUND' },
      });
      await expect(consume(
        issued,
        fileActor,
        principal,
        NOW + 2,
      )).rejects.toMatchObject({
        code: authority === 'file' ? 'FILE_READ_INTENT_NOT_FOUND' : 'FORBIDDEN',
      });
    },
  );

  it('conceals platform screenshots across organization and store scope', async () => {
    seedPlatformChatFormalOrder(database);
    await attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'platform-formal-chat',
        fileObjectId: 'chat-file-1',
        expectedFileVersion: 2,
      },
      { actor: staffActor(), idempotencyKey: 'platform-scope-attach', now: NOW },
    );
    await expect(requireSellerOrderChatScreenshot(
      database,
      sellerActor(
        'member-other', 'account-other', 'subject-other', 'org-2', true, [],
      ),
      'platform-formal-chat',
      NOW,
    )).rejects.toMatchObject({ code: 'FORMAL_ORDER_NOT_FOUND' });
    await expect(requireSellerOrderChatScreenshot(
      database,
      sellerActor(
        'member-operator', 'account-operator', 'subject-operator',
        'org-1', false, ['store-1'],
      ),
      'platform-formal-chat',
      NOW,
    )).rejects.toMatchObject({ code: 'FORMAL_ORDER_NOT_FOUND' });
  });

  it.each([
    ['cross-store', 'org-1'],
    ['cross-organization', 'org-2'],
  ] as const)(
    'rejects a direct %s platform evidence/file association at the 0042 guard',
    async (suffix, organizationId) => {
      seedPlatformChatFormalOrder(database);
      const storeId = `store-platform-${suffix}`;
      const productId = `platform-product-${suffix}`;
      const orderId = `platform-order-${suffix}`;
      const evidenceId = `platform-evidence-${suffix}`;
      database.exec(`
        INSERT INTO seller_stores (
          id, organization_id, marketplace_code, display_name,
          normalized_name, status, version, created_at, updated_at, disabled_at
        ) VALUES (
          '${storeId}', '${organizationId}', 'JP', '${suffix}', '${suffix}',
          'ACTIVE', 1, 1, 1, NULL
        );
        UPDATE seller_store_marketplaces SET marketplace_code='RAKUTEN_JP'
        WHERE store_id='${storeId}';
        INSERT INTO platform_product_identities (
          id, marketplace_code, platform_product_identifier,
          seller_organization_id, seller_store_id, status, created_at, updated_at
        ) VALUES (
          '${productId}', 'RAKUTEN_JP', '${productId}',
          '${organizationId}', '${storeId}', 'ACTIVE', 1, 1
        );
        INSERT INTO platform_order_identities (
          id, marketplace_code, platform_order_identifier,
          platform_product_identity_id, seller_organization_id,
          seller_store_id, status, created_at, updated_at
        ) VALUES (
          '${orderId}', 'RAKUTEN_JP', '${orderId}', '${productId}',
          '${organizationId}', '${storeId}', 'ACTIVE', 1, 1
        );
        INSERT INTO platform_order_evidence_records (
          id, platform_order_identity_id, platform_product_identity_id,
          marketplace_code, seller_organization_id, seller_store_id,
          evidence_type, status, created_at, updated_at
        ) VALUES (
          '${evidenceId}', '${orderId}', '${productId}', 'RAKUTEN_JP',
          '${organizationId}', '${storeId}',
          'ORDER_EVIDENCE_INTERNAL_COMMUNICATION', 'VERIFIED', 1, 1
        );
      `);
      const fileObjectId = await seedFileCandidate({
        suffix: `guard-${suffix}`,
        purpose: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
        visibility: 'SELLER_VISIBLE',
        ownerStaffId: 'staff-chat-owner',
        verified: true,
      });
      const linkId = `platform-link-${suffix}`;
      database.exec(`
        INSERT INTO file_entity_links (
          id, file_object_id, entity_type, entity_id, purpose, visibility,
          linked_by_actor_type, linked_by_actor_id, created_at,
          authorization_mode, expires_at, revoked_at
        ) VALUES (
          '${linkId}', '${fileObjectId}', 'ORDER_EVIDENCE_SUBMISSION',
          '${evidenceId}', 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
          'SELLER_VISIBLE', 'STAFF', 'staff-chat-owner', 2,
          'EXPLICIT_AUDIENCES', NULL, NULL
        );
        INSERT INTO file_entity_audience_grants (
          id, file_entity_link_id, subject_type, buyer_customer_id,
          seller_organization_id, staff_permission_code, staff_scope_type,
          staff_team_id, granted_by_actor_type, granted_by_actor_id,
          created_at, expires_at, revoked_at
        ) VALUES (
          'platform-grant-${suffix}', '${linkId}', 'SELLER_ORGANIZATION',
          NULL, '${organizationId}', NULL, NULL, NULL,
          'STAFF', 'staff-chat-owner', 2, NULL, NULL
        );
      `);
      expect(() => database.exec(`
        INSERT INTO platform_order_evidence_internal_files (
          id, platform_formal_order_id, platform_order_evidence_record_id,
          slot, file_object_id, file_entity_link_id,
          created_by_staff_id, created_at
        ) VALUES (
          'platform-attachment-${suffix}', 'platform-formal-chat',
          '${evidenceId}', 1, '${fileObjectId}', '${linkId}',
          'staff-chat-owner', 3
        )
      `)).toThrow('platform_order_internal_file_scope_mismatch');
      await expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM platform_order_evidence_internal_files
      `).first()).resolves.toEqual({ count: 0 });
    },
  );

  it('conceals a formal order from Staff with missing or wrong Seller Data Scope and writes nothing', async () => {
    const scoped = await resolvedStaff('staff-chat-scoped');
    expect(scoped.permissions.has('ORDER_CONFIRM')).toBe(true);
    const before = await attachmentSideEffects();

    await expect(attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'formal-order-1',
        fileObjectId: 'chat-file-1',
        expectedFileVersion: 2,
      },
      { actor: scoped, idempotencyKey: 'missing-data-scope', now: NOW },
    )).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await attachmentSideEffects()).toEqual(before);

    database.exec(`
      INSERT INTO seller_staff_assignments (
        id, seller_organization_id, duty_code, staff_id, status, source,
        assigned_by_actor_type, assigned_by_actor_id, reason, version,
        created_at, updated_at, revoked_at
      ) VALUES (
        'chat-scoped-wrong-org', 'org-2', 'SELLER_ACCOUNT_MANAGER',
        'staff-chat-scoped', 'ACTIVE', 'MANUAL_REASSIGN',
        'STAFF', 'staff-chat-owner', 'wrong scope regression', 1,
        9000, 9000, NULL
      )
    `);
    await expect(attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'formal-order-1',
        fileObjectId: 'chat-file-1',
        expectedFileVersion: 2,
      },
      { actor: scoped, idempotencyKey: 'wrong-data-scope', now: NOW },
    )).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await attachmentSideEffects()).toEqual(before);
  });

  it.each([
    {
      name: 'wrong purpose',
      suffix: 'wrong-purpose',
      purpose: 'PRODUCT_IMAGE' as const,
      visibility: 'SELLER_VISIBLE' as const,
      ownerStaffId: 'staff-chat-owner',
      verified: true,
      expectedVersion: 2,
      code: 'NOT_FOUND',
    },
    {
      name: 'wrong visibility',
      suffix: 'wrong-visibility',
      purpose: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION' as const,
      visibility: 'INTERNAL_ONLY' as const,
      ownerStaffId: 'staff-chat-owner',
      verified: true,
      expectedVersion: 2,
      code: 'FILE_NOT_VERIFIED',
    },
    {
      name: 'non-current Staff owner',
      suffix: 'wrong-owner',
      purpose: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION' as const,
      visibility: 'SELLER_VISIBLE' as const,
      ownerStaffId: 'staff-chat-scoped',
      verified: true,
      expectedVersion: 2,
      code: 'FILE_NOT_VERIFIED',
    },
    {
      name: 'not VERIFIED',
      suffix: 'unverified',
      purpose: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION' as const,
      visibility: 'SELLER_VISIBLE' as const,
      ownerStaffId: 'staff-chat-owner',
      verified: false,
      expectedVersion: 1,
      code: 'FILE_NOT_VERIFIED',
    },
  ])('rejects a $name source file with no business partial write', async (testCase) => {
    const fileObjectId = await seedFileCandidate(testCase);
    const before = await attachmentSideEffects();
    await expect(attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'formal-order-1',
        fileObjectId,
        expectedFileVersion: testCase.expectedVersion,
      },
      {
        actor: staffActor(),
        idempotencyKey: `reject-${testCase.suffix}`,
        now: NOW,
      },
    )).rejects.toMatchObject({ code: testCase.code });
    expect(await attachmentSideEffects()).toEqual(before);
  });

  it('rejects a stale expected file version before attachment writes', async () => {
    const before = await attachmentSideEffects();
    await expect(attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'formal-order-1',
        fileObjectId: 'chat-file-1',
        expectedFileVersion: 1,
      },
      { actor: staffActor(), idempotencyKey: 'stale-file-version', now: NOW },
    )).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await attachmentSideEffects()).toEqual(before);
  });

  it('replays the same attach request, conflicts on a different request, and never partially writes', async () => {
    const first = await attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'formal-order-1',
        fileObjectId: 'chat-file-1',
        expectedFileVersion: 2,
      },
      { actor: staffActor(), idempotencyKey: 'attach-replay-key', now: NOW },
    );
    const afterFirst = await attachmentSideEffects();
    const replay = await attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'formal-order-1',
        fileObjectId: 'chat-file-1',
        expectedFileVersion: 2,
      },
      { actor: staffActor(), idempotencyKey: 'attach-replay-key', now: NOW + 1 },
    );
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await attachmentSideEffects()).toEqual(afterFirst);

    const differentFile = await seedFileCandidate({
      suffix: 'idempotency-conflict',
      purpose: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
      visibility: 'SELLER_VISIBLE',
      ownerStaffId: 'staff-chat-owner',
      verified: true,
    });
    await expect(attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'formal-order-1',
        fileObjectId: differentFile,
        expectedFileVersion: 2,
      },
      { actor: staffActor(), idempotencyKey: 'attach-replay-key', now: NOW + 2 },
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await attachmentSideEffects()).toEqual(afterFirst);
  });

  it('rejects a duplicate formal-order attachment without partial audience, audit, or outbox writes', async () => {
    await attach();
    const replacement = await seedFileCandidate({
      suffix: 'duplicate',
      purpose: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
      visibility: 'SELLER_VISIBLE',
      ownerStaffId: 'staff-chat-owner',
      verified: true,
    });
    const beforeDuplicate = await attachmentSideEffects();
    await expect(attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'formal-order-1',
        fileObjectId: replacement,
        expectedFileVersion: 2,
      },
      { actor: staffActor(), idempotencyKey: 'duplicate-attachment', now: NOW + 1 },
    )).rejects.toMatchObject({ code: 'FILE_STORAGE_CONFLICT' });
    expect(await attachmentSideEffects()).toEqual(beforeDuplicate);
  });

  it('conceals cross-organization, cross-store, and revoked store-scope access', async () => {
    await attach();
    const owner = sellerActor('member-owner', 'account-owner', 'subject-owner', 'org-1', true, []);
    const otherOrganization = sellerActor('member-other', 'account-other', 'subject-other', 'org-2', true, []);
    const operator = sellerActor('member-operator', 'account-operator', 'subject-operator', 'org-1', false, ['store-1']);

    await expect(requireSellerOrderChatScreenshot(
      database, otherOrganization, 'formal-order-1', NOW,
    )).rejects.toMatchObject({ code: 'FORMAL_ORDER_NOT_FOUND' });
    await expect(requireSellerOrderChatScreenshot(
      database, operator, 'formal-order-2', NOW,
    )).rejects.toMatchObject({ code: 'FORMAL_ORDER_NOT_FOUND' });
    await expect(requireSellerOrderChatScreenshot(
      database, owner, 'formal-order-1', NOW,
    )).resolves.toMatchObject({ formalOrderId: 'formal-order-1' });

    await database.prepare(`
      UPDATE seller_member_store_scopes
      SET status='REVOKED', revoked_at=?, updated_at=?
      WHERE member_id='member-operator' AND store_id='store-1'
    `).bind(NOW, NOW).run();
    await expect(requireSellerOrderChatScreenshot(
      database, operator, 'formal-order-1', NOW,
    )).rejects.toMatchObject({ code: 'FORMAL_ORDER_NOT_FOUND' });
  });

  it('binds read-intent creation and consumption to the exact Seller member actor and session principal', async () => {
    await attach();
    const ownerActor = sellerFileActor('member-owner');
    const ownerPrincipal = sellerPrincipal('account-owner', 'subject-owner');
    const access = await requireSellerOrderChatScreenshot(
      database,
      sellerActor('member-owner', 'account-owner', 'subject-owner', 'org-1', true, []),
      'formal-order-1',
      NOW,
    );

    await expect(issue(
      access,
      sellerFileActor('member-operator'),
      ownerPrincipal,
      'intent-wrong-create-actor',
      20_000,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(issue(
      access,
      ownerActor,
      sellerPrincipal('account-operator', 'subject-operator'),
      'intent-wrong-create-principal',
      20_001,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const issued = await issue(
      access,
      ownerActor,
      ownerPrincipal,
      'intent-wrong-consume-actor',
      20_002,
    );
    await expect(consume(
      issued,
      sellerFileActor('member-operator'),
      ownerPrincipal,
      20_003,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(consume(
      issued,
      ownerActor,
      sellerPrincipal('account-operator', 'subject-operator'),
      20_004,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(['link', 'audience'] as const)(
    'dynamically rejects read-intent creation and consumption after %s revocation',
    async (authority) => {
      await attach();
      const actor = sellerFileActor('member-owner');
      const principal = sellerPrincipal('account-owner', 'subject-owner');
      const access = await ownerAccess(NOW);
      const issued = await issue(
        access,
        actor,
        principal,
        `intent-${authority}-revoked`,
        21_000,
      );
      if (authority === 'link') {
        await database.prepare(`
          UPDATE file_entity_links SET revoked_at=? WHERE id=?
        `).bind(21_001, access.fileEntityLinkId).run();
      } else {
        await database.prepare(`
          UPDATE file_entity_audience_grants
          SET revoked_at=? WHERE file_entity_link_id=?
        `).bind(21_001, access.fileEntityLinkId).run();
      }
      await expect(issue(
        access,
        actor,
        principal,
        `intent-${authority}-after-revoke`,
        21_002,
      )).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(consume(issued, actor, principal, 21_002))
        .rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it.each(['link', 'audience'] as const)(
    'dynamically rejects read-intent creation and consumption after %s expiry',
    async (authority) => {
      await seedDirectAttachment({
        linkExpiresAt: authority === 'link' ? 20_000 : null,
        grantExpiresAt: authority === 'audience' ? 20_000 : null,
      });
      const actor = sellerFileActor('member-owner');
      const principal = sellerPrincipal('account-owner', 'subject-owner');
      const access = await ownerAccess(15_000);
      const issued = await issue(
        access,
        actor,
        principal,
        `intent-${authority}-expires`,
        15_000,
      );
      await expect(issue(
        access,
        actor,
        principal,
        `intent-${authority}-after-expiry`,
        20_001,
      )).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(consume(issued, actor, principal, 20_001))
        .rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(ownerAccess(20_001))
        .rejects.toMatchObject({ code: 'FORMAL_ORDER_NOT_FOUND' });
    },
  );

  it.each([
    ['account', 'member-owner'],
    ['organization', 'member-owner'],
    ['store', 'member-owner'],
    ['member', 'member-owner'],
    ['store scope', 'member-operator'],
  ] as const)(
    'rechecks active %s authority on both read-intent creation and consumption',
    async (authority, memberId) => {
      await attach();
      const operator = memberId === 'member-operator';
      const actor = sellerFileActor(memberId);
      const principal = operator
        ? sellerPrincipal('account-operator', 'subject-operator')
        : sellerPrincipal('account-owner', 'subject-owner');
      const portalActor = operator
        ? sellerActor(
            'member-operator',
            'account-operator',
            'subject-operator',
            'org-1',
            false,
            ['store-1'],
          )
        : sellerActor(
            'member-owner',
            'account-owner',
            'subject-owner',
            'org-1',
            true,
            [],
          );
      const access = await requireSellerOrderChatScreenshot(
        database,
        portalActor,
        'formal-order-1',
        22_000,
      );
      const issued = await issue(
        access,
        actor,
        principal,
        `intent-${authority.replace(' ', '-')}-active`,
        22_000,
      );

      await revokeSellerAuthority(authority, 22_001);
      await expect(issue(
        access,
        actor,
        principal,
        `intent-${authority.replace(' ', '-')}-revoked`,
        22_002,
      )).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(consume(issued, actor, principal, 22_002))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it('enforces the Staff HTTP strict body, expected version, and Idempotency-Key without partial writes', async () => {
    const app = routeApp(staffActor());
    const before = await attachmentSideEffects();
    const cases = [
      {
        name: 'missing Idempotency-Key',
        headers: { 'Content-Type': 'application/json' },
        body: {
          file_object_id: 'chat-file-1',
          expected_file_version: 2,
        },
        status: 400,
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'extra body property',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'staff-http-extra-body',
        },
        body: {
          file_object_id: 'chat-file-1',
          expected_file_version: 2,
          object_key: 'must-not-be-accepted',
        },
        status: 400,
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'stale expected version',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'staff-http-stale-version',
        },
        body: {
          file_object_id: 'chat-file-1',
          expected_file_version: 1,
        },
        status: 409,
        code: 'VERSION_CONFLICT',
      },
    ] as const;
    for (const testCase of cases) {
      const response = await routeRequest(
        app,
        SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS.staffAttach
          .replace(':id', 'formal-order-1'),
        {
          method: 'POST',
          headers: testCase.headers,
          body: JSON.stringify(testCase.body),
        },
      );
      expect(response.status, testCase.name).toBe(testCase.status);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: testCase.code },
      });
      expect(await attachmentSideEffects()).toEqual(before);
    }
  });

  it('keeps the Seller HTTP read-intent response opaque and uses one concealed error for cross-organization and cross-store access', async () => {
    await attach();
    const secondFile = await seedFileCandidate({
      suffix: 'http-order-two',
      purpose: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
      visibility: 'SELLER_VISIBLE',
      ownerStaffId: 'staff-chat-owner',
      verified: true,
    });
    await attachSellerOrderChatScreenshot(
      database,
      {
        formalOrderId: 'formal-order-2',
        fileObjectId: secondFile,
        expectedFileVersion: 2,
      },
      { actor: staffActor(), idempotencyKey: 'http-attach-order-two', now: NOW },
    );
    const app = routeApp(staffActor());

    const successful = await sellerReadIntentRequest(
      app,
      'formal-order-1',
      'owner',
      { expected_file_version: 2 },
      'seller-http-valid',
    );
    expect(successful.status).toBe(201);
    expect(successful.headers.get('cache-control')).toBe('no-store');
    const successfulBody = await successful.json() as any;
    expect(successfulBody.data.read_intent).toMatchObject({
      read_intent_id: expect.any(String),
      access_token: expect.any(String),
      access_token_available: true,
      expires_at: expect.any(Number),
      replayed: false,
    });
    const serializedSuccess = JSON.stringify(successfulBody);
    for (const forbidden of [
      'chat-file-1',
      'files/v1/',
      'object_key',
      'file_object_id',
      'http://',
      'https://',
    ]) {
      expect(serializedSuccess).not.toContain(forbidden);
    }

    const strictCases = [
      {
        body: { expected_file_version: 2 },
        key: null,
        status: 400,
        code: 'VALIDATION_ERROR',
      },
      {
        body: { expected_file_version: 2, file_object_id: 'chat-file-1' },
        key: 'seller-http-extra-body',
        status: 400,
        code: 'VALIDATION_ERROR',
      },
      {
        body: { expected_file_version: 1 },
        key: 'seller-http-stale-version',
        status: 409,
        code: 'VERSION_CONFLICT',
      },
    ] as const;
    for (const testCase of strictCases) {
      const response = await sellerReadIntentRequest(
        app,
        'formal-order-1',
        'owner',
        testCase.body,
        testCase.key,
      );
      expect(response.status).toBe(testCase.status);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: testCase.code },
      });
    }

    const crossOrganization = await sellerReadIntentRequest(
      app,
      'formal-order-1',
      'other',
      { expected_file_version: 2 },
      'seller-http-cross-org',
    );
    const crossStore = await sellerReadIntentRequest(
      app,
      'formal-order-2',
      'operator',
      { expected_file_version: 2 },
      'seller-http-cross-store',
    );
    expect(crossOrganization.status).toBe(404);
    expect(crossStore.status).toBe(404);
    const crossOrganizationBody = await crossOrganization.json() as any;
    const crossStoreBody = await crossStore.json() as any;
    expect(crossOrganizationBody.error).toMatchObject({
      code: 'FORMAL_ORDER_NOT_FOUND',
      message: expect.any(String),
    });
    expect(crossStoreBody.error).toMatchObject({
      code: 'FORMAL_ORDER_NOT_FOUND',
      message: crossOrganizationBody.error.message,
    });
    for (const hidden of [crossOrganizationBody, crossStoreBody]) {
      const serialized = JSON.stringify(hidden);
      expect(serialized).not.toContain('chat-file-1');
      expect(serialized).not.toContain(secondFile);
      expect(serialized).not.toContain('files/v1/');
    }
  });

  it('enforces short expiry and one-time replay protection without returning storage authority', async () => {
    await attach();
    const actor = sellerFileActor('member-owner');
    const principal = sellerPrincipal('account-owner', 'subject-owner');
    const access = await requireSellerOrderChatScreenshot(
      database,
      sellerActor('member-owner', 'account-owner', 'subject-owner', 'org-1', true, []),
      'formal-order-1',
      NOW,
    );
    const expired = await issue(access, actor, principal, 'intent-expired', 30_000);
    expect(expired.accessToken).toEqual(expect.any(String));
    await expect(consume(expired, actor, principal, 60_001))
      .rejects.toMatchObject({ code: 'FILE_UPLOAD_EXPIRED' });

    const usable = await issue(access, actor, principal, 'intent-usable', 31_000);
    const first = await consume(usable, actor, principal, 31_001);
    expect(first.contentType).toBe('image/png');
    await expect(consume(usable, actor, principal, 31_002))
      .rejects.toMatchObject({ code: 'FILE_UPLOAD_EXPIRED' });
  });
});

async function resolvedStaff(
  staffId: string,
): Promise<AssignmentStaffAuthorization> {
  const actor = await resolveAssignmentStaffAuthorization(database, staffId);
  if (!actor) throw new Error(`staff_authorization_missing:${staffId}`);
  return actor;
}

async function attachmentSideEffects(): Promise<{
  attachments: number;
  platformAttachments: number;
  platformCommunicationEvidence: number;
  links: number;
  grants: number;
  audienceEvents: number;
  linkedFileEvents: number;
  auditEvents: number;
  outboxEvents: number;
}> {
  const row = await database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM order_evidence_internal_files) AS attachments,
      (SELECT COUNT(*) FROM platform_order_evidence_internal_files)
        AS platform_attachments,
      (SELECT COUNT(*) FROM platform_order_evidence_records
        WHERE evidence_type='ORDER_EVIDENCE_INTERNAL_COMMUNICATION')
        AS platform_communication_evidence,
      (SELECT COUNT(*) FROM file_entity_links
        WHERE purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION') AS links,
      (SELECT COUNT(*) FROM file_entity_audience_grants grant
        JOIN file_entity_links link ON link.id=grant.file_entity_link_id
        WHERE link.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION') AS grants,
      (SELECT COUNT(*) FROM file_audience_events
        WHERE entity_type='ORDER_EVIDENCE_SUBMISSION'
          AND file_object_id LIKE 'chat-file-%') AS audience_events,
      (SELECT COUNT(*) FROM file_events
        WHERE event_type='FILE_OBJECT_LINKED'
          AND file_object_id LIKE 'chat-file-%') AS linked_file_events,
      (SELECT COUNT(*) FROM audit_events
        WHERE event_type='SELLER_ORDER_CHAT_SCREENSHOT_ATTACHED') AS audit_events,
      (SELECT COUNT(*) FROM integration_outbox
        WHERE event_type='SELLER_ORDER_CHAT_SCREENSHOT_ATTACHED') AS outbox_events
  `).first<Record<string, number>>();
  if (!row) throw new Error('attachment_side_effect_counts_missing');
  return {
    attachments: Number(row['attachments']),
    platformAttachments: Number(row['platform_attachments']),
    platformCommunicationEvidence:
      Number(row['platform_communication_evidence']),
    links: Number(row['links']),
    grants: Number(row['grants']),
    audienceEvents: Number(row['audience_events']),
    linkedFileEvents: Number(row['linked_file_events']),
    auditEvents: Number(row['audit_events']),
    outboxEvents: Number(row['outbox_events']),
  };
}

function platformFormalOrderFilters() {
  return {
    store_id: null,
    marketplace_code: 'RAKUTEN_JP' as const,
    asin: null,
    product_name: null,
    review_type: null,
    confirmed_business_date: null,
    formal_order_id: null,
    amazon_order_number: null,
  };
}

function seedPlatformChatFormalOrder(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name,
      normalized_name, status, version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-platform-chat', 'org-1', 'JP', '乐天聊天店铺',
      '乐天聊天店铺', 'ACTIVE', 1, 1, 1, NULL
    );
    UPDATE seller_store_marketplaces SET marketplace_code='RAKUTEN_JP'
    WHERE store_id='store-platform-chat';
    INSERT INTO platform_product_identities (
      id, marketplace_code, platform_product_identifier,
      seller_organization_id, seller_store_id, display_name,
      status, created_at, updated_at
    ) VALUES (
      'platform-product-chat', 'RAKUTEN_JP', 'rakuten-product-chat',
      'org-1', 'store-platform-chat', '乐天聊天产品', 'ACTIVE', 1, 1
    );
    INSERT INTO platform_order_identities (
      id, marketplace_code, platform_order_identifier,
      platform_product_identity_id, seller_organization_id,
      seller_store_id, platform_order_date, status, created_at, updated_at
    ) VALUES (
      'platform-order-chat', 'RAKUTEN_JP',
      '123456-20260810-0000000099', 'platform-product-chat',
      'org-1', 'store-platform-chat', '2026-08-10', 'ACTIVE', 1, 1
    );
    INSERT INTO platform_order_evidence_records (
      id, platform_order_identity_id, platform_product_identity_id,
      marketplace_code, seller_organization_id, seller_store_id,
      evidence_type, status, created_at, updated_at
    ) VALUES (
      'platform-order-fact-chat', 'platform-order-chat',
      'platform-product-chat', 'RAKUTEN_JP', 'org-1',
      'store-platform-chat', 'ORDER_FACT', 'VERIFIED', 1, 1
    );
    INSERT INTO platform_formal_orders (
      id, order_evidence_record_id, platform_order_identity_id,
      platform_product_identity_id, marketplace_code,
      seller_organization_id, seller_store_id, product_name_snapshot,
      review_type, status, confirmed_at, confirmed_business_date, created_at
    ) VALUES (
      'platform-formal-chat', 'platform-order-fact-chat',
      'platform-order-chat', 'platform-product-chat', 'RAKUTEN_JP',
      'org-1', 'store-platform-chat', '乐天聊天产品', NULL,
      'CONFIRMED', 5000, '2026-08-10', 5000
    );
  `);
}

async function revokePlatformScreenshotAuthority(
  authority: 'link' | 'grant' | 'file' | 'store' | 'member',
  access: SellerOrderChatScreenshotAccess,
  now: number,
): Promise<void> {
  switch (authority) {
    case 'link':
      await database.prepare(`
        UPDATE file_entity_links SET revoked_at=? WHERE id=?
      `).bind(now, access.fileEntityLinkId).run();
      return;
    case 'grant':
      await database.prepare(`
        UPDATE file_entity_audience_grants SET revoked_at=?
        WHERE file_entity_link_id=?
      `).bind(now, access.fileEntityLinkId).run();
      return;
    case 'file':
      await database.prepare(`
        UPDATE file_objects
        SET status='DELETION_PENDING', failure_code='ACCESS_REVOKED',
          next_delete_at=?, verified_at=NULL, version=version+1, updated_at=?
        WHERE id=?
      `).bind(now, now, access.fileObjectId).run();
      return;
    case 'store':
      await database.prepare(`
        UPDATE seller_stores
        SET status='DISABLED', disabled_at=?, updated_at=?
        WHERE id='store-platform-chat'
      `).bind(now, now).run();
      return;
    case 'member':
      await database.prepare(`
        UPDATE seller_member_store_scopes
        SET status='REVOKED', revoked_at=?, updated_at=?
        WHERE member_id='member-operator'
          AND store_id='store-platform-chat'
      `).bind(now, now).run();
  }
}

async function seedFileCandidate(input: {
  suffix: string;
  purpose: 'PRODUCT_IMAGE' | 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION';
  visibility: 'INTERNAL_ONLY' | 'SELLER_VISIBLE';
  ownerStaffId: string;
  verified: boolean;
}): Promise<string> {
  const uploadIntentId = `chat-intent-${input.suffix}`;
  const fileObjectId = `chat-file-${input.suffix}`;
  const objectKey = `files/v1/chat/${input.suffix}-0000000000000000000000000000000000000000`;
  await database.prepare(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility, status,
      requested_file_count, manifest_hash, version, expires_at,
      failure_code, created_at, updated_at, completed_at
    ) VALUES (?, 'STAFF', ?, ?, ?, 'ISSUED', 1, ?, 1,
      9999999999999, NULL, 2, 2, NULL)
  `).bind(
    uploadIntentId,
    input.ownerStaffId,
    input.purpose,
    input.visibility,
    'd'.repeat(64),
  ).run();
  await database.prepare(`
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size,
      status, upload_token_hash, upload_expires_at, uploaded_byte_size,
      detected_mime, uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at, uploaded_at,
      verified_at, deleted_at
    ) VALUES (?, ?, 1, ?, ?, ?, 'chat.png', 'png', 'image/png', 11,
      'RESERVED', ?, 9999999999999, NULL, NULL, NULL,
      NULL, 0, NULL, 1, 2, 2, NULL, NULL, NULL)
  `).bind(
    fileObjectId,
    uploadIntentId,
    input.purpose,
    input.visibility,
    objectKey,
    'e'.repeat(64),
  ).run();
  if (input.verified) {
    await database.prepare(`
      UPDATE file_upload_intents
      SET status='VERIFIED', version=2, updated_at=3, completed_at=3
      WHERE id=?
    `).bind(uploadIntentId).run();
    await database.prepare(`
      UPDATE file_objects
      SET status='VERIFIED', version=2, uploaded_byte_size=11,
          detected_mime='image/png', uploaded_sha256=?, updated_at=3,
          uploaded_at=3, verified_at=3
      WHERE id=?
    `).bind('f'.repeat(64), fileObjectId).run();
  }
  return fileObjectId;
}

async function seedDirectAttachment(input: {
  linkExpiresAt: number | null;
  grantExpiresAt: number | null;
}): Promise<void> {
  await database.prepare(`
    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (
      'chat-direct-link', 'chat-file-1', 'ORDER_EVIDENCE_SUBMISSION',
      'submission-1', 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
      'SELLER_VISIBLE', 'STAFF', 'staff-chat-owner', 12000,
      'EXPLICIT_AUDIENCES', ?, NULL
    )
  `).bind(input.linkExpiresAt).run();
  await database.prepare(`
    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type, buyer_customer_id,
      seller_organization_id, staff_permission_code, staff_scope_type,
      staff_team_id, granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES (
      'chat-direct-grant', 'chat-direct-link', 'SELLER_ORGANIZATION',
      NULL, 'org-1', NULL, NULL, NULL,
      'STAFF', 'staff-chat-owner', 12001, ?, NULL
    )
  `).bind(input.grantExpiresAt).run();
  database.exec(`
    INSERT INTO order_evidence_internal_files (
      id, order_evidence_submission_id, slot, file_object_id,
      file_entity_link_id, created_by_staff_id, created_at
    ) VALUES (
      'chat-direct-attachment', 'submission-1', 1, 'chat-file-1',
      'chat-direct-link', 'staff-chat-owner', 12002
    )
  `);
}

async function ownerAccess(now: number): Promise<SellerOrderChatScreenshotAccess> {
  return requireSellerOrderChatScreenshot(
    database,
    sellerActor(
      'member-owner',
      'account-owner',
      'subject-owner',
      'org-1',
      true,
      [],
    ),
    'formal-order-1',
    now,
  );
}

async function revokeSellerAuthority(
  authority: 'account' | 'organization' | 'store' | 'member' | 'store scope',
  now: number,
): Promise<void> {
  switch (authority) {
    case 'account':
      await database.prepare(`
        UPDATE customer_login_accounts
        SET status='DISABLED', disabled_at=?, updated_at=?
        WHERE id='account-owner'
      `).bind(now, now).run();
      return;
    case 'organization':
      await database.prepare(`
        UPDATE seller_organizations
        SET status='DISABLED', disabled_at=?, updated_at=?
        WHERE id='org-1'
      `).bind(now, now).run();
      return;
    case 'store':
      await database.prepare(`
        UPDATE seller_stores
        SET status='DISABLED', disabled_at=?, updated_at=?
        WHERE id='store-1'
      `).bind(now, now).run();
      return;
    case 'member':
      await database.prepare(`
        UPDATE seller_organization_members
        SET status='DISABLED', disabled_at=?, updated_at=?
        WHERE id='member-owner'
      `).bind(now, now).run();
      return;
    case 'store scope':
      await database.prepare(`
        UPDATE seller_member_store_scopes
        SET status='REVOKED', revoked_at=?, updated_at=?
        WHERE member_id='member-operator' AND store_id='store-1'
      `).bind(now, now).run();
  }
}

function routeApp(actor: AssignmentStaffAuthorization) {
  const app = createApp();
  app.use('/api/staff/*', async (context, next) => {
    context.set('staffAuthorization', actor);
    await next();
  });
  registerSellerOrderChatScreenshotRoutes(app);
  return app;
}

async function routeRequest(
  app: ReturnType<typeof routeApp>,
  pathname: string,
  init: RequestInit,
): Promise<Response> {
  return app.request(`${ORIGIN}${pathname}`, init, {
    DB: database,
    CUSTOMER_SESSION_SECRET: SESSION_SECRET,
  } as any);
}

type SellerSessionActor = 'owner' | 'operator' | 'other';

async function sellerCookie(actor: SellerSessionActor): Promise<string> {
  const definition = {
    owner: {
      accountId: 'account-owner',
      identitySubjectId: 'subject-owner',
    },
    operator: {
      accountId: 'account-operator',
      identitySubjectId: 'subject-operator',
    },
    other: {
      accountId: 'account-other',
      identitySubjectId: 'subject-other',
    },
  }[actor];
  const token = await issueCustomerSession(
    {
      ...definition,
      accountType: 'SELLER_MEMBER',
      sessionVersion: 1,
      passwordChangeRequired: false,
    },
    SESSION_SECRET,
    { now: Date.now() },
  );
  return `__Host-ygb_customer_session=${token}`;
}

async function sellerReadIntentRequest(
  app: ReturnType<typeof routeApp>,
  formalOrderId: string,
  actor: SellerSessionActor,
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    Cookie: await sellerCookie(actor),
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return routeRequest(
    app,
    SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS.sellerReadIntent
      .replace(':id', encodeURIComponent(formalOrderId)),
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
  );
}

async function attach(): Promise<void> {
  await attachSellerOrderChatScreenshot(
    database,
    { formalOrderId: 'formal-order-1', fileObjectId: 'chat-file-1', expectedFileVersion: 2 },
    { actor: staffActor(), idempotencyKey: `attach-${crypto.randomUUID()}`, now: NOW },
  );
}

async function issue(
  access: SellerOrderChatScreenshotAccess,
  actor: FileActor,
  principal: FileReadPrincipal,
  key: string,
  now: number,
) {
  return createFileReadIntent(
    database,
    new DenyAllFileAuthorizationService(),
    {
      fileObjectId: access.fileObjectId,
      fileEntityLinkId: access.fileEntityLinkId,
      expectedFileVersion: access.fileVersion,
      ttlMs: 30_000,
    },
    { actor, principal, idempotencyKey: key, now },
  );
}

async function consume(
  intent: Awaited<ReturnType<typeof createFileReadIntent>>,
  actor: FileActor,
  principal: FileReadPrincipal,
  now: number,
) {
  if (!intent.accessToken) throw new Error('fixture_token_missing');
  return consumeFileReadIntent(
    database,
    storage,
    new DenyAllFileAuthorizationService(),
    { readIntentId: intent.readIntentId, accessToken: intent.accessToken },
    { actor, principal, now },
  );
}

function staffActor(
  overrides: Partial<Pick<AssignmentStaffAuthorization, 'permissions'>> = {},
): AssignmentStaffAuthorization {
  return {
    staffId: 'staff-chat-owner',
    displayName: '聊天截图测试员工',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set(['owner']),
    permissions: overrides.permissions ?? new Set(['ORDER_CONFIRM']),
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

function sellerFileActor(memberId: string): FileActor {
  return { type: 'SELLER_MEMBER', id: memberId, roles: ['OWNER'] };
}

function sellerPrincipal(accountId: string, identitySubjectId: string): FileReadPrincipal {
  return { type: 'SELLER_SESSION', accountId, identitySubjectId };
}

function sellerActor(
  memberId: string,
  accountId: string,
  identitySubjectId: string,
  organizationId: string,
  allActiveStores: boolean,
  storeIds: readonly string[],
) {
  return {
    accountId,
    identitySubjectId,
    memberId,
    sellerOrganizationId: organizationId,
    role: memberId === 'member-owner' ? 'OWNER' : 'OPERATIONS',
    storeIds,
    allActiveStores,
    canManageProducts: false,
    me: {} as never,
  } as const;
}

async function seedChatFixture(
  db: SqliteDatabase,
  objectStorage: MockObjectStorage,
): Promise<void> {
  db.exec(`
    PRAGMA foreign_keys=OFF;
    DROP TRIGGER trg_formal_order_source_guard;
    DROP TRIGGER trg_formal_order_instruction_guard;
    DROP TRIGGER trg_order_evidence_submission_reservation_guard;
    INSERT INTO staff_departments (
      id, code, name, status, version, created_at, updated_at, disabled_at
    ) VALUES (
      'department-chat', 'chat', '聊天截图测试部门',
      'ACTIVE', 1, 1, 1, NULL
    );
    INSERT INTO staff_teams (
      id, department_id, code, name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'team-chat', 'department-chat', 'chat', '聊天截图测试组',
      'ACTIVE', 1, 1, 1, NULL
    );
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      ('staff-chat-owner', '聊天截图测试员工', 'ACTIVE', 1, 1, 1, 1, NULL),
      ('staff-chat-scoped', '聊天截图范围员工', 'ACTIVE', 1, 1, 1, 1, NULL);
    INSERT INTO staff_role_assignments (
      id, staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, revoked_by_staff_id, revoked_reason, created_at, updated_at
    ) VALUES
      ('role-chat-owner', 'staff-chat-owner', 'owner', 'ACTIVE',
       'staff-chat-owner', 1, NULL, NULL, NULL, 1, 1),
      ('role-chat-scoped', 'staff-chat-scoped', 'seller_ops', 'ACTIVE',
       'staff-chat-owner', 1, NULL, NULL, NULL, 1, 1);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at,
      ended_at, created_at, updated_at
    ) VALUES (
      'staff-chat-scoped', 'team-chat', 'ACTIVE', 1, NULL, 1, 1
    );
    INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at,
      created_at, updated_at
    ) VALUES (
      'staff-chat-scoped', 'ORDER_CONFIRM', 'GRANT', 'ACTIVE',
      'entity command test scope', 'staff-chat-owner', 1, NULL, 1, 1
    );
    INSERT INTO customer_identity_subjects (id, subject_type, created_at) VALUES
      ('subject-owner', 'SELLER_ORG_MEMBER', 1),
      ('subject-operator', 'SELLER_ORG_MEMBER', 1),
      ('subject-other', 'SELLER_ORG_MEMBER', 1);
    INSERT INTO seller_organizations (id, marketplace_code, seller_code, origin_channel_id, current_channel_id, seller_sequence, organization_name, status, version, created_at, updated_at, activated_at, disabled_at, next_member_number) VALUES
      ('org-1', 'JP', 'seller-one', 'channel-one', 'channel-one', 1, '组织一', 'ACTIVE', 1, 1, 1, 1, NULL, 3),
      ('org-2', 'JP', 'seller-two', 'channel-two', 'channel-two', 2, '组织二', 'ACTIVE', 1, 1, 1, 1, NULL, 2);
    INSERT INTO seller_organization_members (id, identity_subject_id, organization_id, member_number, username_fallback, display_name, role, primary_owner, status, version, created_at, updated_at, activated_at, disabled_at) VALUES
      ('member-owner', 'subject-owner', 'org-1', 1, 'owner-one', '负责人', 'OWNER', 1, 'ACTIVE', 1, 1, 1, 1, NULL),
      ('member-operator', 'subject-operator', 'org-1', 2, 'operator-one', '运营', 'OPERATIONS', 0, 'ACTIVE', 1, 1, 1, 1, NULL),
      ('member-other', 'subject-other', 'org-2', 1, 'owner-two', '其他负责人', 'OWNER', 1, 'ACTIVE', 1, 1, 1, 1, NULL);
    INSERT INTO seller_stores (id, organization_id, marketplace_code, display_name, normalized_name, status, version, created_at, updated_at, disabled_at) VALUES
      ('store-1', 'org-1', 'JP', '店铺一', '店铺一', 'ACTIVE', 1, 1, 1, NULL),
      ('store-2', 'org-1', 'JP', '店铺二', '店铺二', 'ACTIVE', 1, 1, 1, NULL),
      ('store-other', 'org-2', 'JP', '其他店铺', '其他店铺', 'ACTIVE', 1, 1, 1, NULL);
    INSERT INTO seller_member_store_scopes (member_id, store_id, organization_id, status, assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at) VALUES
      ('member-operator', 'store-1', 'org-1', 'ACTIVE', 'staff-chat-owner', 1, NULL, 1, 1);
    INSERT INTO customer_login_accounts (id, identity_subject_id, account_type, login_identifier_display, login_identifier_normalized, status, session_version, password_change_required, version, created_at, updated_at, activated_at, disabled_at) VALUES
      ('account-owner', 'subject-owner', 'SELLER_MEMBER', 'owner-one', 'owner-one', 'ACTIVE', 1, 0, 1, 1, 1, 1, NULL),
      ('account-operator', 'subject-operator', 'SELLER_MEMBER', 'operator-one', 'operator-one', 'ACTIVE', 1, 0, 1, 1, 1, 1, NULL),
      ('account-other', 'subject-other', 'SELLER_MEMBER', 'owner-two', 'owner-two', 'ACTIVE', 1, 0, 1, 1, 1, 1, NULL);
    INSERT OR IGNORE INTO customer_account_personas (account_id, identity_subject_id, persona_type, buyer_customer_id, seller_member_id, created_at) VALUES
      ('account-owner', 'subject-owner', 'SELLER_MEMBER', NULL, 'member-owner', 1),
      ('account-operator', 'subject-operator', 'SELLER_MEMBER', NULL, 'member-operator', 1),
      ('account-other', 'subject-other', 'SELLER_MEMBER', NULL, 'member-other', 1);
    INSERT INTO order_evidence_submissions (id, reservation_id, buyer_customer_id, marketplace_code, status, current_version_no, version, public_change_reason, internal_review_note, submitted_at, updated_at, verified_by_staff_id, verified_at, withdrawn_at, consumed_at, created_at) VALUES
      ('submission-1', 'reservation-1', 'buyer-1', 'JP', 'VERIFIED', 1, 1, NULL, NULL, 1, 1, 'staff-chat-owner', 1, NULL, NULL, 1),
      ('submission-2', 'reservation-2', 'buyer-2', 'JP', 'VERIFIED', 1, 1, NULL, NULL, 1, 1, 'staff-chat-owner', 1, NULL, NULL, 1),
      ('submission-other', 'reservation-other', 'buyer-other', 'JP', 'VERIFIED', 1, 1, NULL, NULL, 1, 1, 'staff-chat-owner', 1, NULL, NULL, 1);
    INSERT INTO formal_orders (id, order_evidence_submission_id, order_evidence_version_id, reservation_id, demand_batch_id, buyer_customer_id, buyer_customer_no, seller_organization_id, store_id, marketplace_code, product_id, product_version_id, product_version_no, asin_display, asin_normalized, product_name_snapshot, review_type, amazon_order_number_raw, amazon_order_number_normalized, final_paid_jpy, status, version, confirmed_by_staff_id, confirmed_at, confirmed_business_date, created_at) VALUES
      ('formal-order-1', 'submission-1', 'evidence-version-1', 'reservation-1', 'demand-1', 'buyer-1', 'buyer-001', 'org-1', 'store-1', 'JP', 'product-1', 'product-version-1', 1, 'B012345678', 'B012345678', '商品一', 'IMAGE', '111-1111111-1111111', '111-1111111-1111111', 1980, 'CONFIRMED', 1, 'staff-chat-owner', 1, '2026-08-01', 1),
      ('formal-order-2', 'submission-2', 'evidence-version-2', 'reservation-2', 'demand-2', 'buyer-2', 'buyer-002', 'org-1', 'store-2', 'JP', 'product-2', 'product-version-2', 1, 'B012345679', 'B012345679', '商品二', 'TEXT', '222-2222222-2222222', '222-2222222-2222222', 1980, 'CONFIRMED', 1, 'staff-chat-owner', 1, '2026-08-01', 1),
      ('formal-other', 'submission-other', 'evidence-version-other', 'reservation-other', 'demand-other', 'buyer-other', 'buyer-003', 'org-2', 'store-other', 'JP', 'product-other', 'product-version-other', 1, 'B012345680', 'B012345680', '其他商品', 'VIDEO', '333-3333333-3333333', '333-3333333-3333333', 1980, 'CONFIRMED', 1, 'staff-chat-owner', 1, '2026-08-01', 1);
    PRAGMA foreign_keys=ON;
  `);

  const hash = await sha256Hex(BYTES);
  db.exec(`
    INSERT INTO file_upload_intents (id, owner_actor_type, owner_actor_id, purpose, visibility, status, requested_file_count, manifest_hash, version, expires_at, failure_code, created_at, updated_at, completed_at)
      VALUES ('chat-intent-1', 'STAFF', 'staff-chat-owner', 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION', 'SELLER_VISIBLE', 'ISSUED', 1, '${'a'.repeat(64)}', 1, 9999999999999, NULL, 1, 1, NULL);
    INSERT INTO file_objects (id, upload_intent_id, slot_no, purpose, visibility, object_key, client_file_name, extension, declared_mime, expected_byte_size, status, upload_token_hash, upload_expires_at, uploaded_byte_size, detected_mime, uploaded_sha256, failure_code, delete_attempt_count, next_delete_at, version, created_at, updated_at, uploaded_at, verified_at, deleted_at)
      VALUES ('chat-file-1', 'chat-intent-1', 1, 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION', 'SELLER_VISIBLE', 'files/v1/chat/screenshot-fixture-000000000000000000000000000000', 'chat.png', 'png', 'image/png', 11, 'RESERVED', '${'b'.repeat(64)}', 9999999999999, NULL, NULL, NULL, NULL, 0, NULL, 1, 1, 1, NULL, NULL, NULL);
  `);
  await db.prepare(
    "UPDATE file_upload_intents SET status='VERIFIED', version=2, updated_at=2, completed_at=2 WHERE id='chat-intent-1'",
  ).run();
  await db.prepare(`
    UPDATE file_objects SET status='VERIFIED', version=2, uploaded_byte_size=11,
      detected_mime='image/png', uploaded_sha256=?, updated_at=2,
      uploaded_at=2, verified_at=2 WHERE id='chat-file-1'
  `).bind(hash).run();
  await objectStorage.putObject({
    objectKey: 'files/v1/chat/screenshot-fixture-000000000000000000000000000000',
    bytes: BYTES,
    contentType: 'image/png',
    metadata: {},
  });
}
