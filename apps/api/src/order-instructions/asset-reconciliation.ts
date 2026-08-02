import type {
  ObjectStorageAdapter,
  SqlDatabase,
} from '@ygb/contracts';
import { canonicalJson, sha256Hex } from '@ygb/domain';
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
import {
  normalizeOrderInstructionError,
  OrderInstructionError,
  requireInstructionPermission,
  validateTimestamp,
  type OrderInstructionStaffActor,
} from './shared';

interface OrphanAssetRow {
  item_id: string;
  file_object_id: string;
  object_key: string;
  delete_attempt_count: number;
}

export interface ReconcileInstructionAssetOrphansResult {
  scanned: number;
  deleted: number;
  deferred: number;
  has_more: boolean;
  replayed: boolean;
}

/**
 * Deletes only durable, ungranted keyword assets left by an R2/D1 split
 * failure. Object keys remain server-side and never enter DTO/Audit/Outbox.
 */
export async function reconcileInstructionAssetOrphans(
  database: SqlDatabase,
  objectStorage: ObjectStorageAdapter | null,
  input: { limit?: number },
  command: {
    actor: OrderInstructionStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ReconcileInstructionAssetOrphansResult> {
  requireInstructionPermission(command.actor, 'ORDER_INSTRUCTION_MANAGE');
  if (!objectStorage) {
    throw new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
  }
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  const now = validateTimestamp(command.now ?? Date.now());
  const requestHash = await sha256Hex(canonicalJson({
    action: 'RECONCILE_ORDER_INSTRUCTION_ASSET_ORPHANS',
    limit,
  }));
  const acquired = await acquireIdempotency<
    ReconcileInstructionAssetOrphansResult
  >(database, {
    actorType: 'STAFF',
    actorId: command.actor.staffId,
    action: 'RECONCILE_ORDER_INSTRUCTION_ASSET_ORPHANS',
    targetType: 'ORDER_INSTRUCTION_ASSET_BATCH',
    targetId: 'orphan-cleanup',
    idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const rows = await database.prepare(`
      SELECT item.id AS item_id, object.id AS file_object_id,
             object.object_key, object.delete_attempt_count
      FROM order_instruction_asset_items item
      JOIN order_instruction_asset_batches batch
        ON batch.id=item.asset_batch_id
      JOIN file_objects object ON object.id=item.file_object_id
      WHERE item.status='ORPHANED'
        AND batch.status IN ('FAILED','CANCELLED')
        AND object.status='DELETION_PENDING'
        AND object.next_delete_at<=?
        AND NOT EXISTS (
          SELECT 1 FROM file_entity_links link
          WHERE link.file_object_id=object.id AND link.revoked_at IS NULL
        )
      ORDER BY object.next_delete_at, item.updated_at, item.id
      LIMIT ?
    `).bind(now, limit + 1).all<OrphanAssetRow>();
    const visible = rows.results.slice(0, limit);
    let deleted = 0;
    let deferred = 0;

    for (const row of visible) {
      try {
        await objectStorage.deleteObject(row.object_key);
        await database.batch([
          database.prepare(`
            UPDATE file_objects
            SET status='DELETED', delete_attempt_count=delete_attempt_count+1,
                next_delete_at=NULL, failure_code='ORPHAN_CLEANED',
                version=version+1, updated_at=MAX(?, updated_at+1),
                deleted_at=?
            WHERE id=? AND status='DELETION_PENDING'
              AND NOT EXISTS (
                SELECT 1 FROM file_entity_links link
                WHERE link.file_object_id=file_objects.id
                  AND link.revoked_at IS NULL
              )
          `).bind(now, now, row.file_object_id),
          database.prepare(`
            UPDATE order_instruction_asset_items
            SET status='FAILED', error_code='ORPHAN_CLEANED',
                updated_at=MAX(?, updated_at+1)
            WHERE id=? AND file_object_id=? AND status='ORPHANED'
          `).bind(now, row.item_id, row.file_object_id),
        ]);
        deleted += 1;
      } catch {
        const attempts = Number(row.delete_attempt_count) + 1;
        const delay = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.min(attempts, 7));
        await database.prepare(`
          UPDATE file_objects
          SET delete_attempt_count=delete_attempt_count+1,
              next_delete_at=?, failure_code='ORPHAN_DELETE_RETRY',
              version=version+1, updated_at=MAX(?, updated_at+1)
          WHERE id=? AND status='DELETION_PENDING'
        `).bind(now + delay, now, row.file_object_id).run();
        deferred += 1;
      }
    }

    const response: ReconcileInstructionAssetOrphansResult = {
      scanned: visible.length,
      deleted,
      deferred,
      has_more: rows.results.length > limit,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `order-instruction-asset-orphans:${acquired.claim.idempotencyKey}`,
      eventType: 'ORDER_INSTRUCTION_ASSET_ORPHANS_RECONCILED',
      aggregateType: 'ORDER_INSTRUCTION_ASSET_RECONCILIATION',
      aggregateId: 'orphan-cleanup',
      payload: response,
      createdAt: now,
    });
    await database.batch([
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ORDER_INSTRUCTION_ASSET_RECONCILIATION',
        aggregateId: 'orphan-cleanup',
        eventType: 'ORDER_INSTRUCTION_ASSET_ORPHANS_RECONCILED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
        nextState: response,
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          deleted: response.deleted,
          deferred: response.deferred,
        },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
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
