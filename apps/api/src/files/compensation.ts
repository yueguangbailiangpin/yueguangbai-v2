import type {
  FileActor,
  ObjectStorageAdapter,
  SqlDatabase,
  SupportedFileMime,
} from '@ygb/contracts';
import { createFileEventStatement } from './file-events';
import type { FileCompensationPlan } from './file-error';

export interface CompensatableObject {
  fileObjectId: string;
  objectKey: string;
  byteSize: number;
  detectedMime: SupportedFileMime;
  sha256: string;
}

export async function compensateStoredObjects(
  database: SqlDatabase,
  storage: ObjectStorageAdapter,
  input: {
    uploadIntentId: string;
    objects: readonly CompensatableObject[];
    reason: string;
    actor: FileActor;
    idempotencyKey: string | null;
    now: number;
  },
): Promise<FileCompensationPlan> {
  const deletedIds: string[] = [];
  const pendingIds: string[] = [];

  for (const object of input.objects) {
    try {
      await storage.deleteObject(object.objectKey);
      deletedIds.push(object.fileObjectId);
    } catch {
      pendingIds.push(object.fileObjectId);
    }
  }

  const statements = input.objects.map((object) => {
    const pending = pendingIds.includes(object.fileObjectId);
    return database.prepare(`
      UPDATE file_objects
      SET
        status=?,
        uploaded_byte_size=?,
        detected_mime=?,
        uploaded_sha256=?,
        failure_code=?,
        delete_attempt_count=delete_attempt_count+1,
        next_delete_at=?,
        version=version+1,
        updated_at=MAX(?, updated_at+1),
        uploaded_at=COALESCE(uploaded_at, ?),
        verified_at=NULL,
        deleted_at=?
      WHERE id=?
        AND upload_intent_id=?
        AND status<>'DELETED'
    `).bind(
      pending ? 'DELETION_PENDING' : 'DELETED',
      object.byteSize,
      object.detectedMime,
      object.sha256,
      input.reason,
      pending ? input.now + 5 * 60 * 1000 : null,
      input.now,
      input.now,
      pending ? null : input.now,
      object.fileObjectId,
      input.uploadIntentId,
    );
  });

  try {
    await database.batch([
      ...statements,
      database.prepare(`
        UPDATE file_upload_intents
        SET
          status='FAILED',
          failure_code=?,
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          completed_at=?
        WHERE id=?
          AND status IN ('ISSUED', 'VERIFYING')
      `).bind(
        input.reason,
        input.now,
        input.now,
        input.uploadIntentId,
      ),
      createFileEventStatement(database, {
        uploadIntentId: input.uploadIntentId,
        fileObjectId: null,
        eventType: pendingIds.length > 0
          ? 'FILE_COMPENSATION_SCHEDULED'
          : 'FILE_UPLOAD_FAILED',
        actorType: input.actor.type,
        actorId: input.actor.id,
        previousStatus: 'ISSUED',
        nextStatus: 'FAILED',
        metadata: {
          reason: input.reason,
          deleted_count: deletedIds.length,
          delete_pending_count: pendingIds.length,
        },
        idempotencyKey: input.idempotencyKey,
        createdAt: input.now,
      }),
    ]);
  } catch {
    // The returned plan is deliberately independent of the database write.
    // A caller or cleanup worker can retry by object id without a signed URL.
  }

  return Object.freeze({
    uploadIntentId: input.uploadIntentId,
    objectIds: Object.freeze(input.objects.map(
      (object) => object.fileObjectId,
    )),
    deletePendingObjectIds: Object.freeze(pendingIds),
    reason: input.reason,
  });
}
