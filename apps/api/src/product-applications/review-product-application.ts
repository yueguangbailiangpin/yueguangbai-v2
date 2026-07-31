import type {
  ProductApplicationReviewDecision,
  ProductVersionFields,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  isProductApplicationReviewDecision,
} from '@ygb/contracts';
import {
  canonicalJson,
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
  cleanReviewReason,
  insertProductApplicationEventStatement,
  normalizeProductApplicationError,
  requireProductReviewPermission,
  ProductApplicationError,
  type ProductApplicationStaffActor,
} from './product-application-shared';

interface ApplicationSource {
  application_id: string;
  organization_id: string;
  store_id: string;
  marketplace_code: 'JP';
  asin_normalized: string;
  product_name: string;
  search_keywords_json: string;
  product_url: string | null;
  buyer_visible_notes: string | null;
  seller_notes: string | null;
  status: string;
  application_version: number;
  store_status: string;
  organization_status: string;
}

interface ExistingProduct {
  id: string;
  store_id: string;
}

export interface ReviewProductApplicationResult {
  application_id: string;
  status: 'APPROVED' | 'REJECTED';
  application_version: number;
  product_id: string | null;
  product_version_id: string | null;
  review_reason: string | null;
  replayed: boolean;
}

export async function reviewProductApplication(
  database: SqlDatabase,
  input: {
    applicationId: string;
    expectedVersion: number;
    decision: ProductApplicationReviewDecision;
    rejectionReason?: string | null;
  },
  command: {
    actor: ProductApplicationStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ReviewProductApplicationResult> {
  requireProductReviewPermission(command.actor);

  const applicationId = cleanApplicationIdentifier(
    input.applicationId,
  );
  if (!Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1
    || !isProductApplicationReviewDecision(input.decision)) {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }

  const rejectionReason = input.decision === 'REJECT'
    ? cleanReviewReason(input.rejectionReason)
    : null;
  if (input.decision === 'APPROVE'
    && input.rejectionReason != null
    && input.rejectionReason.trim().length > 0) {
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
    action: 'REVIEW_PRODUCT_APPLICATION',
    application_id: applicationId,
    expected_version: input.expectedVersion,
    decision: input.decision,
    rejection_reason: rejectionReason,
  });

  const acquired =
    await acquireIdempotency<ReviewProductApplicationResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'REVIEW_PRODUCT_APPLICATION',
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
    const source = await requireReviewSource(
      database,
      applicationId,
    );
    if (source.application_version
      !== input.expectedVersion) {
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

    const result = input.decision === 'APPROVE'
      ? await buildApproval(
          database,
          source,
          command,
          acquired.claim.idempotencyKey,
          now,
        )
      : await buildRejection(
          database,
          source,
          requireRejectionReason(rejectionReason),
          command,
          acquired.claim.idempotencyKey,
          now,
        );

    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey:
        `product-application-reviewed:${applicationId}`,
      eventType:
        input.decision === 'APPROVE'
          ? 'PRODUCT_APPLICATION_APPROVED'
          : 'PRODUCT_APPLICATION_REJECTED',
      aggregateType: 'PRODUCT_APPLICATION',
      aggregateId: applicationId,
      payload: {
        application_id: applicationId,
        seller_organization_id: source.organization_id,
        store_id: source.store_id,
        asin: source.asin_normalized,
        status: result.response.status,
        application_version:
          result.response.application_version,
        product_id: result.response.product_id,
        review_reason: result.response.review_reason,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      ...result.statements,
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'PRODUCT_APPLICATION',
        aggregateId: applicationId,
        eventType:
          input.decision === 'APPROVE'
            ? 'PRODUCT_APPLICATION_APPROVED'
            : 'PRODUCT_APPLICATION_REJECTED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: source.status,
          version: source.application_version,
        },
        nextState: result.response,
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        result.response,
        {
          resultReferences: {
            application_id: applicationId,
            product_id: result.response.product_id,
            product_version_id:
              result.response.product_version_id,
          },
          now,
        },
      ),
      assertReviewCompletedStatement(
        database,
        acquired.claim,
        result.response,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await database.batch(statements);
    return result.response;
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


function requireRejectionReason(
  value: string | null,
): string {
  if (value === null) {
    throw new ProductApplicationError(
      'VALIDATION_ERROR',
      400,
    );
  }
  return value;
}

async function buildApproval(
  database: SqlDatabase,
  source: ApplicationSource,
  command: {
    actor: ProductApplicationStaffActor;
  },
  idempotencyKey: string,
  now: number,
): Promise<{
  response: ReviewProductApplicationResult;
  statements: SqlStatement[];
}> {
  await assertAsinAvailableForApproval(
    database,
    source,
  );

  const productId = crypto.randomUUID();
  const productVersionId = crypto.randomUUID();
  const nextVersion = source.application_version + 1;
  const response: ReviewProductApplicationResult = {
    application_id: source.application_id,
    status: 'APPROVED',
    application_version: nextVersion,
    product_id: productId,
    product_version_id: productVersionId,
    review_reason: null,
    replayed: false,
  };

  const version: ProductVersionFields = {
    productName: source.product_name,
    searchKeywords: parseKeywords(
      source.search_keywords_json,
    ),
    productUrl: source.product_url,
    buyerVisibleNotes: source.buyer_visible_notes,
    internalNotes: source.seller_notes,
  };

  return {
    response,
    statements: [
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
        source.organization_id,
        source.store_id,
        source.marketplace_code,
        source.asin_normalized,
        source.asin_normalized,
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
          product_url,
          buyer_visible_notes,
          internal_notes,
          created_by_staff_id,
          created_at
        ) VALUES (
          ?, ?, 1, ?, ?, ?, ?, ?, ?, ?
        )
      `).bind(
        productVersionId,
        productId,
        version.productName,
        canonicalJson(version.searchKeywords),
        version.productUrl,
        version.buyerVisibleNotes,
        version.internalNotes,
        command.actor.staffId,
        now,
      ),
      database.prepare(`
        UPDATE product_applications
        SET
          status='APPROVED',
          review_reason=NULL,
          reviewed_by_staff_id=?,
          product_id=?,
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          reviewed_at=?,
          withdrawn_at=NULL
        WHERE id=?
          AND status='SUBMITTED'
          AND version=?
      `).bind(
        command.actor.staffId,
        productId,
        now,
        now,
        source.application_id,
        source.application_version,
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
        source.organization_id,
        source.store_id,
        command.actor.staffId,
        canonicalJson({
          status: 'ACTIVE',
          current_version_no: 1,
          product_version_id: productVersionId,
          source_application_id: source.application_id,
        }),
        idempotencyKey,
        now,
      ),
      insertProductApplicationEventStatement(database, {
        applicationId: source.application_id,
        organizationId: source.organization_id,
        storeId: source.store_id,
        eventType: 'PRODUCT_APPLICATION_APPROVED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousStatus: 'SUBMITTED',
        nextStatus: 'APPROVED',
        applicationVersion: nextVersion,
        productId,
        idempotencyKey,
        createdAt: now,
      }),
    ],
  };
}

async function buildRejection(
  database: SqlDatabase,
  source: ApplicationSource,
  rejectionReason: string,
  command: {
    actor: ProductApplicationStaffActor;
  },
  idempotencyKey: string,
  now: number,
): Promise<{
  response: ReviewProductApplicationResult;
  statements: SqlStatement[];
}> {
  const nextVersion = source.application_version + 1;
  const response: ReviewProductApplicationResult = {
    application_id: source.application_id,
    status: 'REJECTED',
    application_version: nextVersion,
    product_id: null,
    product_version_id: null,
    review_reason: rejectionReason,
    replayed: false,
  };

  return {
    response,
    statements: [
      database.prepare(`
        UPDATE product_applications
        SET
          status='REJECTED',
          review_reason=?,
          reviewed_by_staff_id=?,
          product_id=NULL,
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          reviewed_at=?,
          withdrawn_at=NULL
        WHERE id=?
          AND status='SUBMITTED'
          AND version=?
      `).bind(
        rejectionReason,
        command.actor.staffId,
        now,
        now,
        source.application_id,
        source.application_version,
      ),
      insertProductApplicationEventStatement(database, {
        applicationId: source.application_id,
        organizationId: source.organization_id,
        storeId: source.store_id,
        eventType: 'PRODUCT_APPLICATION_REJECTED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousStatus: 'SUBMITTED',
        nextStatus: 'REJECTED',
        applicationVersion: nextVersion,
        reason: rejectionReason,
        idempotencyKey,
        createdAt: now,
      }),
    ],
  };
}

async function requireReviewSource(
  database: SqlDatabase,
  applicationId: string,
): Promise<ApplicationSource> {
  const row = await database.prepare(`
    SELECT
      application.id AS application_id,
      application.organization_id,
      application.store_id,
      application.marketplace_code,
      application.asin_normalized,
      application.product_name,
      application.search_keywords_json,
      application.product_url,
      application.buyer_visible_notes,
      application.seller_notes,
      application.status,
      application.version AS application_version,
      store.status AS store_status,
      organization.status AS organization_status
    FROM product_applications application
    JOIN seller_stores store
      ON store.id=application.store_id
      AND store.organization_id=application.organization_id
    JOIN seller_organizations organization
      ON organization.id=application.organization_id
    WHERE application.id=?
  `).bind(
    applicationId,
  ).first<ApplicationSource>();

  if (!row) {
    throw new ProductApplicationError(
      'PRODUCT_APPLICATION_NOT_FOUND',
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

async function assertAsinAvailableForApproval(
  database: SqlDatabase,
  source: ApplicationSource,
): Promise<void> {
  const existing = await database.prepare(`
    SELECT id, store_id
    FROM products
    WHERE marketplace_code=?
      AND asin_normalized=?
    LIMIT 1
  `).bind(
    source.marketplace_code,
    source.asin_normalized,
  ).first<ExistingProduct>();

  if (!existing) return;
  if (existing.store_id === source.store_id) {
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

function parseKeywords(
  value: string,
): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)
      || parsed.some((item) => typeof item !== 'string')) {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw new ProductApplicationError(
      'DEPENDENCY_UNAVAILABLE',
      503,
    );
  }
}

function assertReviewCompletedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: ReviewProductApplicationResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM product_applications
        WHERE id=?
          AND status=?
          AND version=?
          AND (
            (? IS NULL AND product_id IS NULL)
            OR product_id=?
          )
      )
      AND (
        ?='REJECTED'
        OR (
          EXISTS (
            SELECT 1
            FROM products
            WHERE id=?
              AND status='ACTIVE'
              AND current_version_no=1
          )
          AND EXISTS (
            SELECT 1
            FROM product_versions
            WHERE id=?
              AND product_id=?
              AND version_no=1
          )
        )
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
    response.status,
    response.application_version,
    response.product_id,
    response.product_id,
    response.status,
    response.product_id,
    response.product_version_id,
    response.product_id,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
