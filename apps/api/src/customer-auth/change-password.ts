import type {
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  CUSTOMER_PASSWORD_DEFAULT_ITERATIONS,
  hashCanonicalJson,
  hashCustomerPassword,
  verifyCustomerPassword,
  type PasswordCredential,
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
  normalizeCustomerAuthError,
} from './customer-auth-shared';

interface PasswordChangeSource {
  account_id: string;
  identity_subject_id: string;
  account_type: 'BUYER' | 'SELLER_MEMBER';
  account_status: string;
  session_version: number;
  account_version: number;
  algorithm: 'PBKDF2_SHA256';
  iterations: number;
  salt_base64url: string;
  hash_base64url: string;
  password_version: number;
}

export interface ChangeCustomerPasswordResult {
  account_id: string;
  session_version: number;
  password_change_required: false;
  replayed: boolean;
}

export async function changeCustomerPassword(
  database: SqlDatabase,
  input: {
    accountId: string;
    currentPassword: string;
    newPassword: string;
    passwordIterations?: number;
  },
  command: {
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ChangeCustomerPasswordResult> {
  const accountId = input.accountId.trim();
  if (accountId.length < 1 || accountId.length > 120) {
    throw new CustomerAuthError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new CustomerAuthError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'CHANGE_CUSTOMER_PASSWORD',
    account_id: accountId,
    current_password_hash: await hashCanonicalJson(
      input.currentPassword,
    ),
    new_password_hash: await hashCanonicalJson(
      input.newPassword,
    ),
  });

  const acquired =
    await acquireIdempotency<ChangeCustomerPasswordResult>(
      database,
      {
        actorType: 'CUSTOMER_ACCOUNT',
        actorId: accountId,
        action: 'CHANGE_CUSTOMER_PASSWORD',
        targetType: 'CUSTOMER_LOGIN_ACCOUNT',
        targetId: accountId,
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
    const source = await requirePasswordSource(
      database,
      accountId,
    );
    if (source.account_status !== 'ACTIVE') {
      throw new CustomerAuthError(
        'CUSTOMER_NOT_ACTIVE',
        409,
      );
    }

    const currentCredential: PasswordCredential = {
      algorithm: source.algorithm,
      iterations: Number(source.iterations),
      saltBase64Url: source.salt_base64url,
      hashBase64Url: source.hash_base64url,
    };
    const valid = await verifyCustomerPassword(
      input.currentPassword,
      currentCredential,
    );
    if (!valid) {
      throw new CustomerAuthError(
        'INVALID_CREDENTIALS',
        401,
      );
    }

    const nextCredential = await hashCustomerPassword(
      input.newPassword,
      {
        iterations: input.passwordIterations
          ?? CUSTOMER_PASSWORD_DEFAULT_ITERATIONS,
      },
    );
    const nextSessionVersion =
      Number(source.session_version) + 1;
    const response: ChangeCustomerPasswordResult = {
      account_id: accountId,
      session_version: nextSessionVersion,
      password_change_required: false,
      replayed: false,
    };

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE customer_password_credentials
        SET
          algorithm=?,
          iterations=?,
          salt_base64url=?,
          hash_base64url=?,
          password_version=password_version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE account_id=?
          AND password_version=?
      `).bind(
        nextCredential.algorithm,
        nextCredential.iterations,
        nextCredential.saltBase64Url,
        nextCredential.hashBase64Url,
        now,
        accountId,
        source.password_version,
      ),
      database.prepare(`
        UPDATE customer_login_accounts
        SET
          session_version=session_version+1,
          password_change_required=0,
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND status='ACTIVE'
          AND session_version=?
          AND version=?
      `).bind(
        now,
        accountId,
        source.session_version,
        source.account_version,
      ),
      insertAccessEventStatement(database, {
        accountId,
        identitySubjectId: source.identity_subject_id,
        eventType: 'PASSWORD_CHANGED',
        actorType: 'CUSTOMER_ACCOUNT',
        actorId: accountId,
        previousState: {
          session_version: source.session_version,
          password_version: source.password_version,
        },
        nextState: {
          session_version: nextSessionVersion,
          password_version: source.password_version + 1,
          password_change_required: false,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'CUSTOMER_LOGIN_ACCOUNT',
        aggregateId: accountId,
        eventType: 'CUSTOMER_PASSWORD_CHANGED',
        actor: {
          type: 'CUSTOMER_ACCOUNT',
          id: accountId,
          roles: [],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          session_version: source.session_version,
          password_change_required: true,
        },
        nextState: {
          session_version: nextSessionVersion,
          password_change_required: false,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            account_id: accountId,
            session_version: nextSessionVersion,
          },
          now,
        },
      ),
      assertPasswordChangedStatement(
        database,
        acquired.claim,
        source,
        nextSessionVersion,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await database.batch(statements);
    return response;
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

async function requirePasswordSource(
  database: SqlDatabase,
  accountId: string,
): Promise<PasswordChangeSource> {
  const row = await database.prepare(`
    SELECT
      account.id AS account_id,
      account.identity_subject_id,
      account.account_type,
      account.status AS account_status,
      account.session_version,
      account.version AS account_version,
      credential.algorithm,
      credential.iterations,
      credential.salt_base64url,
      credential.hash_base64url,
      credential.password_version
    FROM customer_login_accounts account
    JOIN customer_password_credentials credential
      ON credential.account_id=account.id
    WHERE account.id=?
  `).bind(accountId).first<PasswordChangeSource>();

  if (!row) {
    throw new CustomerAuthError('INVALID_CREDENTIALS', 401);
  }
  return row;
}

function assertPasswordChangedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  source: PasswordChangeSource,
  nextSessionVersion: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM customer_login_accounts
        WHERE id=?
          AND session_version=?
          AND password_change_required=0
          AND version=?
      )
      AND EXISTS (
        SELECT 1
        FROM customer_password_credentials
        WHERE account_id=?
          AND password_version=?
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
    source.account_id,
    nextSessionVersion,
    source.account_version + 1,
    source.account_id,
    source.password_version + 1,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
