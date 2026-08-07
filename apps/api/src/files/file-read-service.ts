import type {
  FileActor,
  DriveArchiveAdapter,
  FileLinkAuthorizationMode,
  FileReadIntentResult,
  FileReadPrincipal,
  ObjectStorageAdapter,
  SqlDatabase,
  SqlStatement,
  SupportedFileMime,
} from '@ygb/contracts';
import {
  constantTimeHexEqual,
  detectSupportedMime,
  generateOpaqueFileToken,
  hashCanonicalJson,
  hashOpaqueFileToken,
  sha256Hex,
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
import { authorizeFileRead } from './file-audience-authorization';
import { createFileEventStatement } from './file-events';
import {
  FileStorageError,
  normalizeFileStorageError,
} from './file-error';
import {
  cleanFileIdentifier,
  type FileObjectRow,
} from './file-records';

const DEFAULT_READ_TTL_MS = 5 * 60 * 1000;
const MAXIMUM_READ_TTL_MS = 10 * 60 * 1000;

interface ReadableFileSource extends FileObjectRow {
  file_entity_link_id: string;
  entity_type: 'PRODUCT_APPLICATION'
    | 'PRODUCT_VERSION'
    | 'ORDER_INSTRUCTION_VERSION'
    | 'ORDER'
    | 'ORDER_EVIDENCE_SUBMISSION'
    | 'REVIEW'
    | 'BUYER_REFUND'
    | 'SELLER_SETTLEMENT'
    | 'SUPPORT_CASE';
  entity_id: string;
  authorization_mode: FileLinkAuthorizationMode;
  link_expires_at: number | null;
  link_revoked_at: number | null;
  archive_status: string | null;
  drive_file_id: string | null;
  archive_byte_size: number | null;
  archive_mime_type: SupportedFileMime | null;
  archive_sha256: string | null;
}

interface ReadIntentRow extends ReadableFileSource {
  read_intent_id: string;
  read_actor_type: string;
  read_actor_id: string;
  token_hash: string;
  read_status: string;
  read_expires_at: number;
}

export async function createFileReadIntent(
  database: SqlDatabase,
  authorization: FileAuthorizationService,
  input: {
    fileObjectId: string;
    fileEntityLinkId?: string;
    expectedFileVersion: number;
    ttlMs?: number;
  },
  command: {
    actor: FileActor;
    principal?: FileReadPrincipal;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<FileReadIntentResult> {
  const fileObjectId = cleanFileIdentifier(input.fileObjectId, 120);
  const now = command.now ?? Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_READ_TTL_MS;
  validateReadTiming(now, ttlMs);
  if (!Number.isSafeInteger(input.expectedFileVersion)
    || input.expectedFileVersion < 1) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }

  const fileEntityLinkId = input.fileEntityLinkId === undefined
    ? null
    : cleanFileIdentifier(input.fileEntityLinkId, 120);
  const source = await requireReadableFile(
    database,
    fileObjectId,
    fileEntityLinkId,
  );
  if (source.version !== input.expectedFileVersion) {
    throw new FileStorageError('VERSION_CONFLICT', 409);
  }
  await authorizeFileRead(
    database,
    authorization,
    command.actor,
    command.principal,
    resource(source),
    now,
  );
  await requireDynamicInstructionReadAuthorization(
    database,
    source,
    command.actor,
    now,
  );
  const expiresAt = now + ttlMs;
  const requestHash = await hashCanonicalJson({
    action: 'CREATE_FILE_READ_INTENT',
    file_object_id: fileObjectId,
    file_entity_link_id: source.file_entity_link_id,
    expected_file_version: input.expectedFileVersion,
    ttl_ms: ttlMs,
  });
  const acquired = await acquireIdempotency<FileReadIntentResult>(
    database,
    {
      actorType: command.actor.type,
      actorId: command.actor.id,
      action: 'CREATE_FILE_READ_INTENT',
      targetType: 'FILE_OBJECT',
      targetId: fileObjectId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return {
      ...acquired.response,
      accessToken: null,
      accessTokenAvailable: false,
      replayed: true,
    };
  }

  try {
    const readIntentId = crypto.randomUUID();
    const token = generateOpaqueFileToken();
    const tokenHash = await hashOpaqueFileToken(token);
    const firstResponse: FileReadIntentResult = {
      readIntentId,
      fileObjectId,
      accessToken: token,
      accessTokenAvailable: true,
      expiresAt,
      replayed: false,
    };
    const storedResponse: FileReadIntentResult = {
      ...firstResponse,
      accessToken: null,
      accessTokenAvailable: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `file-read-intent-issued:${readIntentId}`,
      eventType: 'FILE_READ_INTENT_ISSUED',
      aggregateType: 'FILE_OBJECT',
      aggregateId: fileObjectId,
      payload: {
        read_intent_id: readIntentId,
        file_object_id: fileObjectId,
        entity_type: source.entity_type,
        entity_id: source.entity_id,
        expires_at: expiresAt,
      },
      createdAt: now,
    });

    await database.batch([
      database.prepare(`
        INSERT INTO file_read_intents (
          id,
          file_object_id,
          actor_type,
          actor_id,
          token_hash,
          status,
          use_count,
          expires_at,
          created_at,
          updated_at,
          consumed_at,
          revoked_at,
          file_entity_link_id
        ) VALUES (?, ?, ?, ?, ?, 'ISSUED', 0, ?, ?, ?, NULL, NULL, ?)
      `).bind(
        readIntentId,
        fileObjectId,
        command.actor.type,
        command.actor.id,
        tokenHash,
        expiresAt,
        now,
        now,
        source.file_entity_link_id,
      ),
      createFileEventStatement(database, {
        uploadIntentId: source.upload_intent_id,
        fileObjectId,
        eventType: 'FILE_READ_INTENT_ISSUED',
        actorType: command.actor.type,
        actorId: command.actor.id,
        previousStatus: 'VERIFIED',
        nextStatus: 'VERIFIED',
        metadata: {
          read_intent_id: readIntentId,
          expires_at: expiresAt,
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'FILE_OBJECT',
        aggregateId: fileObjectId,
        eventType: 'FILE_READ_INTENT_ISSUED',
        actor: {
          type: command.actor.type,
          id: command.actor.id,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: {
          read_intent_id: readIntentId,
          expires_at: expiresAt,
          entity_type: source.entity_type,
          entity_id: source.entity_id,
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        storedResponse,
        {
          resultReferences: {
            read_intent_id: readIntentId,
            file_object_id: fileObjectId,
          },
          now,
        },
      ),
      assertReadIntentCreatedStatement(
        database,
        acquired.claim,
        readIntentId,
        fileObjectId,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
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

export async function consumeFileReadIntent(
  database: SqlDatabase,
  storage: ObjectStorageAdapter,
  authorization: FileAuthorizationService,
  input: {
    readIntentId: string;
    accessToken: string;
  },
  command: {
    actor: FileActor;
    principal?: FileReadPrincipal;
    now?: number;
  },
  coldArchive?: {
    adapter: DriveArchiveAdapter | null;
    proxyReadEnabled: boolean;
  },
): Promise<{
  fileObjectId: string;
  contentType: SupportedFileMime;
  bytes: Uint8Array<ArrayBuffer>;
}> {
  const readIntentId = cleanFileIdentifier(input.readIntentId, 120);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const source = await requireReadIntent(database, readIntentId);
  if (source.read_actor_type !== command.actor.type
    || source.read_actor_id !== command.actor.id) {
    throw new FileStorageError('FORBIDDEN', 403);
  }
  if (source.read_status !== 'ISSUED'
    || source.read_expires_at <= now) {
    throw new FileStorageError('FILE_UPLOAD_EXPIRED', 410);
  }
  const tokenHash = await hashOpaqueFileToken(input.accessToken)
    .catch(() => '');
  if (!constantTimeHexEqual(tokenHash, source.token_hash)) {
    throw new FileStorageError('FORBIDDEN', 403);
  }
  await authorizeFileRead(
    database,
    authorization,
    command.actor,
    command.principal,
    resource(source),
    now,
  );
  await requireDynamicInstructionReadAuthorization(
    database,
    source,
    command.actor,
    now,
  );

  const archived = source.archive_status === 'DRIVE_ARCHIVED';
  const bytes = archived
    ? await readArchivedBytes(source, coldArchive)
    : await storage.readObject(source.object_key).catch(() => {
        throw new FileStorageError('DEPENDENCY_UNAVAILABLE', 503);
      });
  if (source.uploaded_byte_size === null
    || source.detected_mime === null
    || source.uploaded_sha256 === null
    || bytes.byteLength !== source.uploaded_byte_size
    || detectSupportedMime(bytes) !== source.detected_mime
    || await sha256Hex(bytes) !== source.uploaded_sha256) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }

  await database.batch([
    database.prepare(`
      UPDATE file_read_intents
      SET
        status='CONSUMED',
        use_count=1,
        updated_at=MAX(?, updated_at+1),
        consumed_at=?
      WHERE id=?
        AND file_object_id=?
        AND actor_type=?
        AND actor_id=?
        AND status='ISSUED'
        AND use_count=0
        AND expires_at>?
    `).bind(
      now,
      now,
      readIntentId,
      source.id,
      command.actor.type,
      command.actor.id,
      now,
    ),
    createFileEventStatement(database, {
      uploadIntentId: source.upload_intent_id,
      fileObjectId: source.id,
      eventType: 'FILE_READ_INTENT_CONSUMED',
      actorType: command.actor.type,
      actorId: command.actor.id,
      previousStatus: 'ISSUED',
      nextStatus: 'CONSUMED',
      metadata: { read_intent_id: readIntentId },
      idempotencyKey: null,
      createdAt: now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM file_read_intents
        WHERE id=?
          AND status='CONSUMED'
          AND use_count=1
          AND consumed_at IS NOT NULL
      ) THEN 1 ELSE 0 END
    `).bind(readIntentId),
  ]);

  return {
    fileObjectId: source.id,
    contentType: source.detected_mime,
    bytes,
  };
}

async function requireReadableFile(
  database: SqlDatabase,
  fileObjectId: string,
  fileEntityLinkId: string | null,
): Promise<ReadableFileSource> {
  const row = await database.prepare(`
    SELECT
      object.*,
      intent.owner_actor_type,
      intent.owner_actor_id,
      intent.status AS intent_status,
      intent.version AS intent_version,
      intent.expires_at AS intent_expires_at,
      link.id AS file_entity_link_id,
      link.entity_type,
      link.entity_id,
      link.authorization_mode,
      link.expires_at AS link_expires_at,
      link.revoked_at AS link_revoked_at
      ,archive.status AS archive_status
      ,archive.drive_file_id
      ,manifest.byte_size AS archive_byte_size
      ,manifest.mime_type AS archive_mime_type
      ,manifest.sha256 AS archive_sha256
    FROM file_objects object
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
    JOIN file_entity_links link
      ON link.file_object_id=object.id
    LEFT JOIN file_drive_archives archive ON archive.file_object_id=object.id
    LEFT JOIN file_drive_archive_manifests manifest ON manifest.file_object_id=object.id
    WHERE object.id=?
      AND object.status='VERIFIED'
      AND intent.status='VERIFIED'
      AND (
        (? IS NOT NULL AND link.id=?)
        OR
        (? IS NULL AND link.authorization_mode='LEGACY_VISIBILITY')
      )
    ORDER BY link.created_at, link.id
    LIMIT 1
  `).bind(
    fileObjectId,
    fileEntityLinkId,
    fileEntityLinkId,
    fileEntityLinkId,
  ).first<ReadableFileSource>();
  if (!row) throw new FileStorageError('FILE_NOT_VERIFIED', 409);
  return row;
}

async function requireReadIntent(
  database: SqlDatabase,
  readIntentId: string,
): Promise<ReadIntentRow> {
  const row = await database.prepare(`
    SELECT
      object.*,
      intent.owner_actor_type,
      intent.owner_actor_id,
      intent.status AS intent_status,
      intent.version AS intent_version,
      intent.expires_at AS intent_expires_at,
      link.id AS file_entity_link_id,
      link.entity_type,
      link.entity_id,
      link.authorization_mode,
      link.expires_at AS link_expires_at,
      link.revoked_at AS link_revoked_at,
      read.id AS read_intent_id,
      read.actor_type AS read_actor_type,
      read.actor_id AS read_actor_id,
      read.token_hash,
      read.status AS read_status,
      read.expires_at AS read_expires_at
      ,archive.status AS archive_status
      ,archive.drive_file_id
      ,manifest.byte_size AS archive_byte_size
      ,manifest.mime_type AS archive_mime_type
      ,manifest.sha256 AS archive_sha256
    FROM file_read_intents read
    JOIN file_objects object
      ON object.id=read.file_object_id
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
    JOIN file_entity_links link
      ON link.file_object_id=object.id
      AND (
        (read.file_entity_link_id IS NOT NULL
          AND link.id=read.file_entity_link_id)
        OR
        (read.file_entity_link_id IS NULL
          AND link.authorization_mode='LEGACY_VISIBILITY')
      )
    LEFT JOIN file_drive_archives archive ON archive.file_object_id=object.id
    LEFT JOIN file_drive_archive_manifests manifest ON manifest.file_object_id=object.id
    WHERE read.id=?
      AND object.status='VERIFIED'
      AND intent.status='VERIFIED'
    ORDER BY link.created_at, link.id
    LIMIT 1
  `).bind(readIntentId).first<ReadIntentRow>();
  if (!row) {
    throw new FileStorageError('FILE_READ_INTENT_NOT_FOUND', 404);
  }
  return row;
}

async function readArchivedBytes(
  source: ReadIntentRow,
  coldArchive: {adapter:DriveArchiveAdapter|null;proxyReadEnabled:boolean}|undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!coldArchive?.proxyReadEnabled || !coldArchive.adapter
    || !source.drive_file_id || source.archive_byte_size === null
    || source.archive_mime_type === null || source.archive_sha256 === null) {
    throw new FileStorageError('DEPENDENCY_UNAVAILABLE',503);
  }
  if (source.uploaded_byte_size === null
    || source.detected_mime === null
    || source.uploaded_sha256 === null
    || source.uploaded_byte_size !== source.archive_byte_size
    || source.detected_mime !== source.archive_mime_type
    || source.uploaded_sha256 !== source.archive_sha256) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT',409);
  }
  const result=await coldArchive.adapter.readFile(source.drive_file_id).catch(()=>{
    throw new FileStorageError('DEPENDENCY_UNAVAILABLE',503);
  });
  if (result.byteSize!==source.archive_byte_size
    || result.mimeType!==source.archive_mime_type
    || result.bytes.byteLength!==source.uploaded_byte_size
    || detectSupportedMime(result.bytes)!==source.detected_mime
    || await sha256Hex(result.bytes)!==source.archive_sha256) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT',409);
  }
  return result.bytes;
}

function resource(source: ReadableFileSource) {
  return {
    uploadIntentId: source.upload_intent_id,
    fileObjectId: source.id,
    ownerActorType: source.owner_actor_type,
    ownerActorId: source.owner_actor_id,
    purpose: source.purpose,
    visibility: source.visibility,
    entityType: source.entity_type,
    entityId: source.entity_id,
    fileEntityLinkId: source.file_entity_link_id,
    linkAuthorizationMode: source.authorization_mode,
    linkExpiresAt: source.link_expires_at,
    linkRevokedAt: source.link_revoked_at,
  } as const;
}

function assertReadIntentCreatedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  readIntentId: string,
  fileObjectId: string,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM file_read_intents
        WHERE id=?
          AND file_object_id=?
          AND status='ISSUED'
          AND use_count=0
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
    readIntentId,
    fileObjectId,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}

function validateReadTiming(now: number, ttlMs: number): void {
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(ttlMs)
    || ttlMs < 30_000
    || ttlMs > MAXIMUM_READ_TTL_MS
    || now + ttlMs > Number.MAX_SAFE_INTEGER) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
}

async function requireDynamicInstructionReadAuthorization(
  database: SqlDatabase,
  source: ReadableFileSource,
  actor: FileActor,
  now: number,
): Promise<void> {
  if (source.entity_type !== 'ORDER_INSTRUCTION_VERSION'
    || actor.type !== 'BUYER_CUSTOMER') {
    return;
  }
  const row = await database.prepare(`
    SELECT
      instruction.status AS instruction_status,
      instruction.current_version_no,
      instruction.initial_deadline_at,
      instruction.resubmission_deadline_at,
      version.version_no,
      evidence.status AS evidence_status,
      formal_order.id AS formal_order_id
    FROM order_instruction_versions version
    JOIN order_instructions instruction
      ON instruction.id=version.instruction_id
      AND instruction.buyer_customer_id=?
    LEFT JOIN order_evidence_submissions evidence
      ON evidence.reservation_id=instruction.reservation_id
    LEFT JOIN formal_orders formal_order
      ON formal_order.reservation_id=instruction.reservation_id
    WHERE version.id=?
  `).bind(actor.id, source.entity_id).first<{
    instruction_status: string;
    current_version_no: number;
    initial_deadline_at: number | null;
    resubmission_deadline_at: number | null;
    version_no: number;
    evidence_status: string | null;
    formal_order_id: string | null;
  }>();
  const current = row !== null
    && row.instruction_status === 'ACTIVE'
    && Number(row.current_version_no) === Number(row.version_no)
    && row.formal_order_id === null;
  const readable = current && (
    (row.evidence_status === null
      && row.initial_deadline_at !== null
      && now < row.initial_deadline_at)
    || row.evidence_status === 'PENDING_VERIFICATION'
    || row.evidence_status === 'VERIFIED'
    || (row.evidence_status === 'CHANGES_REQUESTED'
      && row.resubmission_deadline_at !== null
      && now < row.resubmission_deadline_at)
  );
  if (!readable) {
    throw new FileStorageError('FORBIDDEN', 403);
  }
}
