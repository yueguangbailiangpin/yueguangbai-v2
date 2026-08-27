import type {
  FileActor,
  FilePurpose,
  FileUploadDescriptor,
  FileUploadIntentResult,
  FileVisibility,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  generateFileObjectKey,
  generateOpaqueFileToken,
  hashCanonicalJson,
  hashOpaqueFileToken,
  validateUploadManifest,
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

const DEFAULT_UPLOAD_TTL_MS = 15 * 60 * 1000;
const MAXIMUM_UPLOAD_TTL_MS = 60 * 60 * 1000;

interface PreparedSlot {
  fileObjectId: string;
  slotNo: number;
  objectKey: string;
  uploadToken: string;
  uploadTokenHash: string;
  descriptor: ReturnType<typeof validateUploadManifest>[number];
}

export async function createFileUploadIntent(
  database: SqlDatabase,
  authorization: FileAuthorizationService,
  input: {
    purpose: FilePurpose;
    visibility: FileVisibility;
    files: readonly FileUploadDescriptor[];
    ttlMs?: number;
  },
  command: {
    actor: FileActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<FileUploadIntentResult> {
  await authorization.assertCanCreateUpload(command.actor, {
    purpose: input.purpose,
    visibility: input.visibility,
  });
  const files = validateUploadManifest(input.purpose, input.files);
  const now = command.now ?? Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_UPLOAD_TTL_MS;
  validateTiming(now, ttlMs);
  const expiresAt = now + ttlMs;
  const manifestHash = await hashCanonicalJson({
    purpose: input.purpose,
    visibility: input.visibility,
    files,
  });
  const requestHash = await hashCanonicalJson({
    action: 'CREATE_FILE_UPLOAD_INTENT',
    purpose: input.purpose,
    visibility: input.visibility,
    files,
    ttl_ms: ttlMs,
  });
  const idempotencyTarget = `file-intent:${requestHash.slice(0, 32)}`;
  const acquired = await acquireIdempotency<FileUploadIntentResult>(
    database,
    {
      actorType: command.actor.type,
      actorId: command.actor.id,
      action: 'CREATE_FILE_UPLOAD_INTENT',
      targetType: 'FILE_UPLOAD_INTENT',
      targetId: idempotencyTarget,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );

  if (acquired.kind === 'REPLAY') {
    return {
      ...acquired.response,
      uploads: acquired.response.uploads.map((slot) => ({
        ...slot,
        uploadToken: null,
        uploadTokenAvailable: false,
      })),
      replayed: true,
    };
  }

  try {
    const uploadIntentId = crypto.randomUUID();
    const slots = await Promise.all(files.map(async (descriptor, index) => {
      const uploadToken = generateOpaqueFileToken();
      return {
        fileObjectId: crypto.randomUUID(),
        slotNo: index + 1,
        objectKey: generateFileObjectKey(input.purpose, now),
        uploadToken,
        uploadTokenHash: await hashOpaqueFileToken(uploadToken),
        descriptor,
      } satisfies PreparedSlot;
    }));

    const firstResponse: FileUploadIntentResult = {
      uploadIntentId,
      purpose: input.purpose,
      visibility: input.visibility,
      status: 'ISSUED',
      version: 1,
      expiresAt,
      uploads: slots.map((slot) => ({
        fileObjectId: slot.fileObjectId,
        slotNo: slot.slotNo,
        uploadToken: slot.uploadToken,
        uploadTokenAvailable: true,
        expiresAt,
      })),
      replayed: false,
    };
    const storedResponse: FileUploadIntentResult = {
      ...firstResponse,
      uploads: firstResponse.uploads.map((slot) => ({
        ...slot,
        uploadToken: null,
        uploadTokenAvailable: false,
      })),
    };

    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO file_upload_intents (
          id,
          owner_actor_type,
          owner_actor_id,
          purpose,
          visibility,
          status,
          requested_file_count,
          manifest_hash,
          version,
          expires_at,
          failure_code,
          created_at,
          updated_at,
          completed_at
        ) VALUES (
          ?, ?, ?, ?, ?, 'ISSUED', ?, ?, 1, ?, NULL, ?, ?, NULL
        )
      `).bind(
        uploadIntentId,
        command.actor.type,
        command.actor.id,
        input.purpose,
        input.visibility,
        slots.length,
        manifestHash,
        expiresAt,
        now,
        now,
      ),
      ...slots.map((slot) => database.prepare(`
        INSERT INTO file_objects (
          id,
          upload_intent_id,
          slot_no,
          purpose,
          visibility,
          object_key,
          client_file_name,
          extension,
          declared_mime,
          expected_byte_size,
          status,
          upload_token_hash,
          upload_expires_at,
          uploaded_byte_size,
          detected_mime,
          uploaded_sha256,
          failure_code,
          delete_attempt_count,
          next_delete_at,
          version,
          created_at,
          updated_at,
          uploaded_at,
          verified_at,
          deleted_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?,
          NULL, NULL, NULL, NULL, 0, NULL, 1, ?, ?, NULL, NULL, NULL
        )
      `).bind(
        slot.fileObjectId,
        uploadIntentId,
        slot.slotNo,
        input.purpose,
        input.visibility,
        slot.objectKey,
        slot.descriptor.clientFileName,
        slot.descriptor.extension,
        slot.descriptor.declaredMime,
        slot.descriptor.byteSize,
        slot.uploadTokenHash,
        expiresAt,
        now,
        now,
      )),
      createFileEventStatement(database, {
        uploadIntentId,
        fileObjectId: null,
        eventType: 'UPLOAD_INTENT_ISSUED',
        actorType: command.actor.type,
        actorId: command.actor.id,
        previousStatus: null,
        nextStatus: 'ISSUED',
        metadata: {
          purpose: input.purpose,
          visibility: input.visibility,
          file_count: slots.length,
          expires_at: expiresAt,
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'FILE_UPLOAD_INTENT',
        aggregateId: uploadIntentId,
        eventType: 'FILE_UPLOAD_INTENT_ISSUED',
        actor: {
          type: command.actor.type,
          id: command.actor.id,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: {
          status: 'ISSUED',
          purpose: input.purpose,
          visibility: input.visibility,
          file_count: slots.length,
          expires_at: expiresAt,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        storedResponse,
        {
          resultReferences: {
            upload_intent_id: uploadIntentId,
            file_object_ids: slots.map((slot) => slot.fileObjectId),
          },
          now,
        },
      ),
      assertIntentCreatedStatement(
        database,
        acquired.claim,
        uploadIntentId,
        slots.length,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];

    await database.batch(statements);
    return firstResponse;
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

function assertIntentCreatedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  uploadIntentId: string,
  expectedCount: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM file_upload_intents
        WHERE id=?
          AND status='ISSUED'
          AND version=1
          AND requested_file_count=?
      )
      AND (
        SELECT COUNT(*)
        FROM file_objects
        WHERE upload_intent_id=?
          AND status='RESERVED'
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
    expectedCount,
    uploadIntentId,
    expectedCount,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}

function validateTiming(now: number, ttlMs: number): void {
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(ttlMs)
    || ttlMs < 60_000
    || ttlMs > MAXIMUM_UPLOAD_TTL_MS
    || now + ttlMs > Number.MAX_SAFE_INTEGER) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
}
