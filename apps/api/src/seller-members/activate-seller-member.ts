import type {
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  generateTemporaryPassword,
  hashCanonicalJson,
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
  insertAccessEventStatement,
  insertCredentialStatement,
  prepareTemporaryCredential,
} from '../customer-auth/customer-auth-shared';
import {
  cleanSellerMemberIdentifier,
  insertSellerMemberEventStatement,
  normalizeSellerMemberError,
  requireSellerMemberPermission,
  SellerMemberError,
  type SellerMemberStaffActor,
} from './seller-member-shared';

interface MemberActivationSource {
  member_id: string;
  organization_id: string;
  organization_status: string;
  member_status: string;
  member_version: number;
  role: string;
  identity_subject_id: string;
  display_wechat: string;
}

export interface ActivateSellerMemberResult {
  seller_member_id: string;
  seller_organization_id: string;
  account_id: string;
  session_version: number;
  password_change_required: true;
  temporary_password: string | null;
  temporary_password_available: boolean;
  replayed: boolean;
}

interface StoredActivationResult
  extends Omit<
    ActivateSellerMemberResult,
    'temporary_password'
    | 'temporary_password_available'
    | 'replayed'
  > {
  temporary_password: null;
  temporary_password_available: false;
  replayed: false;
}

export async function activateSellerOrganizationMember(
  database: SqlDatabase,
  input: {
    sellerMemberId: string;
    passwordIterations?: number;
  },
  command: {
    actor: SellerMemberStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ActivateSellerMemberResult> {
  requireSellerMemberPermission(command.actor);

  const memberId = cleanSellerMemberIdentifier(
    input.sellerMemberId,
  );
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new SellerMemberError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'ACTIVATE_SELLER_ORGANIZATION_MEMBER',
    seller_member_id: memberId,
  });

  const acquired =
    await acquireIdempotency<StoredActivationResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'ACTIVATE_SELLER_ORGANIZATION_MEMBER',
        targetType: 'SELLER_MEMBER',
        targetId: memberId,
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
    const source = await requireMemberActivationSource(
      database,
      memberId,
    );
    if (source.member_status === 'ACTIVE') {
      throw new SellerMemberError(
        'SELLER_MEMBER_ALREADY_ACTIVE',
        409,
      );
    }
    if (source.organization_status !== 'ACTIVE') {
      throw new SellerMemberError(
        'VALIDATION_ERROR',
        409,
      );
    }

    const prepared = await prepareTemporaryCredential(
      generateTemporaryPassword,
      input.passwordIterations,
    );
    const accountId = crypto.randomUUID();

    const storedResponse: StoredActivationResult = {
      seller_member_id: memberId,
      seller_organization_id: source.organization_id,
      account_id: accountId,
      session_version: 1,
      password_change_required: true,
      temporary_password: null,
      temporary_password_available: false,
      replayed: false,
    };
    const firstResponse: ActivateSellerMemberResult = {
      ...storedResponse,
      temporary_password: prepared.temporaryPassword,
      temporary_password_available: true,
    };

    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `seller-member-activated:${memberId}`,
      eventType: 'SELLER_MEMBER_ACTIVATED',
      aggregateType: 'SELLER_MEMBER',
      aggregateId: memberId,
      payload: {
        seller_member_id: memberId,
        seller_organization_id: source.organization_id,
        account_id: accountId,
        role: source.role,
        status: 'ACTIVE',
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE seller_organization_members
        SET
          status='ACTIVE',
          activated_at=?,
          disabled_at=NULL,
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND organization_id=?
          AND status='DISABLED'
          AND version=?
      `).bind(
        now,
        now,
        memberId,
        source.organization_id,
        source.member_version,
      ),
      database.prepare(`
        INSERT INTO customer_login_accounts (
          id,
          identity_subject_id,
          account_type,
          login_identifier_display,
          login_identifier_normalized,
          status,
          session_version,
          password_change_required,
          version,
          created_at,
          updated_at,
          activated_at,
          disabled_at
        ) VALUES (
          ?, ?, 'SELLER_MEMBER', ?, ?, 'ACTIVE',
          1, 1, 1, ?, ?, ?, NULL
        )
      `).bind(
        accountId,
        source.identity_subject_id,
        source.display_wechat,
        source.display_wechat.toLocaleLowerCase('en-US'),
        now,
        now,
        now,
      ),
      insertCredentialStatement(database, {
        accountId,
        credential: prepared.credential,
        now,
      }),
      insertAccessEventStatement(database, {
        accountId,
        identitySubjectId: source.identity_subject_id,
        eventType: 'ACCOUNT_ACTIVATED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousState: {
          member_status: 'DISABLED',
        },
        nextState: {
          member_status: 'ACTIVE',
          session_version: 1,
          password_change_required: true,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      insertSellerMemberEventStatement(database, {
        memberId,
        organizationId: source.organization_id,
        eventType: 'SELLER_MEMBER_ACTIVATED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousState: {
          status: 'DISABLED',
        },
        nextState: {
          status: 'ACTIVE',
          account_id: accountId,
          password_change_required: true,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_MEMBER',
        aggregateId: memberId,
        eventType: 'SELLER_MEMBER_ACTIVATED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: 'DISABLED',
        },
        nextState: {
          status: 'ACTIVE',
          account_id: accountId,
          role: source.role,
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        storedResponse,
        {
          resultReferences: {
            seller_member_id: memberId,
            account_id: accountId,
          },
          now,
        },
      ),
      assertMemberActivatedStatement(
        database,
        acquired.claim,
        source,
        accountId,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await database.batch(statements);
    return firstResponse;
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

async function requireMemberActivationSource(
  database: SqlDatabase,
  memberId: string,
): Promise<MemberActivationSource> {
  const row = await database.prepare(`
    SELECT
      member.id AS member_id,
      member.organization_id,
      organization.status AS organization_status,
      member.status AS member_status,
      member.version AS member_version,
      member.role,
      member.identity_subject_id,
      claim.display_wechat
    FROM seller_organization_members member
    JOIN seller_organizations organization
      ON organization.id=member.organization_id
    JOIN wechat_identity_claims claim
      ON claim.identity_subject_id=member.identity_subject_id
      AND claim.status='ACTIVE'
    WHERE member.id=?
  `).bind(memberId).first<MemberActivationSource>();

  if (!row) {
    throw new SellerMemberError(
      'SELLER_MEMBER_NOT_FOUND',
      404,
    );
  }
  return row;
}

function assertMemberActivatedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  source: MemberActivationSource,
  accountId: string,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM seller_organization_members
        WHERE id=?
          AND organization_id=?
          AND status='ACTIVE'
          AND version=?
      )
      AND EXISTS (
        SELECT 1
        FROM customer_login_accounts
        WHERE id=?
          AND identity_subject_id=?
          AND account_type='SELLER_MEMBER'
          AND status='ACTIVE'
          AND session_version=1
          AND password_change_required=1
      )
      AND EXISTS (
        SELECT 1
        FROM customer_password_credentials
        WHERE account_id=?
          AND password_version=1
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
    source.member_id,
    source.organization_id,
    source.member_version + 1,
    accountId,
    source.identity_subject_id,
    accountId,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
