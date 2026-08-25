import type {
  ProductVersionFields,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  canonicalJson,
  hashCanonicalJson,
  normalizeAsin,
  normalizeProductVersionFields,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import { requireCatalogOrganizationScope } from '../staff-assignment';
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
  requireProductScheduleMaintenance,
  type CatalogStaffActor,
} from './catalog-shared';

interface ProductStoreSource {
  store_id: string;
  organization_id: string;
  marketplace_code: 'AMAZON_JP';
  store_status: string;
  organization_status: string;
}

interface ExistingProductRow {
  id: string;
  store_id: string;
}

export interface CreateApprovedProductResult {
  product_id: string;
  product_version_id: string;
  seller_organization_id: string;
  store_id: string;
  marketplace_code: 'AMAZON_JP';
  asin: string;
  current_version_no: 1;
  product_version: ProductVersionFields;
  status: 'ACTIVE';
  replayed: boolean;
}

export async function createApprovedProduct(
  database: SqlDatabase,
  input: {
    storeId: string;
    asin: string;
    version: ProductVersionFields;
  },
  command: {
    actor: CatalogStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<CreateApprovedProductResult> {
  requireProductScheduleMaintenance(command.actor);

  const storeId = cleanCatalogIdentifier(input.storeId);
  const asin = parseCatalogInput(
    () => normalizeAsin(input.asin),
  );
  const version = parseCatalogInput(
    () => normalizeProductVersionFields(input.version),
  );
  const normalizedVersion: ProductVersionFields = {
    ...version,
    defaultBuyerSelfPayBps: version.defaultBuyerSelfPayBps ?? 0,
  };
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new CatalogError('VALIDATION_ERROR', 400);
  }

  const store = await requireProductStore(database, storeId);
  requireCatalogOrganizationScope(command.actor, store.organization_id);
  const requestHash = await hashCanonicalJson({
    action: 'CREATE_APPROVED_PRODUCT',
    store_id: storeId,
    marketplace_code: store.marketplace_code,
    asin,
    version: normalizedVersion,
  });
  const acquired =
    await acquireIdempotency<CreateApprovedProductResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'CREATE_APPROVED_PRODUCT',
        targetType: 'PRODUCT_ASIN',
        targetId: `${store.marketplace_code}:${asin}`,
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
    await assertAsinAvailable(
      database,
      store,
      asin,
    );

    const productId = crypto.randomUUID();
    const productVersionId = crypto.randomUUID();
    const response: CreateApprovedProductResult = {
      product_id: productId,
      product_version_id: productVersionId,
      seller_organization_id: store.organization_id,
      store_id: store.store_id,
      marketplace_code: store.marketplace_code,
      asin,
      current_version_no: 1,
      product_version: normalizedVersion,
      status: 'ACTIVE',
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `product-created:${productId}`,
      eventType: 'PRODUCT_CREATED',
      aggregateType: 'PRODUCT',
      aggregateId: productId,
      payload: {
        product_id: productId,
        seller_organization_id: store.organization_id,
        store_id: store.store_id,
        marketplace_code: store.marketplace_code,
        asin,
        current_version_no: 1,
        product_name: version.productName,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO products (
          id,
          organization_id,
          store_id,
          marketplace_code,
          asin_display,
          asin_normalized,
          status,
          current_version_no,
          version,
          created_at,
          updated_at,
          disabled_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'ACTIVE', 1, 1, ?, ?, NULL
        )
      `).bind(
        productId,
        store.organization_id,
        store.store_id,
        store.marketplace_code,
        asin,
        asin,
        now,
        now,
      ),
      database.prepare(`
        INSERT INTO product_versions (
          id,
          product_id,
          version_no,
          product_name,
          search_keywords_json,
          ordering_guide_expected_amount_jpy,
          color_spec_mode,
          default_buyer_self_pay_bps,
          order_interval_days,
          orders_per_run,
          product_url,
          buyer_visible_notes,
          internal_notes,
          created_by_staff_id,
          created_at
        ) VALUES (
          ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).bind(
        productVersionId,
        productId,
        version.productName,
        canonicalJson(version.searchKeywords),
        version.orderingGuideExpectedAmountJpy,
        version.colorSpecMode,
        normalizedVersion.defaultBuyerSelfPayBps,
        version.orderIntervalDays,
        version.ordersPerRun,
        version.productUrl,
        version.buyerVisibleNotes,
        version.internalNotes,
        command.actor.staffId,
        now,
      ),
      database.prepare(`
        INSERT INTO product_events (
          id,
          product_id,
          organization_id,
          store_id,
          event_type,
          product_version_no,
          actor_staff_id,
          previous_state_json,
          next_state_json,
          idempotency_key,
          created_at
        ) VALUES (
          ?, ?, ?, ?, 'PRODUCT_CREATED', 1, ?,
          NULL, ?, ?, ?
        )
      `).bind(
        crypto.randomUUID(),
        productId,
        store.organization_id,
        store.store_id,
        command.actor.staffId,
        canonicalJson({
          status: 'ACTIVE',
          current_version_no: 1,
          product_version_id: productVersionId,
        }),
        acquired.claim.idempotencyKey,
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'PRODUCT',
        aggregateId: productId,
        eventType: 'PRODUCT_CREATED',
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
            product_id: productId,
            product_version_id: productVersionId,
          },
          now,
        },
      ),
      assertProductCreatedStatement(
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

async function requireProductStore(
  database: SqlDatabase,
  storeId: string,
): Promise<ProductStoreSource> {
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
  `).bind(storeId).first<ProductStoreSource>();

  if (!row) {
    throw new CatalogError('STORE_NOT_FOUND', 404);
  }
  if (row.store_status !== 'ACTIVE'
    || row.organization_status !== 'ACTIVE') {
    throw new CatalogError('VALIDATION_ERROR', 409);
  }
  return row;
}

async function assertAsinAvailable(
  database: SqlDatabase,
  store: ProductStoreSource,
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
  ).first<ExistingProductRow>();

  if (!existing) return;
  if (existing.store_id === store.store_id) {
    throw new CatalogError('DUPLICATE_PRODUCT', 409);
  }
  throw new CatalogError('ASIN_STORE_CONFLICT', 409);
}

function assertProductCreatedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: CreateApprovedProductResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM products
        WHERE id=?
          AND organization_id=?
          AND store_id=?
          AND marketplace_code=?
          AND asin_normalized=?
          AND status='ACTIVE'
          AND current_version_no=1
          AND version=1
      )
      AND EXISTS (
        SELECT 1
        FROM product_versions
        WHERE id=?
          AND product_id=?
          AND version_no=1
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
    response.product_id,
    response.seller_organization_id,
    response.store_id,
    response.marketplace_code,
    response.asin,
    response.product_version_id,
    response.product_id,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
