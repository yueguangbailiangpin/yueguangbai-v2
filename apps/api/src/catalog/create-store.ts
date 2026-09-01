import type {
  MarketplaceCode,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  canCreateSellerStore,
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
  CatalogError,
  cleanCatalogIdentifier,
  normalizeCatalogError,
  parseCatalogInput,
  requireCatalogPermission,
  type CatalogSellerStoreActor,
  type CatalogStaffActor,
} from './catalog-shared';
import {
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
    actor: CatalogStaffActor | CatalogSellerStoreActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<CreateSellerStoreResult> {
  const staffActor = isStaffActor(command.actor) ? command.actor : null;
  const sellerActor: CatalogSellerStoreActor | null = staffActor
    ? null
    : command.actor as CatalogSellerStoreActor;
  if (staffActor) {
    requireCatalogPermission(staffActor, 'SELLER_MANAGE');
  } else if (
    sellerActor!.sellerOrganizationId !== input.sellerOrganizationId
    || !canCreateSellerStore(sellerActor!.role)
  ) {
    throw new CatalogError('FORBIDDEN', 403);
  }

  const organizationId = cleanCatalogIdentifier(
    input.sellerOrganizationId,
  );
  const marketplace = await resolveMarketplace(
    database,
    input.marketplaceCode,
    { requireActive: true, requireAdapter: true },
  );
  // The business layer is JP-only today: seller_stores/products/
  // demand_batches reference marketplaces(code), which admits a single 'AMAZON_JP'
  // row, and product commands type marketplace_code as 'AMAZON_JP'. The old code
  // hardcoded the JP legacy projection for every store, so an AMAZON_US
  // store was silently stored as 'AMAZON_JP' and its product applications entered
  // the JP conflict check. Reject non-JP store creation loudly until the
  // business tables are migrated to canonical marketplace codes.
  if (marketplace.code !== 'AMAZON_JP') {
    throw new CatalogError('MARKETPLACE_NOT_SUPPORTED', 409);
  }
  // Reject out-of-scope store creation: the actor's data scope must include
  // the target marketplace. Marketplace codes come from
  // staff_marketplace_scopes and do not depend on existing stores, so a
  // brand-new organization without stores is not falsely blocked. A missing
  // dataScope matches resolveStaffDataScope semantics: owner roles are GLOBAL
  // (unrestricted), any other role without a scope is forbidden.
  if (staffActor?.dataScope) {
    requireMarketplaceScope(staffActor.dataScope, marketplace.code);
  } else if (staffActor && !staffActor.roles.includes('owner')) {
    throw new CatalogError('FORBIDDEN', 403);
  }
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
        actorType: staffActor ? 'STAFF' : 'SELLER_MEMBER',
        actorId: staffActor?.staffId ?? sellerActor!.memberId,
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
        'AMAZON_JP',
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
      // seller_store_events is a legacy Staff-only ledger because its actor
      // column has a NOT NULL foreign key to staff_users. Seller self-service
      // remains immutable and attributable through audit_events below.
      ...(staffActor ? [database.prepare(`
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
        staffActor.staffId,
        JSON.stringify({
          status: 'ACTIVE',
          version: 1,
        }),
        acquired.claim.idempotencyKey,
        now,
      )] : []),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_STORE',
        aggregateId: storeId,
        eventType: 'SELLER_STORE_CREATED',
        actor: {
          type: staffActor ? 'STAFF' : 'SELLER_MEMBER',
          id: staffActor?.staffId ?? sellerActor!.memberId,
          roles: staffActor?.roles ?? [sellerActor!.role],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
        nextState: response,
        createdAt: now,
      }),
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

function isStaffActor(
  actor: CatalogStaffActor | CatalogSellerStoreActor,
): actor is CatalogStaffActor {
  return 'staffId' in actor;
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
            WHEN ?='AMAZON_JP' THEN 'AMAZON_JP' ELSE ? END
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
