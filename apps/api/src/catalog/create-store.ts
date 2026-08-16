import type {
  MarketplaceCode,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  hashCanonicalJson,
  normalizeStoreName,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import { requireMarketplaceScope } from '../staff-assignment';
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
  CatalogError,
  cleanCatalogIdentifier,
  normalizeCatalogError,
  parseCatalogInput,
  requireCatalogPermission,
  type CatalogStaffActor,
} from './catalog-shared';
import {
  legacyMarketplaceProjection,
  resolveMarketplace,
} from '../marketplaces/registry';

interface SellerOrganizationRow {
  id: string;
  status: string;
}

export interface CreateSellerStoreResult {
  store_id: string;
  seller_organization_id: string;
  marketplace_code: MarketplaceCode;
  display_name: string;
  status: 'ACTIVE';
  version: 1;
  replayed: boolean;
}

export async function createSellerStore(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    marketplaceCode: MarketplaceCode;
    storeName: string;
  },
  command: {
    actor: CatalogStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<CreateSellerStoreResult> {
  requireCatalogPermission(command.actor, 'SELLER_MANAGE');

  const organizationId = cleanCatalogIdentifier(
    input.sellerOrganizationId,
  );
  const marketplace = await resolveMarketplace(
    database,
    input.marketplaceCode,
    { requireActive: true, requireAdapter: true },
  );
  // Reject out-of-scope store creation: the actor's data scope must include
  // the target marketplace. Marketplace codes come from
  // staff_marketplace_scopes and do not depend on existing stores, so a
  // brand-new organization without stores is not falsely blocked. Missing
  // dataScope is treated as forbidden.
  if (!command.actor.dataScope) {
    throw new CatalogError('FORBIDDEN', 403);
  }
  requireMarketplaceScope(command.actor.dataScope, marketplace.code);
  const storeName = parseCatalogInput(
    () => normalizeStoreName(input.storeName),
  );
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new CatalogError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'CREATE_SELLER_STORE',
    seller_organization_id: organizationId,
    marketplace_code: input.marketplaceCode,
    normalized_store_name: storeName.normalized,
  });
  const targetHash = await hashCanonicalJson({
    seller_organization_id: organizationId,
    marketplace_code: input.marketplaceCode,
    normalized_store_name: storeName.normalized,
  });

  const acquired =
    await acquireIdempotency<CreateSellerStoreResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'CREATE_SELLER_STORE',
        targetType: 'SELLER_STORE',
        targetId: `seller-store:${targetHash}`,
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
    await requireActiveSellerOrganization(database, organizationId);

    const existing = await database.prepare(`
      SELECT id
      FROM seller_stores store
      JOIN seller_store_marketplaces scope ON scope.store_id=store.id
      WHERE store.organization_id=?
        AND scope.marketplace_code=?
        AND normalized_name=?
      LIMIT 1
    `).bind(
      organizationId,
      marketplace.code,
      storeName.normalized,
    ).first<{ id: string }>();
    if (existing) {
      throw new CatalogError('DUPLICATE_STORE', 409);
    }

    const storeId = crypto.randomUUID();
    const response: CreateSellerStoreResult = {
      store_id: storeId,
      seller_organization_id: organizationId,
      marketplace_code: input.marketplaceCode,
      display_name: storeName.display,
      status: 'ACTIVE',
      version: 1,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `seller-store-created:${storeId}`,
      eventType: 'SELLER_STORE_CREATED',
      aggregateType: 'SELLER_STORE',
      aggregateId: storeId,
      payload: {
        store_id: storeId,
        seller_organization_id: organizationId,
        marketplace_code: input.marketplaceCode,
        display_name: storeName.display,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO seller_stores (
          id,
          organization_id,
          marketplace_code,
          display_name,
          normalized_name,
          status,
          version,
          created_at,
          updated_at,
          disabled_at
        ) VALUES (
          ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, NULL
        )
      `).bind(
        storeId,
        organizationId,
        legacyMarketplaceProjection(),
        storeName.display,
        storeName.normalized,
        now,
        now,
      ),
      database.prepare(`
        UPDATE seller_store_marketplaces
        SET marketplace_code=?
        WHERE store_id=? AND seller_organization_id=?
      `).bind(marketplace.code, storeId, organizationId),
      database.prepare(`
        INSERT INTO seller_store_events (
          id,
          store_id,
          organization_id,
          event_type,
          actor_staff_id,
          previous_state_json,
          next_state_json,
          idempotency_key,
          created_at
        ) VALUES (
          ?, ?, ?, 'STORE_CREATED', ?,
          NULL, ?, ?, ?
        )
      `).bind(
        crypto.randomUUID(),
        storeId,
        organizationId,
        command.actor.staffId,
        JSON.stringify({
          status: 'ACTIVE',
          version: 1,
        }),
        acquired.claim.idempotencyKey,
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_STORE',
        aggregateId: storeId,
        eventType: 'SELLER_STORE_CREATED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
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
            store_id: storeId,
          },
          now,
        },
      ),
      assertStoreCreatedStatement(
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
    const normalized = normalizeCatalogError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

async function requireActiveSellerOrganization(
  database: SqlDatabase,
  organizationId: string,
): Promise<SellerOrganizationRow> {
  const row = await database.prepare(`
    SELECT id, status
    FROM seller_organizations
    WHERE id=?
  `).bind(organizationId).first<SellerOrganizationRow>();

  if (!row) throw new CatalogError('NOT_FOUND', 404);
  if (row.status !== 'ACTIVE') {
    throw new CatalogError('VALIDATION_ERROR', 409);
  }
  return row;
}

function assertStoreCreatedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: CreateSellerStoreResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM seller_stores
        JOIN seller_store_marketplaces scope
          ON scope.store_id=seller_stores.id
        WHERE seller_stores.id=?
          AND seller_stores.organization_id=?
          AND scope.marketplace_code=CASE
            WHEN ?='JP' THEN 'AMAZON_JP' ELSE ? END
          AND seller_stores.status='ACTIVE'
          AND seller_stores.version=1
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
    response.store_id,
    response.seller_organization_id,
    response.marketplace_code,
    response.marketplace_code,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
