import type {
  ProductVersionFields,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  canonicalJson,
  hashCanonicalJson,
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

interface ProductSource {
  product_id: string;
  organization_id: string;
  store_id: string;
  marketplace_code: string;
  asin_normalized: string;
  product_status: string;
  current_version_no: number;
  product_version: number;
  store_status: string;
  organization_status: string;
  current_default_buyer_self_pay_bps: number;
}

export interface AddProductVersionResult {
  product_id: string;
  product_version_id: string;
  version_no: number;
  product_version: ProductVersionFields;
  aggregate_version: number;
  replayed: boolean;
}

export async function addProductVersion(
  database: SqlDatabase,
  input: {
    productId: string;
    expectedVersion: number;
    version: ProductVersionFields;
  },
  command: {
    actor: CatalogStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<AddProductVersionResult> {
  requireProductScheduleMaintenance(command.actor);

  const productId = cleanCatalogIdentifier(input.productId);
  if (!Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1) {
    throw new CatalogError('VALIDATION_ERROR', 400);
  }
  const version = parseCatalogInput(
    () => normalizeProductVersionFields(input.version),
  );
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new CatalogError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'ADD_PRODUCT_VERSION',
    product_id: productId,
    expected_version: input.expectedVersion,
    version,
  });
  const acquired =
    await acquireIdempotency<AddProductVersionResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'ADD_PRODUCT_VERSION',
        targetType: 'PRODUCT',
        targetId: productId,
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
    const source = await requireProductSource(
      database,
      productId,
    );
    requireCatalogOrganizationScope(command.actor, source.organization_id);
    if (source.product_version !== input.expectedVersion) {
      throw new CatalogError('VERSION_CONFLICT', 409);
    }

    const defaultBuyerSelfPayBps =
      version.defaultBuyerSelfPayBps
      ?? Number(source.current_default_buyer_self_pay_bps);
    if (!Number.isSafeInteger(defaultBuyerSelfPayBps)
      || defaultBuyerSelfPayBps < 0
      || defaultBuyerSelfPayBps > 10_000) {
      throw new CatalogError('VALIDATION_ERROR', 400);
    }
    const normalizedVersion = {
      ...version,
      defaultBuyerSelfPayBps,
    };

    const nextVersionNo =
      Number(source.current_version_no) + 1;
    const nextAggregateVersion =
      Number(source.product_version) + 1;
    const productVersionId = crypto.randomUUID();
    const response: AddProductVersionResult = {
      product_id: productId,
      product_version_id: productVersionId,
      version_no: nextVersionNo,
      product_version: normalizedVersion,
      aggregate_version: nextAggregateVersion,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `product-version-added:${productId}:${nextVersionNo}`,
      eventType: 'PRODUCT_VERSION_ADDED',
      aggregateType: 'PRODUCT',
      aggregateId: productId,
      payload: {
        product_id: productId,
        product_version_id: productVersionId,
        version_no: nextVersionNo,
        aggregate_version: nextAggregateVersion,
        product_name: version.productName,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE products
        SET
          current_version_no=?,
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND status='ACTIVE'
          AND current_version_no=?
          AND version=?
      `).bind(
        nextVersionNo,
        now,
        productId,
        source.current_version_no,
        input.expectedVersion,
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
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).bind(
        productVersionId,
        productId,
        nextVersionNo,
        version.productName,
        canonicalJson(version.searchKeywords),
        version.orderingGuideExpectedAmountJpy,
        version.colorSpecMode,
        defaultBuyerSelfPayBps,
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
          ?, ?, ?, ?, 'PRODUCT_VERSION_ADDED', ?, ?,
          ?, ?, ?, ?
        )
      `).bind(
        crypto.randomUUID(),
        productId,
        source.organization_id,
        source.store_id,
        nextVersionNo,
        command.actor.staffId,
        canonicalJson({
          current_version_no: source.current_version_no,
          aggregate_version: source.product_version,
        }),
        canonicalJson({
          current_version_no: nextVersionNo,
          aggregate_version: nextAggregateVersion,
          product_version_id: productVersionId,
        }),
        acquired.claim.idempotencyKey,
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'PRODUCT',
        aggregateId: productId,
        eventType: 'PRODUCT_VERSION_ADDED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          current_version_no: source.current_version_no,
          aggregate_version: source.product_version,
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
            product_id: productId,
            product_version_id: productVersionId,
            version_no: nextVersionNo,
          },
          now,
        },
      ),
      assertProductVersionAddedStatement(
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

async function requireProductSource(
  database: SqlDatabase,
  productId: string,
): Promise<ProductSource> {
  const row = await database.prepare(`
    SELECT
      product.id AS product_id,
      product.organization_id,
      product.store_id,
      product.marketplace_code,
      product.asin_normalized,
      product.status AS product_status,
      product.current_version_no,
      product.version AS product_version,
      current_version.default_buyer_self_pay_bps
        AS current_default_buyer_self_pay_bps,
      store.status AS store_status,
      organization.status AS organization_status
    FROM products product
    JOIN product_versions current_version
      ON current_version.product_id=product.id
      AND current_version.version_no=product.current_version_no
    JOIN seller_stores store
      ON store.id=product.store_id
      AND store.organization_id=product.organization_id
    JOIN seller_organizations organization
      ON organization.id=product.organization_id
    WHERE product.id=?
  `).bind(productId).first<ProductSource>();

  if (!row) {
    throw new CatalogError('PRODUCT_NOT_FOUND', 404);
  }
  if (row.product_status !== 'ACTIVE'
    || row.store_status !== 'ACTIVE'
    || row.organization_status !== 'ACTIVE') {
    throw new CatalogError('VALIDATION_ERROR', 409);
  }
  return row;
}

function assertProductVersionAddedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: AddProductVersionResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM products
        WHERE id=?
          AND current_version_no=?
          AND version=?
      )
      AND EXISTS (
        SELECT 1
        FROM product_versions
        WHERE id=?
          AND product_id=?
          AND version_no=?
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
    response.version_no,
    response.aggregate_version,
    response.product_version_id,
    response.product_id,
    response.version_no,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
