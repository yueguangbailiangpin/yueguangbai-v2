import type {
  FileActor,
  FileEntityLinkResult,
  FileEntityType,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  filePurposeEntityType,
  hashCanonicalJson,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { FileAuthorizationService } from './authorization';
import { createFileEventStatement } from './file-events';
import {
  FileStorageError,
  normalizeFileStorageError,
} from './file-error';
import {
  cleanFileIdentifier,
  type FileObjectRow,
} from './file-records';

export async function linkVerifiedFileToEntity(
  database: SqlDatabase,
  authorization: FileAuthorizationService,
  input: {
    fileObjectId: string;
    expectedFileVersion: number;
    entityType: FileEntityType;
    entityId: string;
  },
  command: {
    actor: FileActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<FileEntityLinkResult> {
  const fileObjectId = cleanFileIdentifier(input.fileObjectId, 120);
  const entityId = cleanFileIdentifier(input.entityId, 200);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(input.expectedFileVersion)
    || input.expectedFileVersion < 1) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const source = await requireVerifiedObject(database, fileObjectId);
  if (source.version !== input.expectedFileVersion) {
    throw new FileStorageError('VERSION_CONFLICT', 409);
  }
  const requiredEntityType = filePurposeEntityType(source.purpose);
  if (input.entityType !== requiredEntityType) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  await authorization.assertCanLink(command.actor, {
    uploadIntentId: source.upload_intent_id,
    fileObjectId: source.id,
    ownerActorType: source.owner_actor_type,
    ownerActorId: source.owner_actor_id,
    purpose: source.purpose,
    visibility: source.visibility,
    entityType: input.entityType,
    entityId,
  });

  const requestHash = await hashCanonicalJson({
    action: 'LINK_VERIFIED_FILE_TO_ENTITY',
    file_object_id: fileObjectId,
    expected_file_version: input.expectedFileVersion,
    entity_type: input.entityType,
    entity_id: entityId,
  });
  const acquired = await acquireIdempotency<FileEntityLinkResult>(
    database,
    {
      actorType: command.actor.type,
      actorId: command.actor.id,
      action: 'LINK_VERIFIED_FILE_TO_ENTITY',
      targetType: 'FILE_ENTITY_LINK',
      targetId: `file-link:${requestHash.slice(0, 32)}`,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const linkId = crypto.randomUUID();
    const response: FileEntityLinkResult = {
      linkId,
      fileObjectId,
      entityType: input.entityType,
      entityId,
      purpose: source.purpose,
      visibility: source.visibility,
      replayed: false,
    };

    await database.batch([
      database.prepare(`
        INSERT INTO file_entity_links (
          id,
          file_object_id,
          entity_type,
          entity_id,
          purpose,
          visibility,
          linked_by_actor_type,
          linked_by_actor_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        linkId,
        fileObjectId,
        input.entityType,
        entityId,
        source.purpose,
        source.visibility,
        command.actor.type,
        command.actor.id,
        now,
      ),
      createFileEventStatement(database, {
        uploadIntentId: source.upload_intent_id,
        fileObjectId,
        eventType: 'FILE_OBJECT_LINKED',
        actorType: command.actor.type,
        actorId: command.actor.id,
        previousStatus: 'VERIFIED',
        nextStatus: 'VERIFIED',
        metadata: {
          entity_type: input.entityType,
          entity_id: entityId,
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'FILE_OBJECT',
        aggregateId: fileObjectId,
        eventType: 'FILE_OBJECT_LINKED',
        actor: {
          type: command.actor.type,
          id: command.actor.id,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
        nextState: {
          link_id: linkId,
          entity_type: input.entityType,
          entity_id: entityId,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            link_id: linkId,
            file_object_id: fileObjectId,
          },
          now,
        },
      ),
      assertLinkCreatedStatement(
        database,
        acquired.claim,
        response,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizeFileStorageError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

async function requireVerifiedObject(
  database: SqlDatabase,
  fileObjectId: string,
): Promise<FileObjectRow> {
  const row = await database.prepare(`
    SELECT
      object.*,
      intent.owner_actor_type,
      intent.owner_actor_id,
      intent.status AS intent_status,
      intent.version AS intent_version,
      intent.expires_at AS intent_expires_at
    FROM file_objects object
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
    WHERE object.id=?
  `).bind(fileObjectId).first<FileObjectRow>();
  if (!row) throw new FileStorageError('FILE_OBJECT_NOT_FOUND', 404);
  if (row.status !== 'VERIFIED' || row.intent_status !== 'VERIFIED') {
    throw new FileStorageError('FILE_NOT_VERIFIED', 409);
  }
  return row;
}

function assertLinkCreatedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: FileEntityLinkResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM file_entity_links
        WHERE id=?
          AND file_object_id=?
          AND entity_type=?
          AND entity_id=?
      )
      AND EXISTS (
        SELECT 1
        FROM file_objects
        WHERE id=?
          AND status='VERIFIED'
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
    response.linkId,
    response.fileObjectId,
    response.entityType,
    response.entityId,
    response.fileObjectId,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
