import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  FileActor,
  FileReadPrincipal,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import type {
  FileAuthorizationResource,
  FileAuthorizationService,
} from './authorization';
import { completeFileUploadIntent } from './complete-upload-intent';
import { createFileUploadIntent } from './create-upload-intent';
import {
  createExplicitAudienceFileLinkStatements,
  createRevokeExplicitAudienceFileLinkStatements,
  createRevokeFileAudienceGrantStatements,
} from './explicit-audience-links';
import {
  authorizeExplicitAudienceRead,
  authorizeFileRead,
} from './file-audience-authorization';
import {
  consumeFileReadIntent,
  createFileReadIntent,
} from './file-read-service';
import { MockObjectStorage } from './mock-object-storage';
import { uploadFileObject } from './upload-file-object';

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a,
  0x01, 0x02, 0x03,
]);
const staffActor: FileActor = {
  type: 'STAFF',
  id: 'staff-file-owner',
  roles: ['owner'],
};
const allowAll: FileAuthorizationService = {
  assertCanCreateUpload: () => {},
  assertCanUpload: () => {},
  assertCanCompleteUpload: () => {},
  assertCanLink: () => {},
  assertCanRead: () => {},
};

let database: SqliteDatabase;

beforeEach(() => {
  database = createMigratedTestDatabase();
  seedAudienceIdentities(database);
});

afterEach(() => database.close());

describe('explicit file audiences', () => {
  it('keeps all legacy visibility decisions on the unchanged legacy service', async () => {
    const legacy = legacyVisibilityAuthorization();
    for (const [visibility, actor, allowed] of [
      ['INTERNAL_ONLY', staffActor, true],
      ['INTERNAL_ONLY', buyerActor('buyer-account-1'), false],
      ['BUYER_VISIBLE', buyerActor('buyer-account-1'), true],
      ['BUYER_VISIBLE', sellerActor('seller-account-1'), false],
      ['SELLER_VISIBLE', sellerActor('seller-account-1'), true],
      ['SELLER_VISIBLE', buyerActor('buyer-account-1'), false],
    ] as const) {
      const operation = authorizeFileRead(
        database,
        legacy,
        actor,
        undefined,
        legacyResource(visibility),
        5000,
      );
      if (allowed) await expect(operation).resolves.toBeUndefined();
      else await expect(operation).rejects.toThrow('legacy_denied');
    }
  });

  it('matches exact buyer authority and rejects unknown Seller mappings', async () => {
    const fixture = await explicitFixture();
    await expect(authorize(
      fixture.resource,
      buyerActor('buyer-account-1'),
      buyerPrincipal(1),
    )).resolves.toBeUndefined();
    await expect(authorize(
      fixture.resource,
      sellerActor('seller-member-1'),
      sellerPrincipal(1),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(authorize(
      fixture.resource,
      buyerActor('buyer-account-2'),
      buyerPrincipal(2),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(authorize(
      fixture.resource,
      sellerActor('seller-member-2'),
      sellerPrincipal(2),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(authorize(
      fixture.resource,
      sellerActor('seller-account-1'),
      sellerPrincipal(1),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(authorize(
      fixture.resource,
      sellerActor('seller-member-1'),
      buyerPrincipal(1),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(authorize(
      fixture.resource,
      buyerActor('buyer-account-1'),
      sellerPrincipal(1),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(authorize(
      fixture.resource,
      buyerActor('buyer-account-1'),
      {
        type: 'BUYER_SESSION',
        accountId: 'buyer-account-1',
        identitySubjectId: 'buyer-subject-2',
      },
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows only an eligible Buyer to read a published catalog main image', async () => {
    const resource = seedPublishedCatalogMainImage(database);
    await expect(authorize(
      resource,
      buyerActor('buyer-1'),
      buyerPrincipal(1),
      6000,
    )).resolves.toBeUndefined();

    database.exec(`
      UPDATE buyer_customers
      SET identity_review_status='REVIEW_REQUIRED', updated_at=7000
      WHERE id='buyer-1';
    `);
    await expect(authorize(
      resource,
      buyerActor('buyer-1'),
      buyerPrincipal(1),
      7000,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });

    database.exec(`
      UPDATE buyer_customers
      SET identity_review_status='CLEAR', updated_at=8000
      WHERE id='buyer-1';
      UPDATE demand_batches
      SET status='CLOSED', close_reason='test close',
          closed_by_staff_id='staff-file-owner', closed_at=8000,
          updated_at=8000
      WHERE id='catalog-demand-1';
    `);
    await expect(authorize(
      resource,
      buyerActor('buyer-1'),
      buyerPrincipal(1),
      8001,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps the catalog main image readable for a Buyer holding an active reservation', async () => {
    const resource = seedPublishedCatalogMainImage(database);
    database.exec(`
      INSERT INTO product_reservations (
        id, demand_batch_id, buyer_customer_id, organization_id, store_id,
        product_id, product_version_no, marketplace_code, status,
        precheck_snapshot_json, hold_expires_at, order_deadline_snapshot,
        version, submitted_at, updated_at
      ) VALUES (
        'owned-reservation-1', 'catalog-demand-1', 'buyer-1', 'seller-org-1',
        'catalog-store-1', 'catalog-product-1', 1, 'AMAZON_JP', 'PENDING_REVIEW',
        '{}', 9000, 12000, 1, 6000, 6000
      );
    `);
    await expect(authorize(
      resource,
      buyerActor('buyer-1'),
      buyerPrincipal(1),
      6000,
    )).resolves.toBeUndefined();

    // Past the reservation deadline and sold out, the owning Buyer still
    // reads the main image for their order journey.
    database.exec(`
      UPDATE demand_batches
      SET reservation_deadline=6000, order_deadline=6100,
          target_quantity=2, held_reservation_count=1,
          approved_reservation_count=1, updated_at=6500
      WHERE id='catalog-demand-1';
      UPDATE product_reservations
      SET status='APPROVED', decided_by_staff_id='staff-file-owner',
          decided_at=6500, updated_at=6500
      WHERE id='owned-reservation-1';
    `);
    await expect(authorize(
      resource,
      buyerActor('buyer-1'),
      buyerPrincipal(1),
      6600,
    )).resolves.toBeUndefined();

    // A different Buyer without a reservation loses access once the window
    // has closed.
    await expect(authorize(
      resource,
      buyerActor('buyer-2'),
      buyerPrincipal(2),
      6600,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects disabled accounts, members, organizations, and ungranted subjects', async () => {
    const fixture = await explicitFixture();
    database.exec(`
      UPDATE customer_login_accounts
      SET status='DISABLED', disabled_at=6000, updated_at=6000
      WHERE id='buyer-account-1';
    `);
    await expect(authorize(
      fixture.resource,
      buyerActor('buyer-account-1'),
      buyerPrincipal(1),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });

    database.exec(`
      UPDATE seller_organization_members
      SET status='DISABLED', disabled_at=6000, updated_at=6000
      WHERE id='seller-member-1';
    `);
    await expect(authorize(
      fixture.resource,
      sellerActor('seller-member-1'),
      sellerPrincipal(1),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });

    database.exec(`
      UPDATE seller_organizations
      SET status='DISABLED', disabled_at=6000, updated_at=6000
      WHERE id='seller-org-2';
    `);
    await expect(authorize(
      fixture.resource,
      sellerActor('seller-member-2'),
      sellerPrincipal(2),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('requires active role permission and ignores retired Team authority', async () => {
    const fixture = await explicitFixture();
    await expect(authorize(
      fixture.resource,
      staffActor,
      { type: 'STAFF_SESSION', staffId: staffActor.id },
    )).resolves.toBeUndefined();

    await expect(authorize(
      fixture.resource,
      staffActor,
      { type: 'STAFF_SESSION', staffId: staffActor.id },
    )).resolves.toBeUndefined();

    await expect(authorize(
      fixture.resource,
      {
        type: 'STAFF',
        id: 'staff-file-denied',
        roles: ['pre_sales'],
      },
      { type: 'STAFF_SESSION', staffId: 'staff-file-denied' },
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('revokes grants and links before an issued read intent can be consumed', async () => {
    const fixture = await explicitFixture();
    const readIntent = await createFileReadIntent(
      database,
      allowAll,
      {
        fileObjectId: fixture.fileObjectId,
        fileEntityLinkId: fixture.linkId,
        expectedFileVersion: 3,
        ttlMs: 60_000,
      },
      {
        actor: buyerActor('buyer-account-1'),
        principal: buyerPrincipal(1),
        idempotencyKey: 'explicit-read-0001',
        now: 7000,
      },
    );
    expect(readIntent.accessTokenAvailable).toBe(true);
    expect(JSON.stringify(readIntent)).not.toMatch(/object_key|https?:\/\//u);

    const buyerGrant = fixture.grants.find(
      (grant) => grant.subjectType === 'BUYER',
    );
    if (!buyerGrant || !readIntent.accessToken) {
      throw new Error('missing_explicit_read_fixture');
    }
    await database.batch(await createRevokeFileAudienceGrantStatements(
      database,
      { grantId: buyerGrant.grantId },
      {
        actor: staffActor,
        idempotencyKey: 'revoke-grant-0001',
        now: 8000,
      },
    ));
    await expect(consumeFileReadIntent(
      database,
      fixture.storage,
      allowAll,
      {
        readIntentId: readIntent.readIntentId,
        accessToken: readIntent.accessToken,
      },
      {
        actor: buyerActor('buyer-account-1'),
        principal: buyerPrincipal(1),
        now: 9000,
      },
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await database.batch(
      await createRevokeExplicitAudienceFileLinkStatements(
        database,
        { linkId: fixture.linkId },
        {
          actor: staffActor,
          idempotencyKey: 'revoke-link-0001',
          now: 10_000,
        },
      ),
    );
    await expect(authorize(
      fixture.resource,
      sellerActor('seller-member-1'),
      sellerPrincipal(1),
      10_001,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('enforces subject columns, uniqueness, expiry, and immutable events in D1', async () => {
    const fixture = await explicitFixture({ linkExpiresAt: 20_000 });
    await expect(database.prepare(`
      INSERT INTO file_entity_audience_grants (
        id, file_entity_link_id, subject_type,
        buyer_customer_id, seller_organization_id,
        staff_permission_code, staff_scope_type, staff_team_id,
        granted_by_actor_type, granted_by_actor_id,
        created_at, expires_at, revoked_at
      ) VALUES (
        'invalid-columns', ?, 'BUYER',
        'buyer-1', 'seller-org-1',
        NULL, NULL, NULL,
        'STAFF', 'staff-file-owner', 5000, NULL, NULL
      )
    `).bind(fixture.linkId).run()).rejects.toThrow();

    await expect(database.prepare(`
      INSERT INTO file_entity_audience_grants (
        id, file_entity_link_id, subject_type,
        buyer_customer_id, seller_organization_id,
        staff_permission_code, staff_scope_type, staff_team_id,
        granted_by_actor_type, granted_by_actor_id,
        created_at, expires_at, revoked_at
      ) VALUES (
        'duplicate-buyer', ?, 'BUYER',
        'buyer-1', NULL, NULL, NULL, NULL,
        'STAFF', 'staff-file-owner', 5000, NULL, NULL
      )
    `).bind(fixture.linkId).run()).rejects.toThrow(/UNIQUE/u);

    await expect(authorize(
      fixture.resource,
      sellerActor('seller-member-1'),
      sellerPrincipal(1),
      20_000,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(database.prepare(
      'DELETE FROM file_audience_events',
    ).run()).rejects.toThrow('file_audience_events_are_immutable');
    await expect(database.prepare(`
      UPDATE file_audience_events SET effective_at=effective_at+1
    `).run()).rejects.toThrow('file_audience_events_are_immutable');

    const sensitive = await database.prepare(`
      SELECT
        (
          SELECT group_concat(next_state_json, '')
          FROM audit_events
          WHERE aggregate_id=?
        ) AS audit_json
    `).bind(fixture.linkId).first<{
      audit_json: string;
    }>();
    expect(JSON.stringify(sensitive)).not.toMatch(
      /object_key|signed_url|session_token|secret|wechat|login_identifier/iu,
    );
  });
});

async function explicitFixture(options: {
  linkExpiresAt?: number | null;
} = {}) {
  const storage = new MockObjectStorage();
  const intent = await createFileUploadIntent(
    database,
    allowAll,
    {
      purpose: 'ORDER_EVIDENCE',
      visibility: 'BUYER_VISIBLE',
      files: [{
        clientFileName: 'explicit.png',
        declaredMime: 'image/png',
        byteSize: png.byteLength,
      }],
    },
    {
      actor: staffActor,
      idempotencyKey: `explicit-intent-${crypto.randomUUID()}`,
      now: 2000,
    },
  );
  const slot = intent.uploads[0];
  if (!slot?.uploadToken) throw new Error('missing_upload_token');
  await uploadFileObject(
    database,
    storage,
    allowAll,
    {
      fileObjectId: slot.fileObjectId,
      uploadToken: slot.uploadToken,
      declaredMime: 'image/png',
      bytes: png,
    },
    {
      actor: staffActor,
      idempotencyKey: `explicit-upload-${crypto.randomUUID()}`,
      now: 3000,
    },
  );
  await completeFileUploadIntent(
    database,
    storage,
    allowAll,
    {
      uploadIntentId: intent.uploadIntentId,
      expectedVersion: 1,
    },
    {
      actor: staffActor,
      idempotencyKey: `explicit-complete-${crypto.randomUUID()}`,
      now: 4000,
    },
  );
  const prepared = await createExplicitAudienceFileLinkStatements(
    database,
    allowAll,
    {
      fileObjectId: slot.fileObjectId,
      expectedFileVersion: 3,
      entityType: 'ORDER',
      entityId: `order-explicit-${crypto.randomUUID()}`,
      ...(options.linkExpiresAt === undefined
        ? {}
        : { expiresAt: options.linkExpiresAt }),
      grants: [
        { subjectType: 'BUYER', buyerCustomerId: 'buyer-1' },
        {
          subjectType: 'SELLER_ORGANIZATION',
          sellerOrganizationId: 'seller-org-1',
        },
        {
          subjectType: 'STAFF_INTERNAL',
          permissionCode: 'ORDER_VIEW',
          scope: { type: 'GLOBAL' },
        },
      ],
    },
    {
      actor: staffActor,
      idempotencyKey: `explicit-link-${crypto.randomUUID()}`,
      now: 5000,
    },
  );
  await database.batch(prepared.statements);
  return {
    storage,
    fileObjectId: slot.fileObjectId,
    linkId: prepared.result.linkId,
    grants: prepared.result.grants,
    resource: {
      uploadIntentId: intent.uploadIntentId,
      fileObjectId: slot.fileObjectId,
      ownerActorType: staffActor.type,
      ownerActorId: staffActor.id,
      purpose: 'ORDER_EVIDENCE',
      visibility: 'BUYER_VISIBLE',
      entityType: 'ORDER',
      entityId: prepared.result.entityId,
      fileEntityLinkId: prepared.result.linkId,
      linkAuthorizationMode: 'EXPLICIT_AUDIENCES',
      linkExpiresAt: prepared.result.expiresAt,
      linkRevokedAt: null,
    } satisfies FileAuthorizationResource,
  };
}

function authorize(
  resource: FileAuthorizationResource,
  actor: FileActor,
  principal: FileReadPrincipal,
  now = 6000,
) {
  return authorizeExplicitAudienceRead(
    database,
    principal,
    actor,
    resource,
    now,
  );
}

function buyerActor(id: string): FileActor {
  return { type: 'BUYER_CUSTOMER', id, roles: [] };
}

function sellerActor(id: string): FileActor {
  return { type: 'SELLER_MEMBER', id, roles: [] };
}

function buyerPrincipal(number: 1 | 2): FileReadPrincipal {
  return {
    type: 'BUYER_SESSION',
    accountId: `buyer-account-${number}`,
    identitySubjectId: `buyer-subject-${number}`,
  };
}

function sellerPrincipal(number: 1 | 2): FileReadPrincipal {
  return {
    type: 'SELLER_SESSION',
    accountId: `seller-account-${number}`,
    identitySubjectId: `seller-subject-${number}`,
  };
}

function legacyResource(
  visibility: 'INTERNAL_ONLY' | 'BUYER_VISIBLE' | 'SELLER_VISIBLE',
): FileAuthorizationResource {
  return {
    uploadIntentId: 'legacy-intent',
    fileObjectId: 'legacy-object',
    ownerActorType: 'STAFF',
    ownerActorId: 'legacy-owner',
    purpose: 'ORDER_EVIDENCE',
    visibility,
    entityType: 'ORDER',
    entityId: 'legacy-order',
    fileEntityLinkId: 'legacy-link',
    linkAuthorizationMode: 'LEGACY_VISIBILITY',
    linkExpiresAt: null,
    linkRevokedAt: null,
  };
}

function legacyVisibilityAuthorization(): FileAuthorizationService {
  const unused = () => {};
  return {
    assertCanCreateUpload: unused,
    assertCanUpload: unused,
    assertCanCompleteUpload: unused,
    assertCanLink: unused,
    assertCanRead(actor, resource) {
      if (actor.type === 'STAFF'
        || (actor.type === 'BUYER_CUSTOMER'
          && resource.visibility === 'BUYER_VISIBLE')
        || (actor.type === 'SELLER_MEMBER'
          && resource.visibility === 'SELLER_VISIBLE')) {
        return;
      }
      throw new Error('legacy_denied');
    },
  };
}

function seedAudienceIdentities(target: SqliteDatabase): void {
  target.exec(`


    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      ('staff-file-owner', 'File Owner', 'ACTIVE', 1,
        1, 1000, 1000, NULL),
      ('staff-file-denied', 'Denied Staff', 'ACTIVE', 1,
        1, 1000, 1000, NULL);

    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES
      ('staff-file-owner', 'owner', 'ACTIVE', NULL,
        1000, NULL, 1000, 1000),
      ('staff-file-denied', 'pre_sales', 'ACTIVE', NULL,
        1000, NULL, 1000, 1000);

    INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, reason,
      status, assigned_by_staff_id, assigned_at,
      revoked_at, created_at, updated_at
    ) VALUES (
      'staff-file-denied', 'ORDER_VIEW', 'DENY', 'test deny',
      'ACTIVE', NULL, 1000, NULL, 1000, 1000
    );


    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES
      ('seller-org-1', 'AMAZON_JP', 'ido-mango-9701',
        'seller-channel-ido-mango', 'seller-channel-ido-mango',
        9701, 'Seller One', 'ACTIVE', 1,
        1000, 1000, 1000, NULL, 2),
      ('seller-org-2', 'AMAZON_JP', 'ido-mango-9702',
        'seller-channel-ido-mango', 'seller-channel-ido-mango',
        9702, 'Seller Two', 'ACTIVE', 1,
        1000, 1000, 1000, NULL, 2);

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('buyer-subject-1', 'BUYER_CUSTOMER', 1000),
      ('buyer-subject-2', 'BUYER_CUSTOMER', 1000),
      ('seller-subject-1', 'SELLER_ORG_MEMBER', 1000),
      ('seller-subject-2', 'SELLER_ORG_MEMBER', 1000);

    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code,
      buyer_channel_id, buyer_customer_no,
      buyer_sequence,
      display_name, access_status,
      identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('buyer-1', 'buyer-subject-1', 'AMAZON_JP',
        'buyer-channel-wechat-b', '19700101B0001', 1,
        'Buyer One', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL),
      ('buyer-2', 'buyer-subject-2', 'AMAZON_JP',
        'buyer-channel-wechat-b', '19700101B0002', 2,
        'Buyer Two', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL);

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('seller-member-1', 'seller-subject-1', 'seller-org-1',
        1, 'seller-file-001', 'Seller One Owner',
        'OWNER', 1, 'ACTIVE', 1, 1000, 1000, 1000, NULL),
      ('seller-member-2', 'seller-subject-2', 'seller-org-2',
        1, 'seller-file-002', 'Seller Two Owner',
        'OWNER', 1, 'ACTIVE', 1, 1000, 1000, 1000, NULL);

    INSERT INTO customer_login_accounts (
      id, identity_subject_id, account_type,
      login_identifier_display, login_identifier_normalized,
      status, session_version, password_change_required,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('buyer-account-1', 'buyer-subject-1', 'BUYER',
        'buyer_file_1', 'buyer_file_1',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL),
      ('buyer-account-2', 'buyer-subject-2', 'BUYER',
        'buyer_file_2', 'buyer_file_2',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL),
      ('seller-account-1', 'seller-subject-1', 'SELLER_MEMBER',
        'seller_file_1', 'seller_file_1',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL),
      ('seller-account-2', 'seller-subject-2', 'SELLER_MEMBER',
        'seller_file_2', 'seller_file_2',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL);
  `);
}

function seedPublishedCatalogMainImage(
  target: SqliteDatabase,
): FileAuthorizationResource {
  target.exec(`
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name,
      normalized_name, status, version, created_at, updated_at, disabled_at
    ) VALUES (
      'catalog-store-1', 'seller-org-1', 'AMAZON_JP', 'Catalog Store',
      'catalog store', 'ACTIVE', 1, 1000, 1000, NULL
    );
    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status, current_version_no,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'catalog-product-1', 'seller-org-1', 'catalog-store-1', 'AMAZON_JP',
      'B0CATALOG1', 'B0CATALOG1', 'ACTIVE', 1, 1,
      1000, 1000, NULL
    );
    INSERT INTO product_versions (
      id, product_id, version_no, product_name, search_keywords_json,
      product_url, buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at,
      ordering_guide_expected_amount_jpy, color_spec_mode,
      default_buyer_self_pay_bps
    ) VALUES (
      'catalog-product-version-1', 'catalog-product-1', 1,
      'Catalog Product', '["catalog"]', NULL, NULL, NULL,
      'staff-file-owner', 1000, 2999, 'MAIN_IMAGE_VARIANT', 0
    );
    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code, product_id,
      product_version_no, submitted_by_member_id, task_type,
      target_quantity, buyer_visible_notes, seller_notes, open_at,
      reservation_deadline, order_deadline, status, review_reason,
      close_reason, reviewed_by_staff_id, closed_by_staff_id, version,
      submitted_at, updated_at, reviewed_at, published_at,
      withdrawn_at, closed_at, held_reservation_count,
      approved_reservation_count, buyer_self_pay_bps_snapshot,
      buyer_self_pay_source, buyer_self_pay_override_reason
    ) VALUES (
      'catalog-demand-1', 'seller-org-1', 'catalog-store-1', 'AMAZON_JP',
      'catalog-product-1', 1, 'seller-member-1', 'TEXT', 2,
      NULL, NULL, 5000, 10000, 12000, 'PUBLISHED', NULL, NULL,
      'staff-file-owner', NULL, 2, 5000, 5000, 5000, 5000,
      NULL, NULL, 0, 0, 0, 'PRODUCT_DEFAULT', NULL
    );
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility,
      status, requested_file_count, manifest_hash, version, expires_at,
      failure_code, created_at, updated_at, completed_at
    ) VALUES (
      'catalog-main-intent', 'STAFF', 'staff-file-owner', 'PRODUCT_IMAGE',
      'SELLER_VISIBLE', 'ISSUED', 1, '${'d'.repeat(64)}', 1,
      10000, NULL, 1000, 1000, NULL
    );
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size,
      status, upload_token_hash, upload_expires_at, uploaded_byte_size,
      detected_mime, uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at, uploaded_at,
      verified_at, deleted_at
    ) VALUES (
      'catalog-main-object', 'catalog-main-intent', 1, 'PRODUCT_IMAGE',
      'SELLER_VISIBLE',
      'files/v1/2026/08/catalogmainimageobjectkeyxxxxxxxxxxxxxxxx',
      'catalog.png', 'png', 'image/png', 11, 'RESERVED',
      '${'e'.repeat(64)}', 10000, NULL, NULL, NULL,
      NULL, 0, NULL, 3, 1000, 1000, NULL, NULL, NULL
    );
    UPDATE file_upload_intents
    SET status='VERIFIED', updated_at=1001, completed_at=1001
    WHERE id='catalog-main-intent';
    UPDATE file_objects
    SET status='VERIFIED', uploaded_byte_size=11, detected_mime='image/png',
        uploaded_sha256='${'f'.repeat(64)}', updated_at=1001,
        uploaded_at=1001, verified_at=1001
    WHERE id='catalog-main-object';
    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (
      'catalog-main-link', 'catalog-main-object', 'PRODUCT_VERSION',
      'catalog-product-version-1', 'PRODUCT_IMAGE', 'SELLER_VISIBLE',
      'STAFF', 'staff-file-owner', 1002, 'EXPLICIT_AUDIENCES', NULL, NULL
    );
    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type, buyer_customer_id,
      seller_organization_id, staff_permission_code, staff_scope_type,
      staff_team_id, granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES
      ('catalog-main-seller-grant', 'catalog-main-link',
       'SELLER_ORGANIZATION', NULL, 'seller-org-1', NULL, NULL, NULL,
       'STAFF', 'staff-file-owner', 1002, NULL, NULL),
      ('catalog-main-staff-grant', 'catalog-main-link',
       'STAFF_INTERNAL', NULL, NULL, 'PRODUCT_VIEW', 'GLOBAL', NULL,
       'STAFF', 'staff-file-owner', 1002, NULL, NULL);
    INSERT INTO product_version_main_images (
      product_version_id, file_entity_link_id, created_by_staff_id, created_at
    ) VALUES (
      'catalog-product-version-1', 'catalog-main-link',
      'staff-file-owner', 1002
    );
  `);
  return {
    uploadIntentId: 'catalog-main-intent',
    fileObjectId: 'catalog-main-object',
    ownerActorType: 'STAFF',
    ownerActorId: 'staff-file-owner',
    purpose: 'PRODUCT_IMAGE',
    visibility: 'SELLER_VISIBLE',
    entityType: 'PRODUCT_VERSION',
    entityId: 'catalog-product-version-1',
    fileEntityLinkId: 'catalog-main-link',
    linkAuthorizationMode: 'EXPLICIT_AUDIENCES',
    linkExpiresAt: null,
    linkRevokedAt: null,
  };
}
