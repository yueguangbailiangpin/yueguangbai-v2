import type {
  FileActor,
  ObjectStorageAdapter,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { createAuditEventStatement } from '../foundation/audit';
import type { FileAuthorizationService } from '../files/authorization';
import {
  prepareFileObjectClone,
  readVerifiedFileObject,
} from '../files/file-object-clone';
import {
  buildExplicitAudienceFileLinkStatements,
} from '../files/explicit-audience-links';
import { CatalogError } from './catalog-shared';

export interface PreparedMainImageClone {
  file_object_id: string;
  file_entity_link_id: string;
  object_key: string;
  statements: readonly SqlStatement[];
}

/**
 * Builds the full statement chain that binds a cloned copy of an existing
 * verified file object as the main image of a product version: fresh upload
 * intent + object (cloned bytes in R2), explicit-audience link with the
 * seller-organization and staff-internal grants, and the immutable
 * product_version_main_images fact. Every statement must run inside the
 * caller's batch so the main image appears atomically with the version it
 * belongs to. `object_key` is exposed for R2 compensation when the batch
 * fails after the clone bytes were already stored.
 */
export async function prepareMainImageCloneStatements(
  database: SqlDatabase,
  storage: ObjectStorageAdapter,
  authorization: FileAuthorizationService,
  input: {
    sourceFileObjectId: string;
    expectedSourceFileVersion: number;
    productId: string;
    productVersionId: string;
    sellerOrganizationId: string;
    actor: FileActor;
  },
  command: {
    idempotencyKey: string;
    requestId?: string | null;
    now: number;
  },
): Promise<PreparedMainImageClone> {
  const source = await readVerifiedFileObject(
    database,
    input.sourceFileObjectId,
  );
  if (source.object_version !== input.expectedSourceFileVersion) {
    throw new CatalogError('VERSION_CONFLICT', 409);
  }
  const clone = await prepareFileObjectClone(database, storage, source, {
    ownerActorType: 'STAFF',
    ownerActorId: input.actor.id,
    idempotencyKey: command.idempotencyKey,
    now: command.now,
  });

  const preparedLink = await buildExplicitAudienceFileLinkStatements(
    database,
    authorization,
    {
      upload_intent_id: clone.cloneIntentId,
      purpose: 'PRODUCT_IMAGE',
      visibility: 'SELLER_VISIBLE',
      version: 1,
      owner_actor_type: 'STAFF',
      owner_actor_id: input.actor.id,
    },
    {
      fileObjectId: clone.cloneFileObjectId,
      expectedFileVersion: 1,
      entityType: 'PRODUCT_VERSION',
      entityId: input.productVersionId,
      expiresAt: null,
      grants: [
        {
          subjectType: 'SELLER_ORGANIZATION',
          sellerOrganizationId: input.sellerOrganizationId,
        },
        {
          subjectType: 'STAFF_INTERNAL',
          permissionCode: 'PRODUCT_VIEW',
          scope: { type: 'GLOBAL' },
        },
      ],
    },
    {
      actor: input.actor,
      idempotencyKey: command.idempotencyKey,
      requestId: command.requestId ?? null,
      now: command.now,
    },
  );


  const statements: SqlStatement[] = [
    ...clone.statements,
    ...preparedLink.statements,
    database.prepare(`
      INSERT INTO product_version_main_images (
        product_version_id,
        file_entity_link_id,
        created_by_staff_id,
        created_at
      ) VALUES (?, ?, ?, ?)
    `).bind(
      input.productVersionId,
      preparedLink.result.linkId,
      input.actor.id,
      command.now,
    ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'PRODUCT',
      aggregateId: input.productId,
      eventType: 'PRODUCT_VERSION_MAIN_IMAGE_LINKED',
      actor: {
        type: input.actor.type,
        id: input.actor.id,
        roles: input.actor.roles,
      },
      requestId: command.requestId ?? null,
      idempotencyKey: command.idempotencyKey,
      previousState: null,
      nextState: {
        product_version_id: input.productVersionId,
        file_entity_link_id: preparedLink.result.linkId,
        file_object_id: clone.cloneFileObjectId,
        cloned_from_file_object_id: input.sourceFileObjectId,
      },
      createdAt: command.now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM product_version_main_images image
        JOIN file_entity_links link
          ON link.id=image.file_entity_link_id
        JOIN file_objects object
          ON object.id=link.file_object_id
        JOIN file_upload_intents intent
          ON intent.id=object.upload_intent_id
        WHERE image.product_version_id=?
          AND link.file_object_id=?
          AND link.entity_type='PRODUCT_VERSION'
          AND link.entity_id=?
          AND link.purpose='PRODUCT_IMAGE'
          AND link.authorization_mode='EXPLICIT_AUDIENCES'
          AND link.revoked_at IS NULL
          AND object.status='VERIFIED'
          AND intent.status='VERIFIED'
      ) THEN 1 ELSE 0 END
    `).bind(
      input.productVersionId,
      clone.cloneFileObjectId,
      input.productVersionId,
    ),
  ];

  return {
    file_object_id: clone.cloneFileObjectId,
    file_entity_link_id: preparedLink.result.linkId,
    object_key: clone.cloneObjectKey,
    statements: Object.freeze(statements),
  };
}
