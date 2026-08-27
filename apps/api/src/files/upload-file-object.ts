import {
  objectStoragePutMayHaveStored,
  type FileActor,
  type FileObjectUploadResult,
  type ObjectStorageAdapter,
  type SqlDatabase,
  type SqlStatement,
} from '@ygb/contracts';
import {
  constantTimeHexEqual,
  hashCanonicalJson,
  hashOpaqueFileToken,
  inspectTrustedFileBytes,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { FileAuthorizationService } from './authorization';
import { compensateStoredObjects } from './compensation';
import { createFileEventStatement } from './file-events';
import {
  FileStorageError,
  normalizeFileStorageError,
} from './file-error';
import {
  cleanFileIdentifier,
  type FileObjectRow,
} from './file-records';

export async function uploadFileObject(
  database: SqlDatabase,
  storage: ObjectStorageAdapter,
  authorization: FileAuthorizationService,
  input: {
    fileObjectId: string;
    uploadToken: string;
    declaredMime: string;
    bytes: Uint8Array<ArrayBuffer>;
  },
  command: {
    actor: FileActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<FileObjectUploadResult> {
  const fileObjectId = cleanFileIdentifier(input.fileObjectId, 120);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const source = await requireUploadSource(database, fileObjectId);
  await authorization.assertCanUpload(command.actor, {
    uploadIntentId: source.upload_intent_id,
    fileObjectId: source.id,
    ownerActorType: source.owner_actor_type,
    ownerActorId: source.owner_actor_id,
    purpose: source.purpose,
    visibility: source.visibility,
    entityType: null,
    entityId: null,
  });
  const tokenHash = await hashOpaqueFileToken(input.uploadToken)
    .catch(() => '');
  if (!constantTimeHexEqual(tokenHash, source.upload_token_hash)) {
    throw new FileStorageError('FORBIDDEN', 403);
  }

  const inspection = await inspectTrustedFileBytes({
    purpose: source.purpose,
    clientFileName: source.client_file_name,
    declaredMime: input.declaredMime,
    expectedByteSize: source.expected_byte_size,
    bytes: input.bytes,
  }).catch((error: unknown) => {
    throw normalizeFileStorageError(error);
  });
  if (input.declaredMime.trim().toLocaleLowerCase('en-US')
    !== source.declared_mime) {
    throw new FileStorageError('FILE_VALIDATION_FAILED', 422);
  }

  const requestHash = await hashCanonicalJson({
    action: 'UPLOAD_FILE_OBJECT',
    file_object_id: fileObjectId,
    byte_size: inspection.byteSize,
    detected_mime: inspection.detectedMime,
    sha256: inspection.sha256,
  });
  const acquired = await acquireIdempotency<FileObjectUploadResult>(
    database,
    {
      actorType: command.actor.type,
      actorId: command.actor.id,
      action: 'UPLOAD_FILE_OBJECT',
      targetType: 'FILE_OBJECT',
      targetId: fileObjectId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  if (source.intent_status !== 'ISSUED'
    || source.status !== 'RESERVED') {
    await markIdempotencyFailed(
      database,
      acquired.claim,
      'FILE_STORAGE_CONFLICT',
      now,
    ).catch(() => false);
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  if (source.upload_expires_at <= now
    || source.intent_expires_at <= now) {
    await markIdempotencyFailed(
      database,
      acquired.claim,
      'FILE_UPLOAD_EXPIRED',
      now,
    ).catch(() => false);
    throw new FileStorageError('FILE_UPLOAD_EXPIRED', 410);
  }

  let stored = false;
  try {
    let receipt;
    try {
      receipt = await storage.putObject({
        objectKey: source.object_key,
        bytes: input.bytes,
        contentType: inspection.detectedMime,
        metadata: {
          'ygb-file-object-id': source.id,
          'ygb-upload-intent-id': source.upload_intent_id,
        },
      });
    } catch (error) {
      stored = objectStoragePutMayHaveStored(error);
      throw error;
    }
    stored = true;
    if (receipt.byteSize !== inspection.byteSize
      || receipt.contentType !== inspection.detectedMime
      || receipt.checksumSha256 !== inspection.sha256) {
      throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
    }

    const response: FileObjectUploadResult = {
      fileObjectId,
      uploadIntentId: source.upload_intent_id,
      status: 'UPLOADED',
      detectedMime: inspection.detectedMime,
      byteSize: inspection.byteSize,
      sha256: inspection.sha256,
      version: source.version + 1,
      replayed: false,
    };

    await database.batch([
      database.prepare(`
        UPDATE file_objects
        SET
          status='UPLOADED',
          uploaded_byte_size=?,
          detected_mime=?,
          uploaded_sha256=?,
          failure_code=NULL,
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          uploaded_at=?
        WHERE id=?
          AND upload_intent_id=?
          AND status='RESERVED'
          AND version=?
          AND upload_expires_at>?
      `).bind(
        inspection.byteSize,
        inspection.detectedMime,
        inspection.sha256,
        now,
        now,
        fileObjectId,
        source.upload_intent_id,
        source.version,
        now,
      ),
      createFileEventStatement(database, {
        uploadIntentId: source.upload_intent_id,
        fileObjectId,
        eventType: 'FILE_OBJECT_UPLOADED',
        actorType: command.actor.type,
        actorId: command.actor.id,
        previousStatus: 'RESERVED',
        nextStatus: 'UPLOADED',
        metadata: {
          byte_size: inspection.byteSize,
          detected_mime: inspection.detectedMime,
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'FILE_OBJECT',
        aggregateId: fileObjectId,
        eventType: 'FILE_OBJECT_UPLOADED',
        actor: {
          type: command.actor.type,
          id: command.actor.id,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: { status: 'RESERVED', version: source.version },
        nextState: {
          status: 'UPLOADED',
          version: response.version,
          byte_size: inspection.byteSize,
          detected_mime: inspection.detectedMime,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            file_object_id: fileObjectId,
            upload_intent_id: source.upload_intent_id,
          },
          now,
        },
      ),
      assertObjectUploadedStatement(
        database,
        acquired.claim,
        response,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizeFileStorageError(error);
    if (stored) {
      const plan = await compensateStoredObjects(database, storage, {
        uploadIntentId: source.upload_intent_id,
        objects: [{
          fileObjectId,
          objectKey: source.object_key,
          byteSize: inspection.byteSize,
          detectedMime: inspection.detectedMime,
          sha256: inspection.sha256,
        }],
        reason: 'UPLOAD_D1_OR_STORAGE_VERIFICATION_FAILED',
        actor: command.actor,
        idempotencyKey: acquired.claim.idempotencyKey,
        now,
      });
      await markIdempotencyFailed(
        database,
        acquired.claim,
        plan.deletePendingObjectIds.length > 0
          ? 'FILE_COMPENSATION_REQUIRED'
          : normalized.code,
        now,
      ).catch(() => false);
      if (plan.deletePendingObjectIds.length > 0) {
        throw new FileStorageError(
          'FILE_COMPENSATION_REQUIRED',
          503,
          plan,
        );
      }
    } else {
      await markIdempotencyFailed(
        database,
        acquired.claim,
        normalized.code,
        now,
      ).catch(() => false);
    }
    throw normalized;
  }
}

async function requireUploadSource(
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
  return row;
}

function assertObjectUploadedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: FileObjectUploadResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM file_objects
        WHERE id=?
          AND upload_intent_id=?
          AND status='UPLOADED'
          AND uploaded_byte_size=?
          AND detected_mime=?
          AND uploaded_sha256=?
          AND version=?
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
    response.fileObjectId,
    response.uploadIntentId,
    response.byteSize,
    response.detectedMime,
    response.sha256,
    response.version,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
