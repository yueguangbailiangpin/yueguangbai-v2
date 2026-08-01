import type {
  FileActor,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import { requireCatalogOrganizationScope } from '../staff-assignment';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import type { FileAuthorizationService } from '../files/authorization';
import {
  createExplicitAudienceFileLinkStatements,
} from '../files/explicit-audience-links';
import {
  CatalogError,
  cleanCatalogIdentifier,
  requireCatalogPermission,
  type CatalogStaffActor,
} from './catalog-shared';

interface ProductVersionSource {
  product_version_id: string;
  product_id: string;
  version_no: number;
  organization_id: string;
  store_id: string;
  product_status: string;
  store_status: string;
  organization_status: string;
}

export interface LinkProductVersionMainImageResult {
  product_id: string;
  product_version_id: string;
  product_version_no: number;
  file_entity_link_id: string;
  file_object_id: string;
  seller_organization_id: string;
  store_id: string;
  authorization_mode: 'EXPLICIT_AUDIENCES';
  replayed: boolean;
}

/**
 * Creates the immutable main-image fact for one product version. The file
 * helper verifies both upload intent and object state, creates explicit
 * seller-organization and staff-internal audience grants, and deliberately
 * returns no object key, permanent URL, or signed URL.
 */
export async function linkProductVersionMainImage(
  database: SqlDatabase,
  authorization: FileAuthorizationService,
  input: {
    productVersionId: string;
    fileObjectId: string;
    expectedFileVersion: number;
  },
  command: {
    actor: CatalogStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<LinkProductVersionMainImageResult> {
  requireCatalogPermission(command.actor, 'PRODUCT_REVIEW');
  const productVersionId = cleanCatalogIdentifier(
    input.productVersionId,
  );
  const fileObjectId = cleanCatalogIdentifier(input.fileObjectId);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(input.expectedFileVersion)
    || input.expectedFileVersion < 1
    || !Number.isSafeInteger(now)
    || now < 0) {
    throw new CatalogError('VALIDATION_ERROR', 400);
  }

  const source = await requireProductVersionSource(
    database,
    productVersionId,
  );
  requireCatalogOrganizationScope(command.actor, source.organization_id);
  const requestHash = await hashCanonicalJson({
    action: 'LINK_PRODUCT_VERSION_MAIN_IMAGE',
    product_version_id: productVersionId,
    file_object_id: fileObjectId,
    expected_file_version: input.expectedFileVersion,
  });
  const acquired =
    await acquireIdempotency<LinkProductVersionMainImageResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'LINK_PRODUCT_VERSION_MAIN_IMAGE',
        targetType: 'PRODUCT_VERSION',
        targetId: productVersionId,
        idempotencyKey: command.idempotencyKey,
        requestHash,
      },
      { now },
    );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const fileActor: FileActor = {
      type: 'STAFF',
      id: command.actor.staffId,
      roles: command.actor.roles,
    };
    const prepared = await createExplicitAudienceFileLinkStatements(
      database,
      authorization,
      {
        fileObjectId,
        expectedFileVersion: input.expectedFileVersion,
        entityType: 'PRODUCT_VERSION',
        entityId: productVersionId,
        expiresAt: null,
        grants: [
          {
            subjectType: 'SELLER_ORGANIZATION',
            sellerOrganizationId: source.organization_id,
          },
          {
            subjectType: 'STAFF_INTERNAL',
            permissionCode: 'PRODUCT_VIEW',
            scope: { type: 'GLOBAL' },
          },
        ],
      },
      {
        actor: fileActor,
        idempotencyKey: acquired.claim.idempotencyKey,
        requestId: command.requestId ?? null,
        now,
      },
    );

    if (prepared.result.purpose !== 'PRODUCT_IMAGE'
      || prepared.result.entityType !== 'PRODUCT_VERSION'
      || prepared.result.entityId !== productVersionId) {
      throw new CatalogError('VALIDATION_ERROR', 400);
    }

    const response: LinkProductVersionMainImageResult = {
      product_id: source.product_id,
      product_version_id: productVersionId,
      product_version_no: Number(source.version_no),
      file_entity_link_id: prepared.result.linkId,
      file_object_id: fileObjectId,
      seller_organization_id: source.organization_id,
      store_id: source.store_id,
      authorization_mode: 'EXPLICIT_AUDIENCES',
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `product-version-main-image:${productVersionId}`,
      eventType: 'PRODUCT_VERSION_MAIN_IMAGE_LINKED',
      aggregateType: 'PRODUCT',
      aggregateId: source.product_id,
      payload: {
        product_id: source.product_id,
        product_version_id: productVersionId,
        product_version_no: Number(source.version_no),
        file_entity_link_id: prepared.result.linkId,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      ...prepared.statements,
      database.prepare(`
        INSERT INTO product_version_main_images (
          product_version_id,
          file_entity_link_id,
          created_by_staff_id,
          created_at
        ) VALUES (?, ?, ?, ?)
      `).bind(
        productVersionId,
        prepared.result.linkId,
        command.actor.staffId,
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'PRODUCT',
        aggregateId: source.product_id,
        eventType: 'PRODUCT_VERSION_MAIN_IMAGE_LINKED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
        nextState: response,
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            product_id: source.product_id,
            product_version_id: productVersionId,
            file_entity_link_id: prepared.result.linkId,
          },
          now,
        },
      ),
      assertMainImageLinkedStatement(
        database,
        acquired.claim,
        response,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const code = errorCode(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      code,
      now,
    ).catch(() => false);
    throw normalizeMainImageError(error);
  }
}

async function requireProductVersionSource(
  database: SqlDatabase,
  productVersionId: string,
): Promise<ProductVersionSource> {
  const row = await database.prepare(`
    SELECT
      version.id AS product_version_id,
      version.product_id,
      version.version_no,
      product.organization_id,
      product.store_id,
      product.status AS product_status,
      store.status AS store_status,
      organization.status AS organization_status
    FROM product_versions version
    JOIN products product
      ON product.id=version.product_id
    JOIN seller_stores store
      ON store.id=product.store_id
      AND store.organization_id=product.organization_id
    JOIN seller_organizations organization
      ON organization.id=product.organization_id
    WHERE version.id=?
  `).bind(productVersionId).first<ProductVersionSource>();
  if (!row) throw new CatalogError('PRODUCT_NOT_FOUND', 404);
  if (row.product_status !== 'ACTIVE'
    || row.store_status !== 'ACTIVE'
    || row.organization_status !== 'ACTIVE') {
    throw new CatalogError('VALIDATION_ERROR', 409);
  }
  return row;
}

function assertMainImageLinkedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: LinkProductVersionMainImageResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM product_version_main_images image
        JOIN file_entity_links link
          ON link.id=image.file_entity_link_id
        WHERE image.product_version_id=?
          AND image.file_entity_link_id=?
          AND link.file_object_id=?
          AND link.entity_type='PRODUCT_VERSION'
          AND link.entity_id=?
          AND link.purpose='PRODUCT_IMAGE'
          AND link.authorization_mode='EXPLICIT_AUDIENCES'
          AND link.revoked_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM command_idempotency_records
        WHERE actor_type=?
          AND actor_id=?
          AND idempotency_key=?
          AND status='COMMITTED'
          AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    response.product_version_id,
    response.file_entity_link_id,
    response.file_object_id,
    response.product_version_id,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}

function errorCode(error: unknown): string {
  const value = (error as { code?: unknown })?.code;
  return typeof value === 'string'
    ? value
    : 'DEPENDENCY_UNAVAILABLE';
}

function normalizeMainImageError(error: unknown): unknown {
  if (error instanceof CatalogError) return error;
  const message = String(error);
  if (message.includes('product_version_main_images.product_version_id')
    || message.includes('uq_product_image_file_object')
    || message.includes('product_version_main_image_link_invalid')
    || message.includes('file_entity_links.file_object_id')) {
    return new CatalogError('VERSION_CONFLICT', 409);
  }
  return error;
}
