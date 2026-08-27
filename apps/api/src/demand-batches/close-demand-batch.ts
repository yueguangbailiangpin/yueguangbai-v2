import type {
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  hashCanonicalJson,
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
  cleanDemandIdentifier,
  cleanDemandReason,
  insertDemandBatchEventStatement,
  normalizeDemandBatchError,
  requireDemandPublishPermission,
  DemandBatchError,
  type DemandStaffActor,
} from './demand-shared';

interface CloseSource {
  demand_batch_id: string;
  organization_id: string;
  store_id: string;
  product_id: string;
  status: string;
  version: number;
}

export interface CloseDemandBatchResult {
  demand_batch_id: string;
  status: 'CLOSED';
  version: number;
  close_reason: string;
  replayed: boolean;
}

export async function closeDemandBatch(
  database: SqlDatabase,
  input: {
    demandBatchId: string;
    expectedVersion: number;
    closeReason: string;
  },
  command: {
    actor: DemandStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<CloseDemandBatchResult> {
  requireDemandPublishPermission(command.actor);

  const demandBatchId = cleanDemandIdentifier(
    input.demandBatchId,
  );
  if (!Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }
  const closeReason = cleanDemandReason(input.closeReason);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'CLOSE_DEMAND_BATCH',
    demand_batch_id: demandBatchId,
    expected_version: input.expectedVersion,
    close_reason: closeReason,
  });

  const acquired =
    await acquireIdempotency<CloseDemandBatchResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'CLOSE_DEMAND_BATCH',
        targetType: 'DEMAND_BATCH',
        targetId: demandBatchId,
        idempotencyKey: command.idempotencyKey,
        requestHash,
      },
      { now },
    );

  if (acquired.kind === 'REPLAY') {
    return {
      ...acquired.response,
      replayed: true,
    };
  }

  try {
    const source = await requireCloseSource(
      database,
      demandBatchId,
    );
    if (source.version !== input.expectedVersion) {
      throw new DemandBatchError(
        'VERSION_CONFLICT',
        409,
      );
    }
    if (source.status !== 'PUBLISHED') {
      throw new DemandBatchError(
        'DEMAND_BATCH_NOT_PUBLISHED',
        409,
      );
    }

    const nextVersion = source.version + 1;
    const response: CloseDemandBatchResult = {
      demand_batch_id: demandBatchId,
      status: 'CLOSED',
      version: nextVersion,
      close_reason: closeReason,
      replayed: false,
    };

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE demand_batches
        SET
          status='CLOSED',
          close_reason=?,
          closed_by_staff_id=?,
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          closed_at=?
        WHERE id=?
          AND status='PUBLISHED'
          AND version=?
      `).bind(
        closeReason,
        command.actor.staffId,
        now,
        now,
        demandBatchId,
        source.version,
      ),
      insertDemandBatchEventStatement(database, {
        demandBatchId,
        organizationId: source.organization_id,
        storeId: source.store_id,
        productId: source.product_id,
        eventType: 'DEMAND_BATCH_CLOSED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousStatus: 'PUBLISHED',
        nextStatus: 'CLOSED',
        demandVersion: nextVersion,
        reason: closeReason,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'DEMAND_BATCH',
        aggregateId: demandBatchId,
        eventType: 'DEMAND_BATCH_CLOSED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: 'PUBLISHED',
          version: source.version,
        },
        nextState: response,
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            demand_batch_id: demandBatchId,
          },
          now,
        },
      ),
      assertClosedStatement(
        database,
        acquired.claim,
        response,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeDemandBatchError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

async function requireCloseSource(
  database: SqlDatabase,
  demandBatchId: string,
): Promise<CloseSource> {
  const row = await database.prepare(`
    SELECT
      id AS demand_batch_id,
      organization_id,
      store_id,
      product_id,
      status,
      version
    FROM demand_batches
    WHERE id=?
  `).bind(
    demandBatchId,
  ).first<CloseSource>();

  if (!row) {
    throw new DemandBatchError(
      'DEMAND_BATCH_NOT_FOUND',
      404,
    );
  }
  return row;
}

function assertClosedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: CloseDemandBatchResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM demand_batches
        WHERE id=?
          AND status='CLOSED'
          AND version=?
          AND close_reason=?
          AND closed_by_staff_id IS NOT NULL
          AND closed_at IS NOT NULL
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
    response.demand_batch_id,
    response.version,
    response.close_reason,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
