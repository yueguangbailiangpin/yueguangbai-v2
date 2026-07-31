import type {
  FileActor,
  FileManifestRecord,
  FileUploadVerificationResult,
  ObjectStorageAdapter,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  detectSupportedMime,
  hashCanonicalJson,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
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
import type { FileAuthorizationService } from './authorization';
import {
  compensateStoredObjects,
  type CompensatableObject,
} from './compensation';
import { createFileEventStatement } from './file-events';
import {
  FileStorageError,
  normalizeFileStorageError,
} from './file-error';
import {
  cleanFileIdentifier,
  type FileIntentRow,
  type FileObjectRow,
} from './file-records';

export async function completeFileUploadIntent(
  database: SqlDatabase,
  storage: ObjectStorageAdapter,
  authorization: FileAuthorizationService,
  input: {
    uploadIntentId: string;
    expectedVersion: number;
  },
  command: {
    actor: FileActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<FileUploadVerificationResult> {
  const uploadIntentId = cleanFileIdentifier(input.uploadIntentId, 120);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const intent = await requireIntent(database, uploadIntentId);
  await authorization.assertCanCompleteUpload(command.actor, {
    uploadIntentId,
    fileObjectId: null,
    ownerActorType: intent.owner_actor_type,
    ownerActorId: intent.owner_actor_id,
    purpose: intent.purpose,
    visibility: intent.visibility,
    entityType: null,
    entityId: null,
  });
  const requestHash = await hashCanonicalJson({
    action: 'COMPLETE_FILE_UPLOAD_INTENT',
    upload_intent_id: uploadIntentId,
    expected_version: input.expectedVersion,
  });
  const acquired = await acquireIdempotency<FileUploadVerificationResult>(
    database,
    {
      actorType: command.actor.type,
      actorId: command.actor.id,
      action: 'COMPLETE_FILE_UPLOAD_INTENT',
      targetType: 'FILE_UPLOAD_INTENT',
      targetId: uploadIntentId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  if (intent.version !== input.expectedVersion) {
    await markIdempotencyFailed(
      database,
      acquired.claim,
      'VERSION_CONFLICT',
      now,
    ).catch(() => false);
    throw new FileStorageError('VERSION_CONFLICT', 409);
  }
  if (intent.status !== 'ISSUED') {
    await markIdempotencyFailed(
      database,
      acquired.claim,
      'FILE_STORAGE_CONFLICT',
      now,
    ).catch(() => false);
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  if (intent.expires_at <= now) {
    await markIdempotencyFailed(
      database,
      acquired.claim,
      'FILE_UPLOAD_EXPIRED',
      now,
    ).catch(() => false);
    throw new FileStorageError('FILE_UPLOAD_EXPIRED', 410);
  }

  const objects = await listIntentObjects(database, intent);
  if (objects.length !== intent.requested_file_count
    || objects.some((object) => object.status !== 'UPLOADED'
      || object.uploaded_byte_size === null
      || object.detected_mime === null
      || object.uploaded_sha256 === null)) {
    await markIdempotencyFailed(
      database,
      acquired.claim,
      'FILE_NOT_VERIFIED',
      now,
    ).catch(() => false);
    throw new FileStorageError('FILE_NOT_VERIFIED', 409);
  }

  const compensatable = objects.map(toCompensatableObject);
  try {
    for (const object of objects) {
      await verifyStoredObject(storage, object);
    }
  } catch (error) {
    const normalized = normalizeFileStorageError(error);
    const plan = await compensateStoredObjects(database, storage, {
      uploadIntentId,
      objects: compensatable,
      reason: 'HEAD_OR_METADATA_VERIFICATION_FAILED',
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
    throw normalized;
  }

  const response: FileUploadVerificationResult = {
    uploadIntentId,
    status: 'VERIFIED',
    version: intent.version + 1,
    files: objects.map((object) => toVerifiedManifest(object)),
    replayed: false,
  };
  const outbox = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: `file-upload-verified:${uploadIntentId}`,
    eventType: 'FILE_UPLOAD_VERIFIED',
    aggregateType: 'FILE_UPLOAD_INTENT',
    aggregateId: uploadIntentId,
    payload: {
      upload_intent_id: uploadIntentId,
      purpose: intent.purpose,
      visibility: intent.visibility,
      file_object_ids: objects.map((object) => object.id),
      file_count: objects.length,
    },
    createdAt: now,
  });

  try {
    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE file_upload_intents
        SET
          status='VERIFIED',
          failure_code=NULL,
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          completed_at=?
        WHERE id=?
          AND status='ISSUED'
          AND version=?
          AND expires_at>?
      `).bind(
        now,
        now,
        uploadIntentId,
        intent.version,
        now,
      ),
      ...objects.map((object) => database.prepare(`
        UPDATE file_objects
        SET
          status='VERIFIED',
          failure_code=NULL,
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          verified_at=?
        WHERE id=?
          AND upload_intent_id=?
          AND status='UPLOADED'
          AND version=?
          AND uploaded_byte_size=?
          AND detected_mime=?
          AND uploaded_sha256=?
      `).bind(
        now,
        now,
        object.id,
        uploadIntentId,
        object.version,
        object.uploaded_byte_size,
        object.detected_mime,
        object.uploaded_sha256,
      )),
      createFileEventStatement(database, {
        uploadIntentId,
        fileObjectId: null,
        eventType: 'FILE_UPLOAD_VERIFIED',
        actorType: command.actor.type,
        actorId: command.actor.id,
        previousStatus: 'ISSUED',
        nextStatus: 'VERIFIED',
        metadata: {
          file_count: objects.length,
          purpose: intent.purpose,
          visibility: intent.visibility,
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'FILE_UPLOAD_INTENT',
        aggregateId: uploadIntentId,
        eventType: 'FILE_UPLOAD_VERIFIED',
        actor: {
          type: command.actor.type,
          id: command.actor.id,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: 'ISSUED',
          version: intent.version,
        },
        nextState: {
          status: 'VERIFIED',
          version: response.version,
          file_count: objects.length,
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            upload_intent_id: uploadIntentId,
            file_object_ids: objects.map((object) => object.id),
          },
          now,
        },
      ),
      assertIntentVerifiedStatement(
        database,
        acquired.claim,
        uploadIntentId,
        response.version,
        objects.length,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeFileStorageError(error);
    const plan = await compensateStoredObjects(database, storage, {
      uploadIntentId,
      objects: compensatable,
      reason: 'VERIFIED_OBJECT_D1_COMMIT_FAILED',
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
    throw new FileStorageError(
      plan.deletePendingObjectIds.length > 0
        ? 'FILE_COMPENSATION_REQUIRED'
        : normalized.code,
      503,
      plan,
    );
  }
}

async function requireIntent(
  database: SqlDatabase,
  uploadIntentId: string,
): Promise<FileIntentRow> {
  const row = await database.prepare(`
    SELECT
      id,
      owner_actor_type,
      owner_actor_id,
      purpose,
      visibility,
      status,
      requested_file_count,
      version,
      expires_at
    FROM file_upload_intents
    WHERE id=?
  `).bind(uploadIntentId).first<FileIntentRow>();
  if (!row) throw new FileStorageError('FILE_INTENT_NOT_FOUND', 404);
  return row;
}

async function listIntentObjects(
  database: SqlDatabase,
  intent: FileIntentRow,
): Promise<FileObjectRow[]> {
  const result = await database.prepare(`
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
    WHERE object.upload_intent_id=?
    ORDER BY object.slot_no
  `).bind(intent.id).all<FileObjectRow>();
  return result.results;
}

async function verifyStoredObject(
  storage: ObjectStorageAdapter,
  object: FileObjectRow,
): Promise<void> {
  if (object.uploaded_byte_size === null
    || object.detected_mime === null
    || object.uploaded_sha256 === null) {
    throw new FileStorageError('FILE_NOT_VERIFIED', 409);
  }
  const head = await storage.headObject(object.object_key);
  if (head === null
    || head.byteSize !== object.uploaded_byte_size
    || head.contentType !== object.detected_mime
    || head.checksumSha256 !== object.uploaded_sha256
    || head.metadata['ygb-file-object-id'] !== object.id
    || head.metadata['ygb-upload-intent-id'] !== object.upload_intent_id) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  const prefix = await storage.readPrefix(object.object_key, 16);
  if (detectSupportedMime(prefix) !== object.detected_mime) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
}

function toCompensatableObject(
  object: FileObjectRow,
): CompensatableObject {
  if (object.uploaded_byte_size === null
    || object.detected_mime === null
    || object.uploaded_sha256 === null) {
    throw new FileStorageError('FILE_NOT_VERIFIED', 409);
  }
  return {
    fileObjectId: object.id,
    objectKey: object.object_key,
    byteSize: object.uploaded_byte_size,
    detectedMime: object.detected_mime,
    sha256: object.uploaded_sha256,
  };
}

function toVerifiedManifest(object: FileObjectRow): FileManifestRecord {
  if (object.uploaded_byte_size === null
    || object.detected_mime === null
    || object.uploaded_sha256 === null) {
    throw new FileStorageError('FILE_NOT_VERIFIED', 409);
  }
  return Object.freeze({
    fileObjectId: object.id,
    uploadIntentId: object.upload_intent_id,
    slotNo: object.slot_no,
    purpose: object.purpose,
    visibility: object.visibility,
    clientFileName: object.client_file_name,
    declaredMime: object.declared_mime,
    detectedMime: object.detected_mime,
    extension: object.extension,
    expectedByteSize: object.expected_byte_size,
    verifiedByteSize: object.uploaded_byte_size,
    sha256: object.uploaded_sha256,
    status: 'VERIFIED',
    version: object.version + 1,
  });
}

function assertIntentVerifiedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  uploadIntentId: string,
  expectedVersion: number,
  expectedCount: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM file_upload_intents
        WHERE id=?
          AND status='VERIFIED'
          AND version=?
      )
      AND (
        SELECT COUNT(*)
        FROM file_objects
        WHERE upload_intent_id=?
          AND status='VERIFIED'
      )=?
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
    uploadIntentId,
    expectedVersion,
    uploadIntentId,
    expectedCount,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
