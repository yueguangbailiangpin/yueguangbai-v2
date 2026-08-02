import type {
  KeywordImageGenerator,
  ObjectStorageAdapter,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  canonicalJson,
  sha256Hex,
  validateKeywordPng,
} from '@ygb/domain';
import {
  createAuditEventStatement,
} from '../foundation/audit';
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
import {
  cleanIdentifier,
  normalizeOrderInstructionError,
  OrderInstructionError,
  requireInstructionBuyerScope,
  requireInstructionPermission,
  validateExpectedVersion,
  validateTimestamp,
  type OrderInstructionStaffActor,
} from './shared';
import {
  parseOrderedKeywords,
  requireInstructionContext,
} from './records';

export interface PrepareInstructionAssetsResult {
  asset_batch_id: string;
  instruction_id: string;
  status: 'READY';
  keyword_image_count: number;
  generator_version: string;
  replayed: boolean;
}

export async function prepareInstructionAssets(
  database: SqlDatabase,
  dependencies: {
    generator: KeywordImageGenerator | null;
    objectStorage: ObjectStorageAdapter | null;
    keywordHmacSecret: string | null;
  },
  input: {
    instructionId: string;
    expectedVersion: number;
    renderProfile?: string;
  },
  command: {
    actor: OrderInstructionStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<PrepareInstructionAssetsResult> {
  requireInstructionPermission(command.actor, 'ORDER_INSTRUCTION_PUBLISH');
  const instructionId = cleanIdentifier(input.instructionId);
  const expectedVersion = validateExpectedVersion(input.expectedVersion);
  const now = validateTimestamp(command.now ?? Date.now());
  const renderProfile = cleanIdentifier(
    input.renderProfile ?? 'ORDER_INSTRUCTION_V1',
    100,
  );
  if (!dependencies.generator
    || !dependencies.objectStorage
    || !dependencies.keywordHmacSecret
    || dependencies.keywordHmacSecret.length < 32) {
    throw new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
  }

  const requestHash = await sha256Hex(canonicalJson({
    action: 'PREPARE_ORDER_INSTRUCTION_ASSETS',
    instruction_id: instructionId,
    expected_version: expectedVersion,
    render_profile: renderProfile,
  }));
  const acquired = await acquireIdempotency<PrepareInstructionAssetsResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'PREPARE_ORDER_INSTRUCTION_ASSETS',
      targetType: 'ORDER_INSTRUCTION',
      targetId: instructionId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  let activeBatchId: string | null = null;
  try {
    const source = await requireInstructionContext(database, instructionId);
    await requireInstructionBuyerScope(
      database,
      command.actor,
      source.buyer_customer_id,
      'ORDER_INSTRUCTION_PUBLISH',
    );
    if (source.instruction_version !== expectedVersion) {
      throw new OrderInstructionError('VERSION_CONFLICT', 409);
    }
    if (source.instruction_status !== 'UNPUBLISHED'
      && source.instruction_status !== 'ACTIVE') {
      throw new OrderInstructionError('INSTRUCTION_TERMINAL', 409);
    }
    if (source.reservation_status !== 'APPROVED') {
      throw new OrderInstructionError('RESERVATION_NOT_APPROVED', 409);
    }
    if (source.evidence_version_count > 0) {
      throw new OrderInstructionError('EVIDENCE_ALREADY_EXISTS', 409);
    }

    const keywords = parseOrderedKeywords(source.search_keywords_json);
    const batchId = crypto.randomUUID();
    activeBatchId = batchId;
    const existing = await findReadyBatch(database, instructionId, requestHash);
    if (existing) {
      const response: PrepareInstructionAssetsResult = {
        asset_batch_id: existing.batch_id,
        instruction_id: instructionId,
        status: 'READY',
        keyword_image_count: existing.item_count,
        generator_version: existing.generator_version,
        replayed: false,
      };
      await database.batch([
        completeIdempotencyStatement(database, acquired.claim, response, {
          resultReferences: { asset_batch_id: existing.batch_id },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      return response;
    }

    await database.batch([
      database.prepare(`
        INSERT INTO order_instruction_asset_batches (
          id, instruction_id, reservation_id, product_version_id,
          status, idempotency_digest, render_profile, item_count,
          ready_count, failed_count, generator_version, failure_code,
          version, created_by_staff_id, created_at, updated_at,
          ready_at, consumed_at, cancelled_at
        ) VALUES (
          ?, ?, ?, ?, 'PREPARING', ?, ?, ?, 0, 0,
          NULL, NULL, 1, ?, ?, ?, NULL, NULL, NULL
        )
      `).bind(
        batchId,
        source.instruction_id,
        source.reservation_id,
        source.product_version_id,
        requestHash,
        renderProfile,
        keywords.length,
        command.actor.staffId,
        now,
        now,
      ),
    ]);

    let generatorVersion: string | null = null;
    let preparedCount = 0;

    for (let index = 0; index < keywords.length; index += 1) {
      const position = index + 1;
      const keyword = keywords[index]!;
      const keywordHmacDigest = await hmacHex(
        dependencies.keywordHmacSecret,
        `${source.product_version_id}:${position}:${keyword}`,
      );
      const idempotencyDigest = await hmacHex(
        dependencies.keywordHmacSecret,
        `${instructionId}:${requestHash}:${position}:${keywordHmacDigest}`,
      );
      const output = await dependencies.generator.generate({
        keywordText: keyword,
        position,
        renderProfile,
        idempotencyDigest,
      });
      if (output.mime !== 'image/png'
        || output.metadataScanResult.clean !== true) {
        throw new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
      }
      const scan = validateKeywordPng(output.pngBytes);
      const computedHash = await sha256Hex(output.pngBytes);
      if (computedHash !== output.sha256
        || scan.width !== output.width
        || scan.height !== output.height) {
        throw new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
      }
      if (generatorVersion !== null
        && generatorVersion !== output.generatorVersion) {
        throw new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
      }
      generatorVersion = output.generatorVersion;

      const itemId = crypto.randomUUID();
      const fileObjectId = crypto.randomUUID();
      const uploadIntentId = crypto.randomUUID();
      const randomId = crypto.randomUUID().replaceAll('-', '');
      const objectKey = `files/v1/system/order-instruction-keywords/${randomId}`;
      const byteSize = output.pngBytes.byteLength;

      // Persist a non-readable system-owned staging record before touching R2.
      // A later R2/D1 split failure therefore always has a durable cleanup row.
      await database.batch([
        database.prepare(`
          INSERT INTO file_upload_intents (
            id, owner_actor_type, owner_actor_id, purpose, visibility,
            status, requested_file_count, manifest_hash, version,
            expires_at, failure_code, created_at, updated_at, completed_at
          ) VALUES (
            ?, 'SYSTEM', 'order-instruction-generator',
            'ORDER_INSTRUCTION_KEYWORD_IMAGE', 'INTERNAL_ONLY',
            'ISSUED', 1, ?, 1, ?, NULL, ?, ?, NULL
          )
        `).bind(
          uploadIntentId,
          output.sha256,
          now + 60_000,
          now,
          now,
        ),
        database.prepare(`
          INSERT INTO file_objects (
            id, upload_intent_id, slot_no, purpose, visibility, object_key,
            client_file_name, extension, declared_mime, expected_byte_size,
            status, upload_token_hash, upload_expires_at,
            uploaded_byte_size, detected_mime, uploaded_sha256,
            failure_code, delete_attempt_count, next_delete_at, version,
            created_at, updated_at, uploaded_at, verified_at, deleted_at
          ) VALUES (
            ?, ?, 1, 'ORDER_INSTRUCTION_KEYWORD_IMAGE', 'INTERNAL_ONLY', ?,
            ?, 'png', 'image/png', ?, 'RESERVED', ?, ?,
            NULL, NULL, NULL, NULL, 0, NULL, 1,
            ?, ?, NULL, NULL, NULL
          )
        `).bind(
          fileObjectId,
          uploadIntentId,
          objectKey,
          `asset-${fileObjectId}.png`,
          byteSize,
          output.sha256,
          now + 60_000,
          now,
          now,
        ),
        database.prepare(`
          INSERT INTO order_instruction_asset_items (
            id, asset_batch_id, keyword_position, keyword_hmac_digest,
            file_object_id, image_mime, width, height, sha256,
            generator_version, status, error_code, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, 'image/png', ?, ?, ?, ?, 'PREPARING', NULL, ?, ?
          )
        `).bind(
          itemId,
          batchId,
          position,
          keywordHmacDigest,
          fileObjectId,
          output.width,
          output.height,
          output.sha256,
          output.generatorVersion,
          now,
          now,
        ),
      ]);

      let storageResult: Awaited<
        ReturnType<ObjectStorageAdapter['putObject']>
      >;
      try {
        storageResult = await dependencies.objectStorage.putObject({
          objectKey,
          bytes: output.pngBytes,
          contentType: 'image/png',
          metadata: {},
        });
      } catch (error) {
        await markStagedItemFailed(database, {
          batchId,
          itemId,
          uploadIntentId,
          fileObjectId,
          now,
          errorCode: 'OBJECT_STORAGE_WRITE_FAILED',
        }).catch(() => false);
        throw error;
      }
      if (storageResult.checksumSha256 !== output.sha256
        || storageResult.contentType !== 'image/png'
        || storageResult.byteSize !== byteSize) {
        await persistUploadedOrphan(database, {
          batchId,
          itemId,
          uploadIntentId,
          fileObjectId,
          byteSize,
          sha256: output.sha256,
          now,
          errorCode: 'OBJECT_STORAGE_VERIFICATION_FAILED',
        }).catch(() => false);
        throw new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
      }

      try {
        await database.batch([
          database.prepare(`
            UPDATE file_upload_intents
            SET status='VERIFIED', version=version+1,
                updated_at=MAX(?, updated_at+1), completed_at=?
            WHERE id=? AND status='ISSUED' AND version=1
          `).bind(now, now, uploadIntentId),
          database.prepare(`
            UPDATE file_objects
            SET status='VERIFIED', uploaded_byte_size=?,
                detected_mime='image/png', uploaded_sha256=?,
                version=version+1, updated_at=MAX(?, updated_at+1),
                uploaded_at=?, verified_at=?
            WHERE id=? AND status='RESERVED' AND version=1
          `).bind(
            byteSize,
            output.sha256,
            now,
            now,
            now,
            fileObjectId,
          ),
          database.prepare(`
            UPDATE order_instruction_asset_items
            SET status='READY', updated_at=MAX(?, updated_at+1)
            WHERE id=? AND asset_batch_id=? AND status='PREPARING'
          `).bind(now, itemId, batchId),
          database.prepare(`
            UPDATE order_instruction_asset_batches
            SET ready_count=ready_count+1,
                generator_version=COALESCE(generator_version, ?),
                version=version+1,
                updated_at=MAX(?, updated_at+1)
            WHERE id=? AND status='PREPARING'
              AND ready_count<?
              AND (generator_version IS NULL OR generator_version=?)
          `).bind(
            output.generatorVersion,
            now,
            batchId,
            keywords.length,
            output.generatorVersion,
          ),
          database.prepare(`
            INSERT INTO transaction_assertions (assertion_value)
            SELECT CASE WHEN
              EXISTS (SELECT 1 FROM file_objects
                WHERE id=? AND status='VERIFIED')
              AND EXISTS (SELECT 1 FROM order_instruction_asset_items
                WHERE id=? AND status='READY')
              AND EXISTS (SELECT 1 FROM order_instruction_asset_batches
                WHERE id=? AND status='PREPARING' AND ready_count=?)
            THEN 1 ELSE 0 END
          `).bind(fileObjectId, itemId, batchId, preparedCount + 1),
        ]);
      } catch (error) {
        // R2 already succeeded. Convert the staging row into a durable orphan
        // instead of relying on a best-effort delete that could be lost.
        await persistUploadedOrphan(database, {
          batchId,
          itemId,
          uploadIntentId,
          fileObjectId,
          byteSize,
          sha256: output.sha256,
          now,
          errorCode: 'D1_FINALIZE_FAILED',
        }).catch(() => false);
        throw error;
      }
      preparedCount += 1;
    }

    if (generatorVersion === null || preparedCount !== keywords.length) {
      throw new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
    }
    const statements: SqlStatement[] = [];
    const response: PrepareInstructionAssetsResult = {
      asset_batch_id: batchId,
      instruction_id: instructionId,
      status: 'READY',
      keyword_image_count: preparedCount,
      generator_version: generatorVersion,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `order-instruction-assets-ready:${batchId}`,
      eventType: 'ORDER_INSTRUCTION_ASSETS_READY',
      aggregateType: 'ORDER_INSTRUCTION',
      aggregateId: instructionId,
      payload: {
        instruction_id: instructionId,
        asset_batch_id: batchId,
        image_count: preparedCount,
        generator_version: generatorVersion,
      },
      createdAt: now,
    });
    statements.push(
      database.prepare(`
        UPDATE order_instruction_asset_batches
        SET status='READY', ready_count=item_count, failed_count=0,
            generator_version=?, version=version+1,
            updated_at=MAX(?, updated_at+1), ready_at=?
        WHERE id=? AND status='PREPARING' AND ready_count=item_count
      `).bind(generatorVersion, now, now, batchId),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ORDER_INSTRUCTION',
        aggregateId: instructionId,
        eventType: 'ORDER_INSTRUCTION_ASSETS_READY',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: { asset_status: 'PREPARING' },
        nextState: response,
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { asset_batch_id: batchId },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          (SELECT status FROM order_instruction_asset_batches WHERE id=?)='READY'
          AND (SELECT COUNT(*) FROM order_instruction_asset_items
               WHERE asset_batch_id=? AND status='READY')=?
        THEN 1 ELSE 0 END
      `).bind(batchId, batchId, preparedCount),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    );
    await database.batch(statements);
    return response;
  } catch (error) {
    if (activeBatchId !== null) {
      await markAssetBatchFailed(database, activeBatchId, now).catch(() => false);
    }
    const normalized = normalizeOrderInstructionError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

async function markStagedItemFailed(
  database: SqlDatabase,
  input: {
    batchId: string;
    itemId: string;
    uploadIntentId: string;
    fileObjectId: string;
    now: number;
    errorCode: string;
  },
): Promise<void> {
  await database.batch([
    database.prepare(`
      UPDATE file_upload_intents
      SET status='FAILED', failure_code=?, version=version+1,
          updated_at=MAX(?, updated_at+1), completed_at=?
      WHERE id=? AND status='ISSUED'
    `).bind(input.errorCode, input.now, input.now, input.uploadIntentId),
    database.prepare(`
      UPDATE file_objects
      SET status='REJECTED', failure_code=?, version=version+1,
          updated_at=MAX(?, updated_at+1)
      WHERE id=? AND status='RESERVED'
    `).bind(input.errorCode, input.now, input.fileObjectId),
    database.prepare(`
      UPDATE order_instruction_asset_items
      SET status='FAILED', error_code=?, updated_at=MAX(?, updated_at+1)
      WHERE id=? AND asset_batch_id=? AND status='PREPARING'
    `).bind(input.errorCode, input.now, input.itemId, input.batchId),
  ]);
}

async function persistUploadedOrphan(
  database: SqlDatabase,
  input: {
    batchId: string;
    itemId: string;
    uploadIntentId: string;
    fileObjectId: string;
    byteSize: number;
    sha256: string;
    now: number;
    errorCode: string;
  },
): Promise<void> {
  await database.batch([
    database.prepare(`
      UPDATE file_upload_intents
      SET status='FAILED', failure_code=?, version=version+1,
          updated_at=MAX(?, updated_at+1), completed_at=?
      WHERE id=? AND status IN ('ISSUED','VERIFYING')
    `).bind(input.errorCode, input.now, input.now, input.uploadIntentId),
    database.prepare(`
      UPDATE file_objects
      SET status='DELETION_PENDING',
          uploaded_byte_size=COALESCE(uploaded_byte_size, ?),
          detected_mime=COALESCE(detected_mime, 'image/png'),
          uploaded_sha256=COALESCE(uploaded_sha256, ?),
          uploaded_at=COALESCE(uploaded_at, ?),
          verified_at=NULL,
          failure_code=?, next_delete_at=?,
          version=version+1, updated_at=MAX(?, updated_at+1)
      WHERE id=? AND status IN ('RESERVED','UPLOADED','VERIFIED')
    `).bind(
      input.byteSize,
      input.sha256,
      input.now,
      input.errorCode,
      input.now,
      input.now,
      input.fileObjectId,
    ),
    database.prepare(`
      UPDATE order_instruction_asset_items
      SET status='ORPHANED', error_code=?, updated_at=MAX(?, updated_at+1)
      WHERE id=? AND asset_batch_id=?
        AND status IN ('PREPARING','READY')
    `).bind(input.errorCode, input.now, input.itemId, input.batchId),
  ]);
}

async function markAssetBatchFailed(
  database: SqlDatabase,
  batchId: string,
  now: number,
): Promise<void> {
  await database.batch([
    // Any previously ready object in a failed batch has never been granted to
    // a Buyer. Move it to the durable deletion queue for reconciliation.
    database.prepare(`
      UPDATE file_objects
      SET status='DELETION_PENDING', verified_at=NULL,
          failure_code='ASSET_BATCH_FAILED', next_delete_at=?,
          version=version+1, updated_at=MAX(?, updated_at+1)
      WHERE id IN (
        SELECT file_object_id FROM order_instruction_asset_items
        WHERE asset_batch_id=? AND status='READY'
      ) AND status='VERIFIED'
    `).bind(now, now, batchId),
    database.prepare(`
      UPDATE order_instruction_asset_items
      SET status='ORPHANED', error_code='ASSET_BATCH_FAILED',
          updated_at=MAX(?, updated_at+1)
      WHERE asset_batch_id=? AND status='READY'
    `).bind(now, batchId),
    database.prepare(`
      UPDATE order_instruction_asset_items
      SET status='FAILED', error_code=COALESCE(error_code, 'ASSET_BATCH_FAILED'),
          updated_at=MAX(?, updated_at+1)
      WHERE asset_batch_id=? AND status='PREPARING'
    `).bind(now, batchId),
    database.prepare(`
      UPDATE file_objects
      SET status='REJECTED', failure_code='ASSET_BATCH_FAILED',
          version=version+1, updated_at=MAX(?, updated_at+1)
      WHERE id IN (
        SELECT file_object_id FROM order_instruction_asset_items
        WHERE asset_batch_id=? AND status='FAILED'
      ) AND status='RESERVED'
    `).bind(now, batchId),
    database.prepare(`
      UPDATE order_instruction_asset_batches
      SET status='FAILED', failure_code='ASSET_PREPARATION_FAILED',
          failed_count=(SELECT COUNT(*) FROM order_instruction_asset_items
            WHERE asset_batch_id=? AND status IN ('FAILED','ORPHANED')),
          ready_count=(SELECT COUNT(*) FROM order_instruction_asset_items
            WHERE asset_batch_id=? AND status='READY'),
          version=version+1, updated_at=MAX(?, updated_at+1)
      WHERE id=? AND status='PREPARING'
    `).bind(batchId, batchId, now, batchId),
  ]);
}

async function findReadyBatch(
  database: SqlDatabase,
  instructionId: string,
  digest: string,
): Promise<{
  batch_id: string;
  item_count: number;
  generator_version: string;
} | null> {
  return database.prepare(`
    SELECT id AS batch_id, item_count, generator_version
    FROM order_instruction_asset_batches
    WHERE instruction_id=? AND idempotency_digest=? AND status='READY'
    ORDER BY created_at DESC LIMIT 1
  `).bind(instructionId, digest).first<{
    batch_id: string;
    item_count: number;
    generator_version: string;
  }>();
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
}
