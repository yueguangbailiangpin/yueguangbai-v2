import type {
  FileActor,
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
  type IdempotencyClaim,
} from '../foundation/idempotency';
import {
  createOutboxStatements,
  prepareOutboxEvent,
  type PreparedOutboxEvent,
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
  /** >0 once an archive bundle deleted this file's R2 hot copy. */
  hot_deleted: number;
  /** Temp restore object key while an unexpired staff restore covers the file. */
  temp_restore_key: string | null;
  temp_restore_size: number | null;
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
    now,
  );
  await authorizeFileRead(
    database,
    authorization,
    command.actor,
    command.principal,
    resource(source),
    now,
  );
  if (source.hot_deleted > 0 && !source.temp_restore_key) {
    // Archived placeholder (D-055): the hot copy is gone and no staff restore
    // is active. Every audience — including Staff — sees the same 410 with a
    // contact hint; no Drive identifiers ever leave the server.
    throw new FileStorageError('FILE_ARCHIVED', 410);
  }
  await requireDynamicInstructionReadAuthorization(
    database,
    source,
    command.actor,
    now,
  );
  if (source.version !== input.expectedFileVersion) {
    throw new FileStorageError('VERSION_CONFLICT', 409);
  }
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

    await database.batch(
      buildReadIntentStatements(database, {
        claim: acquired.claim,
        source,
        fileObjectId,
        readIntentId,
        tokenHash,
        expiresAt,
        firstResponse,
        storedResponse,
        outbox,
      }, command, now),
    );
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

interface ReadIntentPreparation {
  claim: IdempotencyClaim;
  source: ReadableFileSource;
  fileObjectId: string;
  readIntentId: string;
  tokenHash: string;
  expiresAt: number;
  firstResponse: FileReadIntentResult;
  storedResponse: FileReadIntentResult;
  outbox: PreparedOutboxEvent;
}

function buildReadIntentStatements(
  database: SqlDatabase,
  preparation: ReadIntentPreparation,
  command: {
    actor: FileActor;
    requestId?: string | null;
  },
  now: number,
): readonly SqlStatement[] {
  const {
    claim, source, fileObjectId, readIntentId, tokenHash, expiresAt,
    firstResponse, storedResponse, outbox,
  } = preparation;
  void firstResponse;
  return [
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
      idempotencyKey: claim.idempotencyKey,
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
      idempotencyKey: claim.idempotencyKey,
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
      claim,
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
      claim,
      readIntentId,
      fileObjectId,
    ),
    assertIdempotencyCompletionStatement(database, claim),
  ];
}

export interface BatchFileReadIntentResult {
  intents: readonly FileReadIntentResult[];
}

/**
 * Issues read intents for several files in ONE D1 batch — the list screens
 * otherwise pay a multi-statement batch per image. Same per-file checks and
 * the same idempotency semantics as createFileReadIntent; any failing item
 * fails the whole request (all-or-nothing), and every acquired claim is
 * marked failed on error.
 */
export async function createFileReadIntentsBatch(
  database: SqlDatabase,
  authorization: FileAuthorizationService,
  input: {
    requests: readonly {
      fileObjectId: string;
      expectedFileVersion: number;
    }[];
    idempotencyKeys: readonly string[];
  },
  command: {
    actor: FileActor;
    principal?: FileReadPrincipal;
    requestId?: string | null;
    now?: number;
  },
): Promise<BatchFileReadIntentResult> {
  if (input.requests.length < 1 || input.requests.length > 25
    || input.requests.length !== input.idempotencyKeys.length) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();
  const ttlMs = DEFAULT_READ_TTL_MS;
  validateReadTiming(now, ttlMs);
  const seen = new Set<string>();
  const preparations: ReadIntentPreparation[] = [];
  const claims: IdempotencyClaim[] = [];
  const results: FileReadIntentResult[] = [];

  try {
    // 纯输入校验先行（无 IO），重复/非法直接整批 400
    for (const request of input.requests) {
      const fileObjectId = cleanFileIdentifier(request.fileObjectId, 120);
      if (seen.has(fileObjectId)) {
        throw new FileStorageError('VALIDATION_ERROR', 400);
      }
      seen.add(fileObjectId);
      if (!Number.isSafeInteger(request.expectedFileVersion)
        || request.expectedFileVersion < 1) {
        throw new FileStorageError('VALIDATION_ERROR', 400);
      }
    }
    // 逐文件校验/授权/幂等并行化：此前 25 文件 × ~6 次串行 D1 往返
    // ≈ 0.2-0.75s 纯延迟。任一失败整体失败（catch 统一标记已获幂等
    // claim），与原串行语义一致。results 顺序与请求顺序对齐（map 保序）。
    const settled = await Promise.all(input.requests.map(async (request, index) => {
      const fileObjectId = cleanFileIdentifier(request.fileObjectId, 120);
      const source = await requireReadableFile(database, fileObjectId, null, now);
      await authorizeFileRead(
        database,
        authorization,
        command.actor,
        command.principal,
        resource(source),
        now,
      );
      if (source.hot_deleted > 0 && !source.temp_restore_key) {
        throw new FileStorageError('FILE_ARCHIVED', 410);
      }
      await requireDynamicInstructionReadAuthorization(
        database,
        source,
        command.actor,
        now,
      );
      if (source.version !== request.expectedFileVersion) {
        throw new FileStorageError('VERSION_CONFLICT', 409);
      }
      const expiresAt = now + ttlMs;
      const requestHash = await hashCanonicalJson({
        action: 'CREATE_FILE_READ_INTENT',
        file_object_id: fileObjectId,
        file_entity_link_id: source.file_entity_link_id,
        expected_file_version: request.expectedFileVersion,
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
          idempotencyKey: input.idempotencyKeys[index]!,
          requestHash,
        },
        { now },
      );
      if (acquired.kind === 'REPLAY') {
        return {
          replay: {
            ...acquired.response,
            accessToken: null,
            accessTokenAvailable: false,
            replayed: true,
          } as FileReadIntentResult,
        };
      }
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
          batch: true,
        },
        createdAt: now,
      });
      return {
        replay: null,
        claim: acquired.claim,
        preparation: {
          claim: acquired.claim,
          source,
          fileObjectId,
          readIntentId,
          tokenHash,
          expiresAt,
          firstResponse,
          storedResponse,
          outbox,
        } satisfies ReadIntentPreparation,
      };
    }));
    for (const item of settled) {
      if (item.replay !== null) {
        results.push(item.replay);
        continue;
      }
      claims.push(item.claim!);
      preparations.push(item.preparation!);
      results.push(item.preparation!.firstResponse);
    }

    const statements: SqlStatement[] = [];
    for (const preparation of preparations) {
      statements.push(
        ...buildReadIntentStatements(database, preparation, command, now),
      );
    }
    if (statements.length > 0) {
      await database.batch(statements);
    }
    return { intents: results };
  } catch (error) {
    const normalized = normalizeFileStorageError(error);
    for (const claim of claims) {
      await markIdempotencyFailed(database, claim, normalized.code, now)
        .catch(() => false);
    }
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
): Promise<{
  fileObjectId: string;
  contentType: SupportedFileMime;
  byteSize: number;
  bytes?: Uint8Array<ArrayBuffer>;
  stream?: ReadableStream<Uint8Array>;
}> {
  const readIntentId = cleanFileIdentifier(input.readIntentId, 120);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const source = await requireReadIntent(database, readIntentId, now);
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

  if (source.hot_deleted > 0) {
    // The bundle deleted the hot copy. Reads only work through an active
    // temporary restore (freshly re-checked above); there is never a live
    // Drive proxy path.
    if (!source.temp_restore_key) {
      throw new FileStorageError('FILE_ARCHIVED', 410);
    }
    const payload = await restoredReadPayload(source, storage);
    await consumeIntent(database, source, readIntentId, command.actor.type, command.actor.id, now);
    if (source.detected_mime === null) {
      throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
    }
    return {
      fileObjectId: source.id,
      contentType: source.detected_mime,
      byteSize: payload.byteSize,
      ...(payload.bytes === undefined ? {} : { bytes: payload.bytes }),
      ...(payload.stream === undefined ? {} : { stream: payload.stream }),
    };
  }
  const opened = typeof storage.openObjectStream === 'function'
    ? await storage.openObjectStream(source.object_key).catch(() => null)
    : null;
  const payload: {
    bytes?: Uint8Array<ArrayBuffer>;
    stream?: ReadableStream<Uint8Array>;
    byteSize: number;
  } = opened === null
    ? await bufferedReadPayload(source, storage)
    : await streamedReadPayload(source, opened);

  await consumeIntent(database, source, readIntentId, command.actor.type, command.actor.id, now);

  if (source.detected_mime === null) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  return {
    fileObjectId: source.id,
    contentType: source.detected_mime,
    byteSize: payload.byteSize,
    ...(payload.bytes === undefined ? {} : { bytes: payload.bytes }),
    ...(payload.stream === undefined ? {} : { stream: payload.stream }),
  };
}

async function consumeIntent(
  database: SqlDatabase,
  source: ReadIntentRow,
  readIntentId: string,
  actorType: string,
  actorId: string,
  now: number,
): Promise<void> {
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
      actorType,
      actorId,
      now,
    ),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
    `),
    createFileEventStatement(database, {
      uploadIntentId: source.upload_intent_id,
      fileObjectId: source.id,
      eventType: 'FILE_READ_INTENT_CONSUMED',
      actorType,
      actorId,
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
  ]).catch((error: unknown) => {
    throw normalizeFileStorageError(error);
  });
}

/**
 * Temporary-restore read: serves the member object restored by a Staff
 * request, verifying its stored size against the sealed manifest fact. The
 * original audience authorization already ran; the restore never widens it.
 */
async function restoredReadPayload(
  source: ReadIntentRow,
  storage: ObjectStorageAdapter,
): Promise<{ stream?: ReadableStream<Uint8Array>; bytes?: Uint8Array<ArrayBuffer>; byteSize: number }> {
  if (!source.temp_restore_key || source.temp_restore_size === null
    || source.uploaded_byte_size === null
    || source.temp_restore_size !== source.uploaded_byte_size) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  if (typeof storage.openObjectStream === 'function') {
    const opened = await storage.openObjectStream(source.temp_restore_key).catch(() => null);
    if (opened && opened.head.byteSize === source.temp_restore_size) {
      return { stream: opened.body, byteSize: opened.head.byteSize };
    }
  }
  const bytes = await storage.readObject(source.temp_restore_key).catch(() => {
    throw new FileStorageError('DEPENDENCY_UNAVAILABLE', 503);
  });
  if (bytes.byteLength !== source.temp_restore_size) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  return { bytes, byteSize: bytes.byteLength };
}

/**
 * Streaming hot read: one R2 GET yields both the metadata for the
 * integrity check (checksum equality semantics unchanged — the stored
 * checksum must equal the verified uploaded_sha256) and the body stream the
 * HTTP response forwards without buffering.  The magic-byte sniff is
 * replaced by comparing the stored content type against the verified
 * detected_mime; R2 objects are immutable, so both checks guard the same
 * stored-bytes identity the buffered path guards.
 */
async function streamedReadPayload(
  source: ReadIntentRow,
  opened: import('@ygb/contracts').ObjectStorageStream,
): Promise<{
  stream: ReadableStream<Uint8Array>;
  byteSize: number;
}> {
  if (source.uploaded_byte_size === null
    || source.detected_mime === null
    || source.uploaded_sha256 === null
    || opened.head.byteSize !== source.uploaded_byte_size
    || opened.head.contentType !== source.detected_mime
    || opened.head.checksumSha256 !== source.uploaded_sha256) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  return { stream: opened.body, byteSize: opened.head.byteSize };
}

async function bufferedReadPayload(
  source: ReadIntentRow,
  storage: ObjectStorageAdapter,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; byteSize: number }> {
  const bytes = await storage.readObject(source.object_key).catch(() => {
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
  return { bytes, byteSize: bytes.byteLength };
}

async function requireReadableFile(
  database: SqlDatabase,
  fileObjectId: string,
  fileEntityLinkId: string | null,
  now: number,
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
      link.revoked_at AS link_revoked_at,
      (SELECT COUNT(*) FROM archive_bundle_files bundle_file
        WHERE bundle_file.file_object_id=object.id AND bundle_file.delete_state='DELETED') AS hot_deleted,
      (SELECT member.temp_object_key FROM archive_restore_members member
        JOIN archive_restores restore ON restore.id=member.restore_id
        WHERE member.file_object_id=object.id AND restore.state='COMPLETED'
          AND restore.restore_expires_at>?
        ORDER BY restore.restore_expires_at DESC LIMIT 1) AS temp_restore_key,
      (SELECT member.byte_size FROM archive_restore_members member
        JOIN archive_restores restore ON restore.id=member.restore_id
        WHERE member.file_object_id=object.id AND restore.state='COMPLETED'
          AND restore.restore_expires_at>?
        ORDER BY restore.restore_expires_at DESC LIMIT 1) AS temp_restore_size
    FROM file_objects object
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
    JOIN file_entity_links link
      ON link.file_object_id=object.id
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
    now,
    now,
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
  now: number,
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
      read.expires_at AS read_expires_at,
      (SELECT COUNT(*) FROM archive_bundle_files bundle_file
        WHERE bundle_file.file_object_id=object.id AND bundle_file.delete_state='DELETED') AS hot_deleted,
      (SELECT member.temp_object_key FROM archive_restore_members member
        JOIN archive_restores restore ON restore.id=member.restore_id
        WHERE member.file_object_id=object.id AND restore.state='COMPLETED'
          AND restore.restore_expires_at>?
        ORDER BY restore.restore_expires_at DESC LIMIT 1) AS temp_restore_key,
      (SELECT member.byte_size FROM archive_restore_members member
        JOIN archive_restores restore ON restore.id=member.restore_id
        WHERE member.file_object_id=object.id AND restore.state='COMPLETED'
          AND restore.restore_expires_at>?
        ORDER BY restore.restore_expires_at DESC LIMIT 1) AS temp_restore_size
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
    WHERE read.id=?
      AND object.status='VERIFIED'
      AND intent.status='VERIFIED'
    ORDER BY link.created_at, link.id
    LIMIT 1
  `).bind(now, now, readIntentId).first<ReadIntentRow>();
  if (!row) {
    throw new FileStorageError('FILE_READ_INTENT_NOT_FOUND', 404);
  }
  return row;
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
