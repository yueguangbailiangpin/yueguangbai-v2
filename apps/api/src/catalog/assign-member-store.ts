import type {
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
import {
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import {
  CatalogError,
  cleanCatalogIdentifier,
  normalizeCatalogError,
  requireCatalogPermission,
  type CatalogStaffActor,
} from './catalog-shared';

interface ScopeSourceRow {
  member_id: string;
  member_status: string;
  member_role: string;
  organization_id: string;
  organization_status: string;
  store_id: string;
  store_status: string;
}

export interface AssignSellerMemberStoreResult {
  member_id: string;
  store_id: string;
  seller_organization_id: string;
  status: 'ACTIVE';
  already_active: boolean;
  replayed: boolean;
}

export async function assignSellerMemberStore(
  database: SqlDatabase,
  input: {
    memberId: string;
    storeId: string;
  },
  command: {
    actor: CatalogStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<AssignSellerMemberStoreResult> {
  requireCatalogPermission(command.actor, 'SELLER_MANAGE');

  const memberId = cleanCatalogIdentifier(input.memberId);
  const storeId = cleanCatalogIdentifier(input.storeId);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new CatalogError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'ASSIGN_SELLER_MEMBER_STORE',
    member_id: memberId,
    store_id: storeId,
  });
  const acquired =
    await acquireIdempotency<AssignSellerMemberStoreResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'ASSIGN_SELLER_MEMBER_STORE',
        targetType: 'SELLER_MEMBER_STORE_SCOPE',
        targetId: `${memberId}:${storeId}`,
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
    const source = await requireScopeSource(
      database,
      memberId,
      storeId,
    );

    const existing = await database.prepare(`
      SELECT status
      FROM seller_member_store_scopes
      WHERE member_id=?
        AND store_id=?
    `).bind(
      memberId,
      storeId,
    ).first<{ status: string }>();

    const response: AssignSellerMemberStoreResult = {
      member_id: memberId,
      store_id: storeId,
      seller_organization_id: source.organization_id,
      status: 'ACTIVE',
      already_active: existing?.status === 'ACTIVE',
      replayed: false,
    };

    const statements: SqlStatement[] = [];
    if (existing?.status !== 'ACTIVE') {
      statements.push(
        database.prepare(`
          INSERT INTO seller_member_store_scopes (
            member_id,
            store_id,
            organization_id,
            status,
            assigned_by_staff_id,
            assigned_at,
            revoked_at,
            created_at,
            updated_at
          ) VALUES (
            ?, ?, ?, 'ACTIVE', ?, ?, NULL, ?, ?
          )
          ON CONFLICT(member_id, store_id)
          DO UPDATE SET
            status='ACTIVE',
            assigned_by_staff_id=excluded.assigned_by_staff_id,
            assigned_at=excluded.assigned_at,
            revoked_at=NULL,
            updated_at=MAX(
              excluded.updated_at,
              seller_member_store_scopes.updated_at+1
            )
        `).bind(
          memberId,
          storeId,
          source.organization_id,
          command.actor.staffId,
          now,
          now,
          now,
        ),
        database.prepare(`
          INSERT INTO seller_member_store_scope_events (
            id,
            member_id,
            store_id,
            organization_id,
            event_type,
            actor_staff_id,
            idempotency_key,
            created_at
          ) VALUES (
            ?, ?, ?, ?, 'STORE_SCOPE_ASSIGNED', ?, ?, ?
          )
        `).bind(
          crypto.randomUUID(),
          memberId,
          storeId,
          source.organization_id,
          command.actor.staffId,
          acquired.claim.idempotencyKey,
          now,
        ),
        createAuditEventStatement(database, {
          id: crypto.randomUUID(),
          aggregateType: 'SELLER_MEMBER_STORE_SCOPE',
          aggregateId: `${memberId}:${storeId}`,
          eventType: 'SELLER_MEMBER_STORE_ASSIGNED',
          actor: {
            type: 'STAFF',
            id: command.actor.staffId,
            roles: command.actor.roles,
          },
          requestId: command.requestId ?? null,
          idempotencyKey: acquired.claim.idempotencyKey,
          previousState: existing === null
            ? null
            : { status: existing.status },
          nextState: {
            member_id: memberId,
            store_id: storeId,
            status: 'ACTIVE',
          },
          createdAt: now,
        }),
      );

      const outboxId = crypto.randomUUID();
      const outbox = await prepareOutboxEvent({
        id: outboxId,
        dedupKey: `seller-member-store-assigned:${outboxId}`,
        eventType: 'SELLER_MEMBER_STORE_ASSIGNED',
        aggregateType: 'SELLER_MEMBER',
        aggregateId: memberId,
        payload: {
          member_id: memberId,
          store_id: storeId,
          seller_organization_id: source.organization_id,
        },
        createdAt: now,
      });
      statements.push(
        ...createOutboxStatements(database, outbox),
      );
    }

    statements.push(
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            member_id: memberId,
            store_id: storeId,
          },
          now,
        },
      ),
      assertScopeAssignedStatement(
        database,
        acquired.claim,
        response,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    );

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

async function requireScopeSource(
  database: SqlDatabase,
  memberId: string,
  storeId: string,
): Promise<ScopeSourceRow> {
  const row = await database.prepare(`
    SELECT
      member.id AS member_id,
      member.status AS member_status,
      member.role AS member_role,
      member.organization_id,
      organization.status AS organization_status,
      store.id AS store_id,
      store.status AS store_status
    FROM seller_organization_members member
    JOIN seller_organizations organization
      ON organization.id=member.organization_id
    JOIN seller_stores store
      ON store.organization_id=member.organization_id
      AND store.id=?
    WHERE member.id=?
  `).bind(
    storeId,
    memberId,
  ).first<ScopeSourceRow>();

  if (!row) throw new CatalogError('NOT_FOUND', 404);
  if (row.member_status !== 'ACTIVE'
    || row.organization_status !== 'ACTIVE'
    || row.store_status !== 'ACTIVE') {
    throw new CatalogError('VALIDATION_ERROR', 409);
  }
  return row;
}

function assertScopeAssignedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: AssignSellerMemberStoreResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM seller_member_store_scopes
        WHERE member_id=?
          AND store_id=?
          AND organization_id=?
          AND status='ACTIVE'
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
    response.member_id,
    response.store_id,
    response.seller_organization_id,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
