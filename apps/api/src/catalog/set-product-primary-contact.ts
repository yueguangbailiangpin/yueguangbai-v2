import type {
  ProductPrimaryContactDto,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import { requireCatalogOrganizationScope } from '../staff-assignment';
import {
  CatalogError,
  cleanCatalogIdentifier,
  normalizeCatalogError,
  type CatalogStaffActor,
} from './catalog-shared';

interface ProductRow {
  id: string;
  organization_id: string;
  status: string;
  version: number;
  primary_contact_member_id: string | null;
}

interface MemberRow {
  id: string;
  organization_id: string;
  display_name: string;
  status: string;
}

export async function setProductPrimaryContact(
  database: SqlDatabase,
  input: {
    productId: string;
    primaryContactMemberId: string | null;
    expectedVersion: number;
    reason: string;
  },
  command: {
    actor: CatalogStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{ product: ProductPrimaryContactDto; replayed: boolean }> {
  const actor = command.actor;
  // owner or seller_ops with SELLER_MANAGE (D-056 §4.4)
  if (
    !actor.permissions.has('SELLER_MANAGE')
    || !actor.roles.some((role) => role === 'owner' || role === 'seller_ops')
  ) {
    throw new CatalogError('FORBIDDEN', 403);
  }

  const productId = cleanCatalogIdentifier(input.productId);
  const reason = normalizeReason(input.reason);
  if (
    !Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1
  ) {
    throw new CatalogError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();

  const product = await database
    .prepare(
      `SELECT id, organization_id, status, version, primary_contact_member_id
      FROM products WHERE id=?`,
    )
    .bind(productId)
    .first<ProductRow>();
  if (!product || product.status !== 'ACTIVE') {
    throw new CatalogError('PRODUCT_NOT_FOUND', 404);
  }
  requireCatalogOrganizationScope(actor, product.organization_id);

  if (input.primaryContactMemberId !== null) {
    const member = await database
      .prepare(
        `SELECT id, organization_id, display_name, status
        FROM seller_organization_members WHERE id=?`,
      )
      .bind(cleanCatalogIdentifier(input.primaryContactMemberId))
      .first<MemberRow>();
    if (
      !member
      || member.status !== 'ACTIVE'
      || member.organization_id !== product.organization_id
    ) {
      throw new CatalogError('VALIDATION_ERROR', 409);
    }
  }

  const requestHash = await hashCanonicalJson({
    action: 'SET_PRODUCT_PRIMARY_CONTACT',
    product_id: productId,
    primary_contact_member_id: input.primaryContactMemberId,
    expected_version: input.expectedVersion,
    reason,
  });
  let acquired;
  try {
    acquired = await acquireIdempotency<{
      product: ProductPrimaryContactDto;
      replayed: boolean;
    }>(database, {
      actorType: 'STAFF',
      actorId: actor.staffId,
      action: 'SET_PRODUCT_PRIMARY_CONTACT',
      targetType: 'PRODUCT',
      targetId: productId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    }, { now });
  } catch (error) {
    throw normalizeCatalogError(error);
  }
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    if (product.version !== input.expectedVersion) {
      throw new CatalogError('VERSION_CONFLICT', 409);
    }
    // Setting the member that is already primary is a semantic replay, not a
    // version rotation.
    if (product.primary_contact_member_id === input.primaryContactMemberId) {
      const response = {
        product: await readProductPrimaryContact(database, productId),
        replayed: true,
      } as const;
      await database.batch([
        completeIdempotencyStatement(database, acquired.claim, response, {
          resultReferences: { product_id: productId },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      return response;
    }

    const response: { product: ProductPrimaryContactDto; replayed: boolean } = {
      product: {
        product_id: productId,
        seller_organization_id: product.organization_id,
        primary_contact_member_id: input.primaryContactMemberId,
        primary_contact_member_name: input.primaryContactMemberId
          ? await memberDisplayName(database, input.primaryContactMemberId)
          : null,
        version: product.version + 1,
      },
      replayed: false,
    };
    const statements: SqlStatement[] = [
      database
        .prepare(
          `UPDATE products
          SET primary_contact_member_id=?, version=version+1, updated_at=?
          WHERE id=? AND version=?`,
        )
        .bind(
          input.primaryContactMemberId,
          now,
          productId,
          input.expectedVersion,
        ),
      database
        .prepare(
          `INSERT INTO seller_product_primary_contact_events(
            id, product_id, seller_organization_id, previous_member_id,
            next_member_id, actor_staff_id, reason, created_at
          ) VALUES(?,?,?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          productId,
          product.organization_id,
          product.primary_contact_member_id,
          input.primaryContactMemberId,
          actor.staffId,
          reason,
          now,
        ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'PRODUCT',
        aggregateId: productId,
        eventType: 'PRODUCT_PRIMARY_CONTACT_CHANGED',
        actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          primary_contact_member_id: product.primary_contact_member_id,
          version: product.version,
        },
        nextState: {
          primary_contact_member_id: input.primaryContactMemberId,
          version: product.version + 1,
          reason,
        },
        createdAt: now,
      }),
      database
        .prepare(
          `INSERT INTO transaction_assertions(assertion_value)
        SELECT CASE WHEN
          (SELECT primary_contact_member_id FROM products WHERE id=?) IS ?
          AND EXISTS(
            SELECT 1 FROM seller_product_primary_contact_events
            WHERE product_id=? AND next_member_id IS ?
          )
        THEN 1 ELSE 0 END`,
        )
        .bind(
          productId,
          input.primaryContactMemberId,
          productId,
          input.primaryContactMemberId,
        ),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { product_id: productId },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    const projected = await readProductPrimaryContact(database, productId);
    return { product: projected, replayed: false };
  } catch (error) {
    const normalized = normalizeCatalogError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

export async function readProductPrimaryContact(
  database: SqlDatabase,
  productId: string,
): Promise<ProductPrimaryContactDto> {
  const row = await database
    .prepare(
      `SELECT product.id AS product_id, product.organization_id,
        product.primary_contact_member_id, member.display_name AS member_name,
        product.version
      FROM products product
      LEFT JOIN seller_organization_members member
        ON member.id=product.primary_contact_member_id
      WHERE product.id=?`,
    )
    .bind(productId)
    .first<{
      product_id: string;
      organization_id: string;
      primary_contact_member_id: string | null;
      member_name: string | null;
      version: number;
    }>();
  if (!row) throw new CatalogError('PRODUCT_NOT_FOUND', 404);
  return Object.freeze({
    product_id: row.product_id,
    seller_organization_id: row.organization_id,
    primary_contact_member_id: row.primary_contact_member_id,
    primary_contact_member_name: row.member_name,
    version: Number(row.version),
  });
}

async function memberDisplayName(
  database: SqlDatabase,
  memberId: string,
): Promise<string | null> {
  const row = await database
    .prepare(`SELECT display_name FROM seller_organization_members WHERE id=?`)
    .bind(memberId)
    .first<{ display_name: string }>();
  return row?.display_name ?? null;
}

function normalizeReason(value: string): string {
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 1000) {
    throw new CatalogError('VALIDATION_ERROR', 400);
  }
  return normalized;
}
