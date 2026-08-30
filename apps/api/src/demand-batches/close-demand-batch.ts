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
  prepareWorkItemCompletionStatements,
  requireAssignedWorkflowActor,
  requireMarketplaceScope,
  requireSellerOrganizationScope,
  resolveStaffDataScope,
} from '../staff-assignment';
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
  marketplace_code: string;
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

  const initialSource = await requireCloseSource(database, demandBatchId);
  const initialAuthorization = await requireCloseAuthorization(
    database,
    initialSource,
    command.actor.staffId,
  );

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
        actorId: initialAuthorization.staffId,
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
    const authorization = await requireCloseAuthorization(
      database,
      source,
      command.actor.staffId,
    );
    const actor: DemandStaffActor = {
      staffId: authorization.staffId,
      displayName: authorization.displayName,
      roles: Object.freeze([...authorization.roles]),
      permissions: authorization.permissions,
    };
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

    const workItemStatements = await prepareWorkItemCompletionStatements(
      database,
      {
        workType: 'DEMAND_REVIEW',
        sourceEntityType: 'DEMAND_BATCH',
        sourceEntityId: demandBatchId,
        outcome: 'COMPLETED',
        actorType: 'STAFF',
        actorId: actor.staffId,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        reason: closeReason,
        now,
      },
    );
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
        actor.staffId,
        now,
        now,
        demandBatchId,
        source.version,
      ),
      assertDemandBatchUpdateChangedOnceStatement(database),
      insertDemandBatchEventStatement(database, {
        demandBatchId,
        organizationId: source.organization_id,
        storeId: source.store_id,
        productId: source.product_id,
        eventType: 'DEMAND_BATCH_CLOSED',
        actorType: 'STAFF',
        actorId: actor.staffId,
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
          id: actor.staffId,
          roles: actor.roles,
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
      ...workItemStatements,
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

/**
 * Conservative capability projection for the Staff scheduling read model.
 * The close command remains the final authority and repeats every check.
 */
export async function canCloseDemandBatch(
  database: SqlDatabase,
  input: {
    demandBatchId: string;
    staffId: string;
    source?: Pick<CloseSource, 'demand_batch_id' | 'organization_id' | 'marketplace_code' | 'status'>;
  },
): Promise<boolean> {
  const demandBatchId = cleanDemandIdentifier(input.demandBatchId);
  const source = input.source ?? await requireCloseSource(database, demandBatchId);
  if (source.status !== 'PUBLISHED') return false;
  try {
    await requireCloseAuthorization(database, source, input.staffId);
    return true;
  } catch (error) {
    const normalized = normalizeDemandBatchError(error);
    if (normalized.code === 'FORBIDDEN' || normalized.code === 'NOT_FOUND') {
      return false;
    }
    throw normalized;
  }
}

async function requireCloseSource(
  database: SqlDatabase,
  demandBatchId: string,
): Promise<CloseSource> {
  const row = await database.prepare(`
    SELECT
      demand.id AS demand_batch_id,
      demand.organization_id,
      demand.store_id,
      demand.marketplace_code,
      demand.product_id,
      demand.status,
      demand.version
    FROM demand_batches demand
    JOIN products product
      ON product.id=demand.product_id
      AND product.organization_id=demand.organization_id
      AND product.store_id=demand.store_id
      AND product.marketplace_code=demand.marketplace_code
    JOIN seller_stores store
      ON store.id=demand.store_id
      AND store.organization_id=demand.organization_id
      AND store.marketplace_code=demand.marketplace_code
    JOIN seller_organizations organization
      ON organization.id=demand.organization_id
    WHERE demand.id=?
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

async function requireCloseAuthorization(
  database: SqlDatabase,
  source: Pick<CloseSource, 'demand_batch_id' | 'organization_id'>
    & Partial<Pick<CloseSource, 'marketplace_code'>>,
  staffId: string,
) {
  const authorization = await requireAssignedWorkflowActor(database, {
    staffId,
    workType: 'DEMAND_REVIEW',
    sourceEntityType: 'DEMAND_BATCH',
    sourceEntityId: source.demand_batch_id,
    authoritativeSellerOrganizationId: source.organization_id,
    allowCompleted: true,
  });
  requireDemandPublishPermission(authorization);
  const scope = await resolveStaffDataScope(database, authorization);
  requireSellerOrganizationScope(scope, source.organization_id);
  if (source.marketplace_code !== undefined) {
    requireMarketplaceScope(scope, source.marketplace_code);
  }
  return authorization;
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
      AND NOT EXISTS (
        SELECT 1 FROM staff_work_items
        WHERE source_entity_type='DEMAND_BATCH'
          AND source_entity_id=?
          AND work_type='DEMAND_REVIEW'
          AND status='OPEN'
      )
    THEN 1 ELSE 0 END
  `).bind(
    response.demand_batch_id,
    response.version,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
    response.demand_batch_id,
  );
}

function assertDemandBatchUpdateChangedOnceStatement(
  database: SqlDatabase,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
  `);
}
