import type {
  FileActor,
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
import type { FileAuthorizationService } from '../files/authorization';
import { createExplicitAudienceFileLinkStatements } from '../files/explicit-audience-links';
import {
  batchWithAssignmentRetry,
  prepareDirectWorkItem,
} from '../staff-assignment';
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
  marketplace_code: 'AMAZON_JP';
  store_status: string;
  organization_status: string;
}

interface ExistingProduct {
  id: string;
  store_id: string;
}

interface ProductApplicationImageFile {
  fileObjectId: string;
  expectedFileVersion: number;
}

export interface SubmitProductApplicationResult {
  application_id: string;
  seller_organization_id: string;
  store_id: string;
  marketplace_code: 'AMAZON_JP';
  asin: string;
  status: 'SUBMITTED';
  version: 1;
  replayed: boolean;
}

export async function submitProductApplication(
  database: SqlDatabase,
  fileAuthorization: FileAuthorizationService,
  input: {
    storeId: string;
    asin: string;
    product: ProductDescriptiveFields;
    sellerNotes: string | null;
    orderingGuideExpectedAmountJpy: number;
    imageFiles: readonly ProductApplicationImageFile[];
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
  const orderingGuideExpectedAmountJpy =
    input.orderingGuideExpectedAmountJpy;
  if (!Number.isSafeInteger(orderingGuideExpectedAmountJpy)
    || orderingGuideExpectedAmountJpy < 1) {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }
  const imageFiles = normalizeImageFiles(input.imageFiles);
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
    ordering_guide_expected_amount_jpy:
      orderingGuideExpectedAmountJpy,
    image_files: imageFiles,
  });
  const targetHash = await hashCanonicalJson({
    marketplace_code: 'AMAZON_JP',
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
    // The application/product business tables are JP-only today
    // (marketplaces(code) has a single 'AMAZON_JP' row; product commands type
    // marketplace_code as 'AMAZON_JP'). A store on any other marketplace exists at
    // the catalog level, but its product application cannot be persisted -
    // reject it explicitly instead of failing the FK inside the batch.
    if (store.marketplace_code !== 'AMAZON_JP') {
      throw new ProductApplicationError(
        'MARKETPLACE_NOT_SUPPORTED',
        409,
      );
    }
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
    await assertImagesUnused(database, imageFiles);

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
    const fileActor: FileActor = {
      type: 'SELLER_MEMBER', id: command.actor.memberId, roles: [command.actor.role],
    };
    const preparedImages = await Promise.all(imageFiles.map(async (image) => {
      const prepared = await createExplicitAudienceFileLinkStatements(
        database,
        fileAuthorization,
        {
          fileObjectId: image.fileObjectId,
          expectedFileVersion: image.expectedFileVersion,
          entityType: 'PRODUCT_APPLICATION',
          entityId: applicationId,
          grants: [
            { subjectType: 'SELLER_ORGANIZATION', sellerOrganizationId: store.organization_id },
            { subjectType: 'STAFF_INTERNAL', permissionCode: 'PRODUCT_VIEW', scope: { type: 'GLOBAL' } },
          ],
        },
        { actor: fileActor, idempotencyKey: acquired.claim.idempotencyKey, requestId: command.requestId ?? null, now },
      );
      if (prepared.result.purpose !== 'PRODUCT_APPLICATION_IMAGE'
        || prepared.result.visibility !== 'SELLER_VISIBLE') {
        throw new ProductApplicationError('VALIDATION_ERROR', 400);
      }
      return prepared;
    }));


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
          ordering_guide_expected_amount_jpy,
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
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
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
        orderingGuideExpectedAmountJpy,
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
      ...preparedImages.flatMap((image) => image.statements),
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
          image_file_object_ids: imageFiles.map((image) => image.fileObjectId),
        },
        createdAt: now,
      }),
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
        imageFiles.map((image) => image.fileObjectId),
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await batchWithAssignmentRetry(
      database,
      () => prepareDirectWorkItem(database, {
        workType: 'PRODUCT_APPLICATION_REVIEW',
        sourceEntityType: 'PRODUCT_APPLICATION',
        sourceEntityId: applicationId,
        marketplaceCode: store.marketplace_code,
        sellerOrganizationId: store.organization_id,
        storeId: store.store_id,
        actorType: 'SYSTEM',
        actorId: `seller-member:${command.actor.memberId}`,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        reason: 'product application submitted',
        now,
      }),
      statements,
    );
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

function normalizeImageFiles(
  value: readonly ProductApplicationImageFile[],
): readonly ProductApplicationImageFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new ProductApplicationError('VALIDATION_ERROR', 400);
  }
  const files = value.map((file) => ({
    fileObjectId: cleanApplicationIdentifier(file.fileObjectId),
    expectedFileVersion: file.expectedFileVersion,
  })).sort((left, right) => left.fileObjectId.localeCompare(right.fileObjectId));
  if (files.some((file) => !Number.isSafeInteger(file.expectedFileVersion)
    || file.expectedFileVersion < 1)
    || new Set(files.map((file) => file.fileObjectId)).size !== files.length) {
    throw new ProductApplicationError('VALIDATION_ERROR', 400);
  }
  return Object.freeze(files);
}

async function assertImagesUnused(
  database: SqlDatabase,
  files: readonly ProductApplicationImageFile[],
): Promise<void> {
  const row = await database.prepare(`
    SELECT 1 AS conflict
    FROM file_entity_links
    WHERE file_object_id IN (${files.map(() => '?').join(', ')})
    LIMIT 1
  `).bind(...files.map((file) => file.fileObjectId)).first<{ conflict: number }>();
  if (row) throw new ProductApplicationError('PRODUCT_APPLICATION_CONFLICT', 409);
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
  imageFileObjectIds: readonly string[],
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
        FROM file_entity_links
        WHERE entity_type='PRODUCT_APPLICATION'
          AND entity_id=?
        GROUP BY entity_id
        HAVING COUNT(*)=?
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
    response.application_id,
    imageFileObjectIds.length,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
