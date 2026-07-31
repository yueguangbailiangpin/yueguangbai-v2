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
  CustomerAuthError,
  insertAccessEventStatement,
  insertCredentialStatement,
  normalizeCustomerAuthError,
  normalizeLoginIdentifier,
  prepareTemporaryCredential,
  requireStaffPermission,
  type CustomerAccessActor,
} from './customer-auth-shared';

interface BuyerActivationSource {
  buyer_id: string;
  identity_subject_id: string;
  access_status: string;
  identity_review_status: string;
  buyer_version: number;
  display_wechat: string;
  normalized_wechat: string;
}

export interface ActivateBuyerResult {
  buyer_customer_id: string;
  account_id: string;
  session_version: number;
  password_change_required: true;
  temporary_password: string | null;
  temporary_password_available: boolean;
  replayed: boolean;
}

interface StoredActivationResult {
  buyer_customer_id: string;
  account_id: string;
  session_version: number;
  password_change_required: true;
  temporary_password: null;
  temporary_password_available: false;
  replayed: false;
}

export async function activateBuyerCustomer(
  database: SqlDatabase,
  input: {
    buyerCustomerId: string;
    passwordIterations?: number;
  },
  command: {
    actor: CustomerAccessActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ActivateBuyerResult> {
  requireStaffPermission(
    command.actor,
    'BUYER_ACTIVATE_STANDARD',
  );

  const buyerCustomerId = input.buyerCustomerId.trim();
  if (buyerCustomerId.length < 1
    || buyerCustomerId.length > 120) {
    throw new CustomerAuthError('VALIDATION_ERROR', 400);
  }

  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new CustomerAuthError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'ACTIVATE_BUYER_CUSTOMER',
    buyer_customer_id: buyerCustomerId,
  });
  const acquired = await acquireIdempotency<StoredActivationResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'ACTIVATE_BUYER_CUSTOMER',
      targetType: 'BUYER_CUSTOMER',
      targetId: buyerCustomerId,
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
    const source = await requireBuyerActivationSource(
      database,
      buyerCustomerId,
    );
    if (source.access_status === 'ACTIVE') {
      throw new CustomerAuthError(
        'CUSTOMER_ALREADY_ACTIVE',
        409,
      );
    }
    if (source.identity_review_status !== 'CLEAR') {
      throw new CustomerAuthError(
        'IDENTITY_REVIEW_REQUIRED',
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

    const storedResponse: StoredActivationResult = {
      buyer_customer_id: buyerCustomerId,
      account_id: accountId,
      session_version: 1,
      password_change_required: true,
      temporary_password: null,
      temporary_password_available: false,
      replayed: false,
    };
    const firstResponse: ActivateBuyerResult = {
      ...storedResponse,
      temporary_password: prepared.temporaryPassword,
      temporary_password_available: true,
    };

    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `buyer-activated:${buyerCustomerId}`,
      eventType: 'BUYER_CUSTOMER_ACTIVATED',
      aggregateType: 'BUYER_CUSTOMER',
      aggregateId: buyerCustomerId,
      payload: {
        buyer_customer_id: buyerCustomerId,
        account_id: accountId,
        access_status: 'ACTIVE',
        password_change_required: true,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE buyer_customers
        SET
          access_status='ACTIVE',
          activated_at=?,
          disabled_at=NULL,
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND access_status='DISABLED'
          AND identity_review_status='CLEAR'
          AND version=?
      `).bind(
        now,
        now,
        buyerCustomerId,
        source.buyer_version,
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
          ?, ?, 'BUYER', ?, ?, 'ACTIVE',
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
          access_status: 'DISABLED',
        },
        nextState: {
          access_status: 'ACTIVE',
          session_version: 1,
          password_change_required: true,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_CUSTOMER',
        aggregateId: buyerCustomerId,
        eventType: 'BUYER_CUSTOMER_ACTIVATED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          access_status: 'DISABLED',
        },
        nextState: {
          access_status: 'ACTIVE',
          account_id: accountId,
          password_change_required: true,
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
            buyer_customer_id: buyerCustomerId,
            account_id: accountId,
          },
          now,
        },
      ),
      assertBuyerActivationStatement(
        database,
        acquired.claim,
        buyerCustomerId,
        source.identity_subject_id,
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

async function requireBuyerActivationSource(
  database: SqlDatabase,
  buyerCustomerId: string,
): Promise<BuyerActivationSource> {
  const source = await database.prepare(`
    SELECT
      buyer.id AS buyer_id,
      buyer.identity_subject_id,
      buyer.access_status,
      buyer.identity_review_status,
      buyer.version AS buyer_version,
      claim.display_wechat,
      claim.normalized_wechat
    FROM buyer_customers buyer
    JOIN wechat_identity_claims claim
      ON claim.identity_subject_id=buyer.identity_subject_id
      AND claim.status='ACTIVE'
    WHERE buyer.id=?
  `).bind(buyerCustomerId).first<BuyerActivationSource>();

  if (!source) {
    throw new CustomerAuthError('CUSTOMER_NOT_FOUND', 404);
  }
  return source;
}

function assertBuyerActivationStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  buyerId: string,
  subjectId: string,
  accountId: string,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM buyer_customers
        WHERE id=?
          AND access_status='ACTIVE'
      )
      AND EXISTS (
        SELECT 1
        FROM customer_login_accounts
        WHERE id=?
          AND identity_subject_id=?
          AND account_type='BUYER'
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
    buyerId,
    accountId,
    subjectId,
    accountId,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
