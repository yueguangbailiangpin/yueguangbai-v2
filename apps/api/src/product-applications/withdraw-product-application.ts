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
import {
  cleanApplicationIdentifier,
  insertProductApplicationEventStatement,
  normalizeProductApplicationError,
  requireSellerCanSubmitProducts,
  sellerCanAccessStore,
  ProductApplicationError,
  type SellerProductApplicationActor,
} from './product-application-shared';

interface ApplicationSource {
  application_id: string;
  organization_id: string;
  store_id: string;
  status: string;
  version: number;
}

export interface WithdrawProductApplicationResult {
  application_id: string;
  status: 'WITHDRAWN';
  application_version: number;
  replayed: boolean;
}

export async function withdrawProductApplication(
  database: SqlDatabase,
  input: {
    applicationId: string;
    expectedVersion: number;
  },
  command: {
    actor: SellerProductApplicationActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<WithdrawProductApplicationResult> {
  requireSellerCanSubmitProducts(command.actor);

  const applicationId = cleanApplicationIdentifier(
    input.applicationId,
  );
  if (!Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1) {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }

  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }

  const requestHash = await hashCanonicalJson({
    action: 'WITHDRAW_PRODUCT_APPLICATION',
    application_id: applicationId,
    expected_version: input.expectedVersion,
  });

  const acquired =
    await acquireIdempotency<WithdrawProductApplicationResult>(
      database,
      {
        actorType: 'SELLER_MEMBER',
        actorId: command.actor.memberId,
        action: 'WITHDRAW_PRODUCT_APPLICATION',
        targetType: 'PRODUCT_APPLICATION',
        targetId: applicationId,
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
      applicationId,
      command.actor.sellerOrganizationId,
    );
    if (!sellerCanAccessStore(
      command.actor,
      source.store_id,
    )) {
      throw new ProductApplicationError(
        'FORBIDDEN',
        403,
      );
    }
    if (source.version !== input.expectedVersion) {
      throw new ProductApplicationError(
        'VERSION_CONFLICT',
        409,
      );
    }
    if (source.status !== 'SUBMITTED') {
      throw new ProductApplicationError(
        'PRODUCT_APPLICATION_ALREADY_REVIEWED',
        409,
      );
    }

    const nextVersion = source.version + 1;
    const response: WithdrawProductApplicationResult = {
      application_id: applicationId,
      status: 'WITHDRAWN',
      application_version: nextVersion,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey:
        `product-application-withdrawn:${applicationId}`,
      eventType: 'PRODUCT_APPLICATION_WITHDRAWN',
      aggregateType: 'PRODUCT_APPLICATION',
      aggregateId: applicationId,
      payload: {
        application_id: applicationId,
        seller_organization_id: source.organization_id,
        store_id: source.store_id,
        status: 'WITHDRAWN',
        application_version: nextVersion,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE product_applications
        SET
          status='WITHDRAWN',
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          withdrawn_at=?,
          review_reason=NULL,
          reviewed_by_staff_id=NULL,
          reviewed_at=NULL,
          product_id=NULL
        WHERE id=?
          AND organization_id=?
          AND status='SUBMITTED'
          AND version=?
      `).bind(
        now,
        now,
        applicationId,
        source.organization_id,
        source.version,
      ),
      insertProductApplicationEventStatement(database, {
        applicationId,
        organizationId: source.organization_id,
        storeId: source.store_id,
        eventType: 'PRODUCT_APPLICATION_WITHDRAWN',
        actorType: 'SELLER_MEMBER',
        actorId: command.actor.memberId,
        previousStatus: 'SUBMITTED',
        nextStatus: 'WITHDRAWN',
        applicationVersion: nextVersion,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'PRODUCT_APPLICATION',
        aggregateId: applicationId,
        eventType: 'PRODUCT_APPLICATION_WITHDRAWN',
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
            application_id: applicationId,
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

    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized =
      normalizeProductApplicationError(error);
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
  applicationId: string,
  organizationId: string,
): Promise<ApplicationSource> {
  const row = await database.prepare(`
    SELECT
      id AS application_id,
      organization_id,
      store_id,
      status,
      version
    FROM product_applications
    WHERE id=?
      AND organization_id=?
  `).bind(
    applicationId,
    organizationId,
  ).first<ApplicationSource>();

  if (!row) {
    throw new ProductApplicationError(
      'PRODUCT_APPLICATION_NOT_FOUND',
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
  response: WithdrawProductApplicationResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM product_applications
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
    response.application_id,
    response.application_version,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
