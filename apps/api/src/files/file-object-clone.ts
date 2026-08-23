import type {
  ObjectStorageAdapter,
  SqlDatabase,
  SqlStatement,
  SupportedFileMime,
} from '@ygb/contracts';
import {
  generateFileObjectKey,
  hashCanonicalJson,
} from '@ygb/domain';
import { createFileEventStatement } from './file-events';
import { FileStorageError } from './file-error';
import { cleanFileIdentifier } from './file-records';

/**
 * A verified file object that can serve as the byte source of a clone.
 * Cloning is the only sanctioned way to make one upload serve two facts,
 * because file objects are single-entity by design (unique object key,
 * purpose-scoped links, immutable product-image bindings).
 */
export interface VerifiedFileObjectSource {
  file_object_id: string;
  upload_intent_id: string;
  purpose: string;
  object_key: string;
  client_file_name: string;
  extension: string;
  declared_mime: SupportedFileMime;
  uploaded_byte_size: number;
  detected_mime: SupportedFileMime;
  uploaded_sha256: string;
  object_version: number;
}

interface FileObjectRow extends VerifiedFileObjectSource {
  purpose: string;
  visibility: string;
  status: string;
  intent_status: string;
}

export async function readVerifiedFileObject(
  database: SqlDatabase,
  fileObjectId: string,
): Promise<VerifiedFileObjectSource> {
  const cleaned = cleanFileIdentifier(fileObjectId, 120);
  const row = await database.prepare(`
    SELECT
      object.id AS file_object_id,
      object.upload_intent_id,
      object.object_key,
      object.client_file_name,
      object.extension,
      object.declared_mime,
      object.uploaded_byte_size,
      object.detected_mime,
      object.uploaded_sha256,
      object.version AS object_version,
      object.purpose,
      object.visibility,
      object.status,
      intent.status AS intent_status
    FROM file_objects object
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
    WHERE object.id=?
  `).bind(cleaned).first<FileObjectRow>();
  if (!row) {
    throw new FileStorageError('FILE_OBJECT_NOT_FOUND', 404);
  }
  if (row.status !== 'VERIFIED' || row.intent_status !== 'VERIFIED') {
    throw new FileStorageError('FILE_NOT_VERIFIED', 409);
  }
  return {
    file_object_id: row.file_object_id,
    upload_intent_id: row.upload_intent_id,
    purpose: row.purpose,
    object_key: row.object_key,
    client_file_name: row.client_file_name,
    extension: row.extension,
    declared_mime: row.declared_mime as SupportedFileMime,
    uploaded_byte_size: Number(row.uploaded_byte_size),
    detected_mime: row.detected_mime as SupportedFileMime,
    uploaded_sha256: row.uploaded_sha256,
    object_version: Number(row.object_version),
  };
}

export interface PreparedFileObjectClone {
  cloneIntentId: string;
  cloneFileObjectId: string;
  cloneObjectKey: string;
  statements: readonly SqlStatement[];
}

const CLONE_INTENT_TTL_MS = 10 * 60_000;

/**
 * Copies the source bytes to a fresh object key in R2, then returns the
 * D1 statements that materialize a brand-new VERIFIED file object for the
 * clone. Statements must run in one batch, in the returned order: the
 * object insert trigger requires the intent to still be ISSUED, and the
 * object verification trigger requires the intent update to have landed
 * first.
 */
export async function prepareFileObjectClone(
  database: SqlDatabase,
  storage: ObjectStorageAdapter,
  source: VerifiedFileObjectSource,
  input: {
    ownerActorType: 'STAFF' | 'SYSTEM';
    ownerActorId: string;
    idempotencyKey: string | null;
    now: number;
    purpose?: 'PRODUCT_IMAGE' | 'ORDER_EVIDENCE';
  },
): Promise<PreparedFileObjectClone> {
  const clonePurpose = input.purpose ?? 'PRODUCT_IMAGE';
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const bytes = await storage.readObject(source.object_key);
  const cloneObjectKey = generateFileObjectKey(
    clonePurpose,
    input.now,
  );
  const put = await storage.putObject({
    objectKey: cloneObjectKey,
    bytes,
    contentType: source.detected_mime,
    metadata: {
      cloned_from_file_object_id: source.file_object_id,
    },
  });
  if (put.checksumSha256 !== source.uploaded_sha256
    || put.byteSize !== bytes.byteLength) {
    await storage.deleteObject(cloneObjectKey).catch(() => undefined);
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }

  const cloneIntentId = crypto.randomUUID();
  const cloneFileObjectId = crypto.randomUUID();
  const intentExpiresAt = input.now + CLONE_INTENT_TTL_MS;
  const manifestHash = await hashCanonicalJson({
    action: 'FILE_OBJECT_CLONE',
    source_file_object_id: source.file_object_id,
    clone_object_key: cloneObjectKey,
    uploaded_sha256: source.uploaded_sha256,
    uploaded_byte_size: bytes.byteLength,
  });
  const uploadTokenHash = await hashCanonicalJson({
    action: 'FILE_OBJECT_CLONE_UPLOAD_TOKEN',
    clone_file_object_id: cloneFileObjectId,
    entropy: crypto.randomUUID(),
  });

  const statements: SqlStatement[] = [
    database.prepare(`
      INSERT INTO file_upload_intents (
        id, owner_actor_type, owner_actor_id, purpose, visibility, status,
        requested_file_count, manifest_hash, version, expires_at, failure_code,
        created_at, updated_at, completed_at
      ) VALUES (
        ?, ?, ?, ?, 'SELLER_VISIBLE', 'ISSUED',
        1, ?, 1, ?, NULL, ?, ?, NULL
      )
    `).bind(
      cloneIntentId,
      input.ownerActorType,
      input.ownerActorId,
      clonePurpose,
      manifestHash,
      intentExpiresAt,
      input.now,
      input.now,
    ),
    database.prepare(`
      INSERT INTO file_objects (
        id, upload_intent_id, slot_no, purpose, visibility, object_key,
        client_file_name, extension, declared_mime, expected_byte_size, status,
        upload_token_hash, upload_expires_at, uploaded_byte_size, detected_mime,
        uploaded_sha256, failure_code, version, created_at, updated_at,
        uploaded_at, verified_at, deleted_at
      ) VALUES (
        ?, ?, 1, ?, 'SELLER_VISIBLE', ?,
        ?, ?, ?, ?, 'RESERVED',
        ?, ?, NULL, NULL,
        NULL, NULL, 1, ?, ?, NULL, NULL, NULL
      )
    `).bind(
      cloneFileObjectId,
      cloneIntentId,
      clonePurpose,
      cloneObjectKey,
      source.client_file_name,
      source.extension,
      source.declared_mime,
      bytes.byteLength,
      uploadTokenHash,
      intentExpiresAt,
      input.now,
      input.now,
    ),
    database.prepare(`
      UPDATE file_upload_intents
      SET status='VERIFIED', completed_at=?, updated_at=?
      WHERE id=? AND status='ISSUED'
    `).bind(input.now, input.now, cloneIntentId),
    database.prepare(`
      UPDATE file_objects
      SET
        status='VERIFIED',
        uploaded_byte_size=?,
        detected_mime=?,
        uploaded_sha256=?,
        uploaded_at=?,
        verified_at=?,
        updated_at=?
      WHERE id=? AND status='RESERVED'
    `).bind(
      bytes.byteLength,
      source.detected_mime,
      source.uploaded_sha256,
      input.now,
      input.now,
      input.now,
      cloneFileObjectId,
    ),
    createFileEventStatement(database, {
      uploadIntentId: cloneIntentId,
      fileObjectId: cloneFileObjectId,
      eventType: 'FILE_UPLOAD_VERIFIED',
      actorType: input.ownerActorType,
      actorId: input.ownerActorId,
      previousStatus: 'RESERVED',
      nextStatus: 'VERIFIED',
      metadata: {
        cloned_from_file_object_id: source.file_object_id,
        clone_reason: 'product main image bridge',
      },
      idempotencyKey: input.idempotencyKey,
      createdAt: input.now,
    }),
  ];

  return {
    cloneIntentId,
    cloneFileObjectId,
    cloneObjectKey,
    statements: Object.freeze(statements),
  };
}
