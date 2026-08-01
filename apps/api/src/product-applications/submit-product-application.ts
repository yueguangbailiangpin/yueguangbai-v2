import type {
  ProductDescriptiveFields,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  hashCanonicalJson,
  normalizeAsin,
  normalizeProductDescriptiveFields,
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
  cleanOptionalSellerNotes,
  insertProductApplicationEventStatement,
  normalizeProductApplicationError,
  parseApplicationProductFields,
  productVersionSnapshot,
  requireSellerCanSubmitProducts,
  sellerCanAccessStore,
  ProductApplicationError,
  type SellerProductApplicationActor,
} from './product-application-shared';

interface StoreSource {
  store_id: string;
  organization_id: string;
  marketplace_code: 'JP';
  store_status: string;
  organization_status: string;
}

interface ExistingProduct {
  id: string;
  store_id: string;
}

export interface SubmitProductApplicationResult {
  application_id: string;
  seller_organization_id: string;
  store_id: string;
  marketplace_code: 'JP';
  asin: string;
  status: 'SUBMITTED';
  version: 1;
  replayed: boolean;
}

export async function submitProductApplication(
  database: SqlDatabase,
  input: {
    storeId: string;
    asin: string;
    product: ProductDescriptiveFields;
    sellerNotes: string | null;
  },
  command: {
    actor: SellerProductApplicationActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<SubmitProductApplicationResult> {
  requireSellerCanSubmitProducts(command.actor);

  const storeId = cleanApplicationIdentifier(input.storeId);
  if (!sellerCanAccessStore(command.actor, storeId)) {
    throw new ProductApplicationError('FORBIDDEN', 403);
  }

  const asin = (() => {
    try {
      return normalizeAsin(input.asin);
    } catch {
      throw new ProductApplicationError(
        'VALIDATION_ERROR',
        400,
      );
    }
  })();
  const product = parseApplicationProductFields(
    () => normalizeProductDescriptiveFields(input.product),
  );
  if (product.internalNotes !== null) {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }
  const sellerNotes = cleanOptionalSellerNotes(
    input.sellerNotes,
  );
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }

  const requestHash = await hashCanonicalJson({
    action: 'SUBMIT_PRODUCT_APPLICATION',
    seller_organization_id:
      command.actor.sellerOrganizationId,
    store_id: storeId,
    asin,
    product,
    seller_notes: sellerNotes,
  });
  const targetHash = await hashCanonicalJson({
    marketplace_code: 'JP',
    asin,
  });

  const acquired =
    await acquireIdempotency<SubmitProductApplicationResult>(
      database,
      {
        actorType: 'SELLER_MEMBER',
        actorId: command.actor.memberId,
        action: 'SUBMIT_PRODUCT_APPLICATION',
        targetType: 'PRODUCT_APPLICATION_ASIN',
        targetId: `product-application:${targetHash}`,
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
    const store = await requireStore(
      database,
      storeId,
      command.actor.sellerOrganizationId,
    );
    await assertNoFormalProduct(
      database,
      store,
      asin,
    );
    await assertNoSubmittedApplication(
      database,
      store.marketplace_code,
      asin,
    );

    const applicationId = crypto.randomUUID();
    const response: SubmitProductApplicationResult = {
      application_id: applicationId,
      seller_organization_id: store.organization_id,
      store_id: store.store_id,
      marketplace_code: store.marketplace_code,
      asin,
      status: 'SUBMITTED',
      version: 1,
      replayed: false,
    };
    const snapshot = productVersionSnapshot(product);

    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `product-application-submitted:${applicationId}`,
      eventType: 'PRODUCT_APPLICATION_SUBMITTED',
      aggregateType: 'PRODUCT_APPLICATION',
      aggregateId: applicationId,
      payload: {
        application_id: applicationId,
        seller_organization_id: store.organization_id,
        store_id: store.store_id,
        marketplace_code: store.marketplace_code,
        asin,
        product_name: snapshot.product_name,
        status: 'SUBMITTED',
        version: 1,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO product_applications (
          id,
          organization_id,
          store_id,
          marketplace_code,
          submitted_by_member_id,
          asin_display,
          asin_normalized,
          product_name,
          search_keywords_json,
          product_url,
          buyer_visible_notes,
          seller_notes,
          status,
          review_reason,
          reviewed_by_staff_id,
          product_id,
          version,
          submitted_at,
          updated_at,
          reviewed_at,
          withdrawn_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'SUBMITTED', NULL, NULL, NULL, 1, ?, ?, NULL, NULL
        )
      `).bind(
        applicationId,
        store.organization_id,
        store.store_id,
        store.marketplace_code,
        command.actor.memberId,
        asin,
        asin,
        snapshot.product_name,
        snapshot.search_keywords_json,
        snapshot.product_url,
        snapshot.buyer_visible_notes,
        sellerNotes,
        now,
        now,
      ),
      insertProductApplicationEventStatement(database, {
        applicationId,
        organizationId: store.organization_id,
        storeId: store.store_id,
        eventType: 'PRODUCT_APPLICATION_SUBMITTED',
        actorType: 'SELLER_MEMBER',
        actorId: command.actor.memberId,
        previousStatus: null,
        nextStatus: 'SUBMITTED',
        applicationVersion: 1,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'PRODUCT_APPLICATION',
        aggregateId: applicationId,
        eventType: 'PRODUCT_APPLICATION_SUBMITTED',
        actor: {
          type: 'SELLER_MEMBER',
          id: command.actor.memberId,
          roles: [command.actor.role],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
        nextState: {
          ...response,
          product,
          seller_notes: sellerNotes,
        },
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
      assertSubmittedStatement(
        database,
        acquired.claim,
        response,
        command.actor.memberId,
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

async function requireStore(
  database: SqlDatabase,
  storeId: string,
  organizationId: string,
): Promise<StoreSource> {
  const row = await database.prepare(`
    SELECT
      store.id AS store_id,
      store.organization_id,
      store.marketplace_code,
      store.status AS store_status,
      organization.status AS organization_status
    FROM seller_stores store
    JOIN seller_organizations organization
      ON organization.id=store.organization_id
    WHERE store.id=?
      AND store.organization_id=?
  `).bind(
    storeId,
    organizationId,
  ).first<StoreSource>();

  if (!row) {
    throw new ProductApplicationError(
      'STORE_NOT_FOUND',
      404,
    );
  }
  if (row.store_status !== 'ACTIVE'
    || row.organization_status !== 'ACTIVE') {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      409,
    );
  }
  return row;
}

async function assertNoFormalProduct(
  database: SqlDatabase,
  store: StoreSource,
  asin: string,
): Promise<void> {
  const existing = await database.prepare(`
    SELECT id, store_id
    FROM products
    WHERE marketplace_code=?
      AND asin_normalized=?
    LIMIT 1
  `).bind(
    store.marketplace_code,
    asin,
  ).first<ExistingProduct>();

  if (!existing) return;
  if (existing.store_id === store.store_id) {
    throw new ProductApplicationError(
      'DUPLICATE_PRODUCT',
      409,
    );
  }
  throw new ProductApplicationError(
    'ASIN_STORE_CONFLICT',
    409,
  );
}

async function assertNoSubmittedApplication(
  database: SqlDatabase,
  marketplaceCode: string,
  asin: string,
): Promise<void> {
  const existing = await database.prepare(`
    SELECT id
    FROM product_applications
    WHERE marketplace_code=?
      AND asin_normalized=?
      AND status='SUBMITTED'
    LIMIT 1
  `).bind(
    marketplaceCode,
    asin,
  ).first<{ id: string }>();

  if (existing) {
    throw new ProductApplicationError(
      'PRODUCT_APPLICATION_CONFLICT',
      409,
    );
  }
}

function assertSubmittedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: SubmitProductApplicationResult,
  memberId: string,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM product_applications
        WHERE id=?
          AND organization_id=?
          AND store_id=?
          AND submitted_by_member_id=?
          AND marketplace_code=?
          AND asin_normalized=?
          AND status='SUBMITTED'
          AND version=1
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
    response.seller_organization_id,
    response.store_id,
    memberId,
    response.marketplace_code,
    response.asin,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
