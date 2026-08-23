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
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import { prepareWorkItemCompletionStatements } from '../staff-assignment';
import {
  cleanDemandIdentifier,
  insertDemandBatchEventStatement,
  normalizeDemandBatchError,
  requireSellerDemandPermission,
  sellerCanAccessDemandStore,
  DemandBatchError,
  type SellerDemandActor,
} from './demand-shared';

interface WithdrawSource {
  demand_batch_id: string;
  organization_id: string;
  store_id: string;
  product_id: string;
  status: string;
  version: number;
}

export interface WithdrawDemandBatchResult {
  demand_batch_id: string;
  status: 'WITHDRAWN';
  version: number;
  replayed: boolean;
}

export async function withdrawDemandBatch(
  database: SqlDatabase,
  input: {
    demandBatchId: string;
    expectedVersion: number;
  },
  command: {
    actor: SellerDemandActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<WithdrawDemandBatchResult> {
  requireSellerDemandPermission(command.actor);

  const demandBatchId = cleanDemandIdentifier(
    input.demandBatchId,
  );
  if (!Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }

  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new DemandBatchError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'WITHDRAW_DEMAND_BATCH',
    demand_batch_id: demandBatchId,
    expected_version: input.expectedVersion,
  });

  const acquired =
    await acquireIdempotency<WithdrawDemandBatchResult>(
      database,
      {
        actorType: 'SELLER_MEMBER',
        actorId: command.actor.memberId,
        action: 'WITHDRAW_DEMAND_BATCH',
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
    const source = await requireWithdrawSource(
      database,
      demandBatchId,
      command.actor.sellerOrganizationId,
    );
    if (!sellerCanAccessDemandStore(
      command.actor,
      source.store_id,
    )) {
      throw new DemandBatchError('FORBIDDEN', 403);
    }
    if (source.version !== input.expectedVersion) {
      throw new DemandBatchError(
        'VERSION_CONFLICT',
        409,
      );
    }
    if (source.status !== 'SUBMITTED') {
      throw new DemandBatchError(
        'DEMAND_BATCH_ALREADY_REVIEWED',
        409,
      );
    }

    const nextVersion = source.version + 1;
    const response: WithdrawDemandBatchResult = {
      demand_batch_id: demandBatchId,
      status: 'WITHDRAWN',
      version: nextVersion,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `demand-batch-withdrawn:${demandBatchId}`,
      eventType: 'DEMAND_BATCH_WITHDRAWN',
      aggregateType: 'DEMAND_BATCH',
      aggregateId: demandBatchId,
      payload: {
        demand_batch_id: demandBatchId,
        seller_organization_id: source.organization_id,
        status: 'WITHDRAWN',
        version: nextVersion,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE demand_batches
        SET
          status='WITHDRAWN',
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          withdrawn_at=?,
          review_reason=NULL,
          close_reason=NULL,
          reviewed_by_staff_id=NULL,
          closed_by_staff_id=NULL,
          reviewed_at=NULL,
          published_at=NULL,
          closed_at=NULL
        WHERE id=?
          AND organization_id=?
          AND status='SUBMITTED'
          AND version=?
      `).bind(
        now,
        now,
        demandBatchId,
        source.organization_id,
        source.version,
      ),
      insertDemandBatchEventStatement(database, {
        demandBatchId,
        organizationId: source.organization_id,
        storeId: source.store_id,
        productId: source.product_id,
        eventType: 'DEMAND_BATCH_WITHDRAWN',
        actorType: 'SELLER_MEMBER',
        actorId: command.actor.memberId,
        previousStatus: 'SUBMITTED',
        nextStatus: 'WITHDRAWN',
        demandVersion: nextVersion,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'DEMAND_BATCH',
        aggregateId: demandBatchId,
        eventType: 'DEMAND_BATCH_WITHDRAWN',
        actor: {
          type: 'SELLER_MEMBER',
          id: command.actor.memberId,
          roles: [command.actor.role],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: 'SUBMITTED',
          version: source.version,
        },
        nextState: response,
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
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
      assertWithdrawnStatement(
        database,
        acquired.claim,
        response,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await database.batch([
      ...statements,
      // 撤回使 DEMAND_REVIEW 待办失去处理对象：同事务取消，避免队列残留
      // 点开必报错的死项。
      ...await prepareWorkItemCompletionStatements(database, {
        workType: 'DEMAND_REVIEW',
        sourceEntityType: 'DEMAND_BATCH',
        sourceEntityId: demandBatchId,
        outcome: 'CANCELLED',
        actorType: 'SYSTEM',
        actorId: `seller:${command.actor.memberId}`,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        reason: 'demand batch withdrawn by seller',
        now,
      }),
    ]);
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

async function requireWithdrawSource(
  database: SqlDatabase,
  demandBatchId: string,
  organizationId: string,
): Promise<WithdrawSource> {
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
      AND organization_id=?
  `).bind(
    demandBatchId,
    organizationId,
  ).first<WithdrawSource>();

  if (!row) {
    throw new DemandBatchError(
      'DEMAND_BATCH_NOT_FOUND',
      404,
    );
  }
  return row;
}

function assertWithdrawnStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: WithdrawDemandBatchResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM demand_batches
        WHERE id=?
          AND status='WITHDRAWN'
          AND version=?
          AND withdrawn_at IS NOT NULL
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
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
