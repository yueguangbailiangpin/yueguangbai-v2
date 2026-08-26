import type {
  SellerMemberRole,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  hashCanonicalJson,
  normalizeWechatId,
} from '@ygb/domain';
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
  assertWechatAvailable,
  createIdentityClaimStatements,
} from '../customers/master-data-shared';
import {
  cleanSellerMemberDisplayName,
  cleanSellerMemberIdentifier,
  insertSellerMemberEventStatement,
  normalizeSellerMemberError,
  parseSellerMemberRole,
  requireSellerMemberPermission,
  SellerMemberError,
  type SellerMemberStaffActor,
} from './seller-member-shared';

interface OrganizationSource {
  organization_id: string;
  seller_code: string;
  status: string;
  next_member_number: number;
  version: number;
}

export interface CreateSellerMemberResult {
  seller_member_id: string;
  identity_subject_id: string;
  wechat_claim_id: string;
  seller_organization_id: string;
  member_number: number;
  username_fallback: string;
  role: SellerMemberRole;
  status: 'DISABLED';
  replayed: boolean;
}

export async function createSellerOrganizationMember(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    displayName: string;
    wechatId: string;
    role: SellerMemberRole;
  },
  command: {
    actor: SellerMemberStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<CreateSellerMemberResult> {
  requireSellerMemberPermission(command.actor);

  const organizationId = cleanSellerMemberIdentifier(
    input.sellerOrganizationId,
  );
  const displayName = cleanSellerMemberDisplayName(
    input.displayName,
  );
  const wechat = (() => {
    try {
      return normalizeWechatId(input.wechatId);
    } catch {
      throw new SellerMemberError('VALIDATION_ERROR', 400);
    }
  })();
  const role = parseSellerMemberRole(input.role);

  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new SellerMemberError('VALIDATION_ERROR', 400);
  }

  // D-056 §4.4: members see the whole organization; creation no longer
  // binds per-store scopes.
  const requestHash = await hashCanonicalJson({
    action: 'CREATE_SELLER_ORGANIZATION_MEMBER',
    seller_organization_id: organizationId,
    display_name: displayName,
    normalized_wechat: wechat.normalized,
    role,
  });
  const targetHash = await hashCanonicalJson({
    seller_organization_id: organizationId,
    normalized_wechat: wechat.normalized,
  });

  const acquired =
    await acquireIdempotency<CreateSellerMemberResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'CREATE_SELLER_ORGANIZATION_MEMBER',
        targetType: 'SELLER_MEMBER_IDENTITY',
        targetId: `seller-member:${targetHash}`,
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
    const organization = await requireOrganization(
      database,
      organizationId,
    );
    await assertWechatAvailable(
      database,
      wechat.normalized,
    );

    const memberNumber = Number(
      organization.next_member_number,
    );
    const memberId = crypto.randomUUID();
    const subjectId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    const usernameFallback =
      `${organization.seller_code}-${memberNumber}`;

    const response: CreateSellerMemberResult = {
      seller_member_id: memberId,
      identity_subject_id: subjectId,
      wechat_claim_id: claimId,
      seller_organization_id: organizationId,
      member_number: memberNumber,
      username_fallback: usernameFallback,
      role,
      status: 'DISABLED',
      replayed: false,
    };

    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `seller-member-created:${memberId}`,
      eventType: 'SELLER_MEMBER_CREATED',
      aggregateType: 'SELLER_MEMBER',
      aggregateId: memberId,
      payload: {
        seller_member_id: memberId,
        seller_organization_id: organizationId,
        member_number: memberNumber,
        role,
        status: 'DISABLED',
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE seller_organizations
        SET
          next_member_number=next_member_number+1,
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND status='ACTIVE'
          AND next_member_number=?
          AND version=?
      `).bind(
        now,
        organizationId,
        memberNumber,
        organization.version,
      ),
      ...createIdentityClaimStatements(database, {
        subjectId,
        subjectType: 'SELLER_ORG_MEMBER',
        claimId,
        displayWechat: wechat.display,
        normalizedWechat: wechat.normalized,
        actor: command.actor,
        idempotencyKey: acquired.claim.idempotencyKey,
        now,
      }),
      database.prepare(`
        INSERT INTO seller_organization_members (
          id,
          identity_subject_id,
          organization_id,
          member_number,
          username_fallback,
          display_name,
          role,
          primary_owner,
          status,
          version,
          created_at,
          updated_at,
          activated_at,
          disabled_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, 0,
          'DISABLED', 1, ?, ?, NULL, ?
        )
      `).bind(
        memberId,
        subjectId,
        organizationId,
        memberNumber,
        usernameFallback,
        displayName,
        role,
        now,
        now,
        now,
      ),
      insertSellerMemberEventStatement(database, {
        memberId,
        organizationId,
        eventType: 'SELLER_MEMBER_CREATED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousState: null,
        nextState: {
          member_number: memberNumber,
          username_fallback: usernameFallback,
          role,
          status: 'DISABLED',
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_MEMBER',
        aggregateId: memberId,
        eventType: 'SELLER_MEMBER_CREATED',
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
            seller_member_id: memberId,
            identity_subject_id: subjectId,
            wechat_claim_id: claimId,
          },
          now,
        },
      ),
      assertMemberCreatedStatement(
        database,
        acquired.claim,
        organization,
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
    const normalized = normalizeSellerMemberError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

async function requireOrganization(
  database: SqlDatabase,
  organizationId: string,
): Promise<OrganizationSource> {
  const row = await database.prepare(`
    SELECT
      id AS organization_id,
      seller_code,
      status,
      next_member_number,
      version
    FROM seller_organizations
    WHERE id=?
  `).bind(
    organizationId,
  ).first<OrganizationSource>();

  if (!row) {
    throw new SellerMemberError('NOT_FOUND', 404);
  }
  if (row.status !== 'ACTIVE') {
    throw new SellerMemberError('VALIDATION_ERROR', 409);
  }
  return row;
}

function assertMemberCreatedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  organization: OrganizationSource,
  response: CreateSellerMemberResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM seller_organizations
        WHERE id=?
          AND next_member_number=?
          AND version=?
      )
      AND EXISTS (
        SELECT 1
        FROM seller_organization_members
        WHERE id=?
          AND organization_id=?
          AND identity_subject_id=?
          AND member_number=?
          AND username_fallback=?
          AND role=?
          AND primary_owner=0
          AND status='DISABLED'
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
    organization.organization_id,
    response.member_number + 1,
    organization.version + 1,
    response.seller_member_id,
    response.seller_organization_id,
    response.identity_subject_id,
    response.member_number,
    response.username_fallback,
    response.role,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
