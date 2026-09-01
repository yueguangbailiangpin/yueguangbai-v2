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
  CustomerAuthError,
  insertAccessEventStatement,
  insertCredentialStatement,
  normalizeCustomerAuthError,
  normalizeLoginIdentifier,
  prepareTemporaryCredential,
  requireStaffPermission,
  type CustomerAccessActor,
} from './customer-auth-shared';

interface SellerActivationSource {
  organization_id: string;
  organization_status: string;
  organization_version: number;
  seller_code: string;
  member_id: string;
  member_status: string;
  member_version: number;
  identity_subject_id: string;
  display_wechat: string;
}

export interface ActivateSellerOwnerResult {
  seller_organization_id: string;
  owner_member_id: string;
  account_id: string;
  session_version: number;
  password_change_required: true;
  temporary_password: string | null;
  temporary_password_available: boolean;
  replayed: boolean;
}

interface StoredSellerActivationResult
  extends Omit<
    ActivateSellerOwnerResult,
    'temporary_password'
    | 'temporary_password_available'
    | 'replayed'
  > {
  temporary_password: null;
  temporary_password_available: false;
  replayed: false;
}

export async function activateSellerOrganizationOwner(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    passwordIterations?: number;
  },
  command: {
    actor: CustomerAccessActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ActivateSellerOwnerResult> {
  requireStaffPermission(command.actor, 'SELLER_MANAGE');

  const organizationId = input.sellerOrganizationId.trim();
  if (organizationId.length < 1 || organizationId.length > 120) {
    throw new CustomerAuthError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new CustomerAuthError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'ACTIVATE_SELLER_ORGANIZATION_OWNER',
    seller_organization_id: organizationId,
  });
  const acquired =
    await acquireIdempotency<StoredSellerActivationResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'ACTIVATE_SELLER_ORGANIZATION_OWNER',
        targetType: 'SELLER_ORGANIZATION',
        targetId: organizationId,
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
    const source = await requireSellerActivationSource(
      database,
      organizationId,
    );
    if (source.organization_status === 'ACTIVE'
      || source.member_status === 'ACTIVE') {
      throw new CustomerAuthError(
        'CUSTOMER_ALREADY_ACTIVE',
        409,
      );
    }

    const login = normalizeLoginIdentifier(
      source.display_wechat,
    );
    const prepared = await prepareTemporaryCredential(
      generateTemporaryPassword,
      input.passwordIterations,
    );
    const accountId = crypto.randomUUID();
    const storedResponse: StoredSellerActivationResult = {
      seller_organization_id: organizationId,
      owner_member_id: source.member_id,
      account_id: accountId,
      session_version: 1,
      password_change_required: true,
      temporary_password: null,
      temporary_password_available: false,
      replayed: false,
    };
    const firstResponse: ActivateSellerOwnerResult = {
      ...storedResponse,
      temporary_password: prepared.temporaryPassword,
      temporary_password_available: true,
    };


    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE seller_organizations
        SET
          status='ACTIVE',
          activated_at=?,
          disabled_at=NULL,
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND status='DISABLED'
          AND version=?
      `).bind(
        now,
        now,
        organizationId,
        source.organization_version,
      ),
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
          AND role='OWNER'
          AND primary_owner=1
          AND status='DISABLED'
          AND version=?
      `).bind(
        now,
        now,
        source.member_id,
        organizationId,
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
        login.display,
        login.normalized,
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
          organization_status: 'DISABLED',
          member_status: 'DISABLED',
        },
        nextState: {
          organization_status: 'ACTIVE',
          member_status: 'ACTIVE',
          session_version: 1,
          password_change_required: true,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_ORGANIZATION',
        aggregateId: organizationId,
        eventType: 'SELLER_OWNER_ACTIVATED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          organization_status: 'DISABLED',
          owner_member_status: 'DISABLED',
        },
        nextState: {
          organization_status: 'ACTIVE',
          owner_member_status: 'ACTIVE',
          owner_member_id: source.member_id,
          account_id: accountId,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        storedResponse,
        {
          resultReferences: {
            seller_organization_id: organizationId,
            owner_member_id: source.member_id,
            account_id: accountId,
          },
          now,
        },
      ),
      assertSellerActivationStatement(
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
    const normalized = normalizeCustomerAuthError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

async function requireSellerActivationSource(
  database: SqlDatabase,
  organizationId: string,
): Promise<SellerActivationSource> {
  const source = await database.prepare(`
    SELECT
      organization.id AS organization_id,
      organization.status AS organization_status,
      organization.version AS organization_version,
      organization.seller_code,
      member.id AS member_id,
      member.status AS member_status,
      member.version AS member_version,
      member.identity_subject_id,
      claim.display_wechat
    FROM seller_organizations organization
    JOIN seller_organization_members member
      ON member.organization_id=organization.id
      AND member.role='OWNER'
      AND member.primary_owner=1
    JOIN wechat_identity_claims claim
      ON claim.identity_subject_id=member.identity_subject_id
      AND claim.status='ACTIVE'
    WHERE organization.id=?
  `).bind(organizationId).first<SellerActivationSource>();

  if (!source) {
    throw new CustomerAuthError('CUSTOMER_NOT_FOUND', 404);
  }
  return source;
}

function assertSellerActivationStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  source: SellerActivationSource,
  accountId: string,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM seller_organizations
        WHERE id=?
          AND status='ACTIVE'
      )
      AND EXISTS (
        SELECT 1
        FROM seller_organization_members
        WHERE id=?
          AND status='ACTIVE'
          AND role='OWNER'
          AND primary_owner=1
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
    source.organization_id,
    source.member_id,
    accountId,
    source.identity_subject_id,
    accountId,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
