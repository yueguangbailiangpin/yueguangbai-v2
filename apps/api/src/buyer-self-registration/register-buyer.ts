import type {
  BuyerSelfRegistrationSource,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  canonicalJson,
  chinaBusinessDate,
  formatBuyerCustomerNumber,
  hashCustomerPassword,
  normalizeWechatId,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import { insertCredentialStatement } from '../customer-auth/customer-auth-shared';
import { BuyerSelfRegistrationError } from './errors';

interface BuyerMatchRow {
  buyer_customer_id: string;
  identity_subject_id: string;
  access_status: string;
  identity_review_status: string;
  buyer_channel_id: string;
  buyer_customer_no: string | null;
  buyer_sequence: number | null;
  buyer_version: number;
  active_claim_count: number;
}

interface ChannelRow {
  id: string;
  code: string;
  status: string;
  next_sequence: number;
  version: number;
}

interface PreorderRow {
  buyer_customer_no: string;
  buyer_sequence: number;
}

export interface RegisterBuyerSelfInput {
  wechatId: string;
  password: string;
  passwordConfirmation: string;
  defaultBuyerChannelId: string;
}

export interface RegisterBuyerSelfCommand {
  requestId: string;
  idempotencyKey: string;
  wechatIdHash: string;
  networkSourceHash: string;
  deviceHash: string;
  sessionId: string;
  sessionExpiresAt: number;
  now?: number;
  passwordIterations?: number;
}

export interface RegisterBuyerSelfResult {
  buyerNumber: string;
  wechatDisplay: string;
  source: BuyerSelfRegistrationSource;
  authenticated: {
    accountId: string;
    identitySubjectId: string;
    accountType: 'BUYER';
    sessionVersion: number;
    passwordChangeRequired: false;
  };
}

export async function registerBuyerSelf(
  database: SqlDatabase,
  input: RegisterBuyerSelfInput,
  command: RegisterBuyerSelfCommand,
): Promise<RegisterBuyerSelfResult> {
  const now = command.now ?? Date.now();
  validateCommand(command, now);
  const wechat = normalizeWechatId(input.wechatId);
  if (input.password !== input.passwordConfirmation) {
    throw new BuyerSelfRegistrationError('INVALID_REQUEST', 400);
  }
  const credential = await hashCustomerPassword(
    input.password,
    command.passwordIterations === undefined
      ? {}
      : { iterations: command.passwordIterations },
  );

  const matches = await findBuyerMatches(database, wechat.normalized);
  if (matches.length > 1) {
    await recordConflict(database, {
      matchedBuyerCount: matches.length,
      normalizedWechat: wechat.normalized,
      ...privacy(command),
      now,
    });
    throw new BuyerSelfRegistrationError('REGISTRATION_CONFLICT', 409);
  }

  const existing = matches[0] ?? null;
  if (existing && (
    existing.access_status !== 'ACTIVE'
    || existing.identity_review_status !== 'CLEAR'
    || Number(existing.active_claim_count) !== 1
  )) {
    await recordRejected(database, command, now, 'BUYER_NOT_ELIGIBLE');
    throw new BuyerSelfRegistrationError('BUYER_NOT_ELIGIBLE', 409);
  }

  if (await accountExists(database, existing?.identity_subject_id ?? null,
    wechat.normalized)) {
    await recordRejected(database, command, now, 'ACCOUNT_ALREADY_EXISTS');
    throw new BuyerSelfRegistrationError('ACCOUNT_ALREADY_EXISTS', 409);
  }

  const source: BuyerSelfRegistrationSource = existing
    ? 'SELF_REGISTRATION_CLAIM'
    : 'SELF_REGISTRATION_NEW';
  const buyerCustomerId = existing?.buyer_customer_id ?? crypto.randomUUID();
  const identitySubjectId = existing?.identity_subject_id ?? crypto.randomUUID();
  const buyerChannelId = existing?.buyer_channel_id
    ?? cleanId(input.defaultBuyerChannelId);
  const accountId = crypto.randomUUID();
  const channel = await requireChannel(database, buyerChannelId);
  const preorder = existing
    ? await findPreorder(database, buyerCustomerId)
    : null;
  const needsPreorder = (existing === null
    || existing.buyer_customer_no === null)
    && preorder === null;
  const sequence = needsPreorder
    ? Number(channel.next_sequence)
    : Number(existing?.buyer_sequence ?? preorder?.buyer_sequence);
  const buyerNumber = existing?.buyer_customer_no
    ?? preorder?.buyer_customer_no
    ?? formatBuyerCustomerNumber({
      businessDate: chinaBusinessDate(now),
      channelCode: channel.code,
      sequence,
    });

  const statements: SqlStatement[] = [];
  if (!existing) {
    statements.push(...newBuyerStatements(database, {
      buyerCustomerId,
      identitySubjectId,
      buyerChannelId,
      buyerDisplayName: wechat.display.slice(0, 100),
      wechatDisplay: wechat.display,
      normalizedWechat: wechat.normalized,
      now,
      idempotencyKey: command.idempotencyKey,
    }));
  }
  if (needsPreorder) {
    statements.push(
      database.prepare(`
        UPDATE buyer_channels
        SET
          next_sequence=next_sequence+1,
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND status='ACTIVE'
          AND next_sequence=?
          AND version=?
      `).bind(
        now,
        buyerChannelId,
        sequence,
        channel.version,
      ),
      database.prepare(`
        INSERT INTO buyer_preorder_number_allocations (
          buyer_customer_id, buyer_channel_id, buyer_customer_no,
          buyer_sequence, allocation_business_date, allocation_source,
          request_id, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, 'SELF_REGISTRATION', ?, ?, ?)
      `).bind(
        buyerCustomerId,
        buyerChannelId,
        buyerNumber,
        sequence,
        chinaBusinessDate(now),
        command.requestId,
        command.idempotencyKey,
        now,
      ),
    );
  }

  statements.push(
    database.prepare(`
      INSERT INTO customer_login_accounts (
        id, identity_subject_id, account_type,
        login_identifier_display, login_identifier_normalized,
        status, session_version, password_change_required,
        version, created_at, updated_at, activated_at, disabled_at,
        registration_source
      ) VALUES (
        ?, ?, 'BUYER', ?, ?, 'ACTIVE', 1, 0,
        1, ?, ?, ?, NULL, ?
      )
    `).bind(
      accountId,
      identitySubjectId,
      wechat.display,
      wechat.normalized,
      now,
      now,
      now,
      source,
    ),
    insertCredentialStatement(database, {
      accountId,
      credential,
      now,
    }),
    database.prepare(`
      INSERT INTO customer_access_events (
        id, account_id, identity_subject_id, event_type,
        actor_type, actor_id, previous_state_json, next_state_json,
        request_id, idempotency_key, created_at
      ) VALUES (
        ?, ?, ?, 'ACCOUNT_ACTIVATED', 'CUSTOMER_ACCOUNT', ?,
        NULL, ?, ?, ?, ?
      )
    `).bind(
      crypto.randomUUID(),
      accountId,
      identitySubjectId,
      accountId,
      canonicalJson({
        status: 'ACTIVE',
        session_version: 1,
        password_change_required: false,
        registration_source: source,
      }),
      command.requestId,
      command.idempotencyKey,
      now,
    ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'BUYER_CUSTOMER',
      aggregateId: buyerCustomerId,
      eventType: source,
      actor: { type: 'PUBLIC_SELF_REGISTRATION', id: null, roles: [] },
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
      previousState: existing ? { auth_account: null } : null,
      nextState: {
        auth_account_created: true,
        buyer_number: buyerNumber,
        registration_source: source,
      },
      metadata: {
        wechat_id_hash: command.wechatIdHash,
        network_source_hash: command.networkSourceHash,
        device_hash: command.deviceHash,
      },
      createdAt: now,
    }),
    database.prepare(`
      INSERT INTO buyer_registration_session_issuances (
        id, account_id, session_version, request_id,
        network_source_hash, device_hash, issued_at, expires_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    `).bind(
      command.sessionId,
      accountId,
      command.requestId,
      command.networkSourceHash,
      command.deviceHash,
      now,
      command.sessionExpiresAt,
    ),
    registrationAttemptStatement(database, {
      eventType: 'REGISTRATION_SUCCEEDED',
      outcome: 'SUCCESS',
      source,
      buyerCustomerId,
      accountId,
      reasonCode: null,
      command,
      now,
    }),
    registrationAssertion(database, {
      normalizedWechat: wechat.normalized,
      buyerCustomerId,
      identitySubjectId,
      accountId,
      buyerNumber,
      needsPreorder,
      channel,
      sequence,
      sessionId: command.sessionId,
      source,
    }),
  );

  try {
    await database.batch(statements);
  } catch (error) {
    const message = String(error);
    if (message.includes('UNIQUE constraint failed')
      || message.includes('transaction_assertion_failed')) {
      throw new BuyerSelfRegistrationError(
        'CONCURRENT_REGISTRATION',
        409,
      );
    }
    throw error;
  }

  return {
    buyerNumber,
    wechatDisplay: wechat.display,
    source,
    authenticated: {
      accountId,
      identitySubjectId,
      accountType: 'BUYER',
      sessionVersion: 1,
      passwordChangeRequired: false,
    },
  };
}

async function findBuyerMatches(
  database: SqlDatabase,
  normalizedWechat: string,
): Promise<BuyerMatchRow[]> {
  const rows = await database.prepare(`
    SELECT
      buyer.id AS buyer_customer_id,
      buyer.identity_subject_id,
      buyer.access_status,
      buyer.identity_review_status,
      buyer.buyer_channel_id,
      buyer.buyer_customer_no,
      buyer.buyer_sequence,
      buyer.version AS buyer_version,
      SUM(CASE WHEN claim.status='ACTIVE' THEN 1 ELSE 0 END)
        AS active_claim_count
    FROM wechat_identity_claims claim
    JOIN buyer_customers buyer
      ON buyer.identity_subject_id=claim.identity_subject_id
    WHERE claim.normalized_wechat=?
    GROUP BY
      buyer.id,
      buyer.identity_subject_id,
      buyer.access_status,
      buyer.identity_review_status,
      buyer.buyer_channel_id,
      buyer.buyer_customer_no,
      buyer.buyer_sequence,
      buyer.version
    ORDER BY buyer.created_at, buyer.id
  `).bind(normalizedWechat).all<BuyerMatchRow>();
  return rows.results;
}

async function accountExists(
  database: SqlDatabase,
  identitySubjectId: string | null,
  normalizedWechat: string,
): Promise<boolean> {
  const row = await database.prepare(`
    SELECT 1
    FROM customer_login_accounts
    WHERE login_identifier_normalized=?
      OR (? IS NOT NULL AND identity_subject_id=?)
    LIMIT 1
  `).bind(
    normalizedWechat,
    identitySubjectId,
    identitySubjectId,
  ).first();
  return row !== null;
}

async function requireChannel(
  database: SqlDatabase,
  channelId: string,
): Promise<ChannelRow> {
  const row = await database.prepare(`
    SELECT id, code, status, next_sequence, version
    FROM buyer_channels
    WHERE id=?
  `).bind(channelId).first<ChannelRow>();
  if (!row || row.status !== 'ACTIVE') {
    throw new BuyerSelfRegistrationError('CONFIGURATION_INVALID', 503);
  }
  return row;
}

async function findPreorder(
  database: SqlDatabase,
  buyerCustomerId: string,
): Promise<PreorderRow | null> {
  return database.prepare(`
    SELECT buyer_customer_no, buyer_sequence
    FROM buyer_preorder_number_allocations
    WHERE buyer_customer_id=?
  `).bind(buyerCustomerId).first<PreorderRow>();
}

function newBuyerStatements(
  database: SqlDatabase,
  input: {
    buyerCustomerId: string;
    identitySubjectId: string;
    buyerChannelId: string;
    buyerDisplayName: string;
    wechatDisplay: string;
    normalizedWechat: string;
    now: number;
    idempotencyKey: string;
  },
): SqlStatement[] {
  const claimId = crypto.randomUUID();
  return [
    database.prepare(`
      INSERT INTO customer_identity_subjects (
        id, subject_type, created_at
      ) VALUES (?, 'BUYER_CUSTOMER', ?)
    `).bind(input.identitySubjectId, input.now),
    database.prepare(`
      INSERT INTO buyer_customers (
        id, identity_subject_id, marketplace_code, buyer_channel_id,
        buyer_customer_no, buyer_sequence, first_valid_order_business_date,
        display_name, access_status, identity_review_status,
        version, created_at, updated_at, activated_at, disabled_at
      ) VALUES (
        ?, ?, 'AMAZON_JP', ?, NULL, NULL, NULL,
        ?, 'ACTIVE', 'CLEAR', 1, ?, ?, ?, NULL
      )
    `).bind(
      input.buyerCustomerId,
      input.identitySubjectId,
      input.buyerChannelId,
      input.buyerDisplayName,
      input.now,
      input.now,
      input.now,
    ),
    database.prepare(`
      INSERT INTO wechat_identity_claims (
        id, identity_subject_id, display_wechat, normalized_wechat,
        status, version, acquired_at, reserved_at, released_at,
        created_at, updated_at, identity_subject_type
      ) VALUES (?, ?, ?, ?, 'ACTIVE', 1, ?, NULL, NULL, ?, ?, 'BUYER_CUSTOMER')
    `).bind(
      claimId,
      input.identitySubjectId,
      input.wechatDisplay,
      input.normalizedWechat,
      input.now,
      input.now,
      input.now,
    ),
    database.prepare(`
      INSERT INTO customer_identity_claim_events (
        id, claim_id, identity_subject_id, event_type,
        previous_status, next_status, actor_type, actor_id,
        reason, idempotency_key, created_at
      ) VALUES (
        ?, ?, ?, 'CLAIMED', NULL, 'ACTIVE',
        'PUBLIC_SELF_REGISTRATION', NULL, NULL, ?, ?
      )
    `).bind(
      crypto.randomUUID(),
      claimId,
      input.identitySubjectId,
      input.idempotencyKey,
      input.now,
    ),
  ];
}

function registrationAttemptStatement(
  database: SqlDatabase,
  input: {
    eventType: 'REGISTRATION_SUCCEEDED' | 'REGISTRATION_REJECTED';
    outcome: 'SUCCESS' | 'FAILURE';
    source: BuyerSelfRegistrationSource | null;
    buyerCustomerId: string | null;
    accountId: string | null;
    reasonCode: string | null;
    command: RegisterBuyerSelfCommand;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO buyer_registration_attempts (
      id, event_type, outcome, registration_source,
      buyer_customer_id, account_id, wechat_id_hash,
      network_source_hash, device_hash, request_id,
      reason_code, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.eventType,
    input.outcome,
    input.source,
    input.buyerCustomerId,
    input.accountId,
    input.command.wechatIdHash,
    input.command.networkSourceHash,
    input.command.deviceHash,
    input.command.requestId,
    input.reasonCode,
    canonicalJson({}),
    input.now,
  );
}

async function recordRejected(
  database: SqlDatabase,
  command: RegisterBuyerSelfCommand,
  now: number,
  reasonCode: string,
): Promise<void> {
  await registrationAttemptStatement(database, {
    eventType: 'REGISTRATION_REJECTED',
    outcome: 'FAILURE',
    source: null,
    buyerCustomerId: null,
    accountId: null,
    reasonCode,
    command,
    now,
  }).run();
}

async function recordConflict(
  database: SqlDatabase,
  input: {
    matchedBuyerCount: number;
    normalizedWechat: string;
    requestId: string;
    idempotencyKey: string;
    wechatIdHash: string;
    networkSourceHash: string;
    deviceHash: string;
    now: number;
  },
): Promise<void> {
  const conflictId = crypto.randomUUID();
  await database.batch([
    database.prepare(`
      INSERT INTO buyer_registration_conflicts (
        id, normalized_wechat_hash, matched_buyer_count,
        request_id, network_source_hash, device_hash, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE (
        SELECT COUNT(DISTINCT buyer.id)
        FROM wechat_identity_claims claim
        JOIN buyer_customers buyer
          ON buyer.identity_subject_id=claim.identity_subject_id
        WHERE claim.normalized_wechat=?
      )=?
        AND ?>=2
    `).bind(
      conflictId,
      input.wechatIdHash,
      input.matchedBuyerCount,
      input.requestId,
      input.networkSourceHash,
      input.deviceHash,
      input.now,
      input.normalizedWechat,
      input.matchedBuyerCount,
      input.matchedBuyerCount,
    ),
    database.prepare(`
      INSERT INTO buyer_registration_conflict_events (
        id, conflict_id, event_type, actor_type, actor_id,
        reason, request_id, created_at
      )
      SELECT ?, ?, 'OPENED', 'SYSTEM', NULL, NULL, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM buyer_registration_conflicts WHERE id=?
      )
    `).bind(
      crypto.randomUUID(),
      conflictId,
      input.requestId,
      input.now,
      conflictId,
    ),
    database.prepare(`
      INSERT INTO buyer_registration_attempts (
        id, event_type, outcome, registration_source,
        buyer_customer_id, account_id, wechat_id_hash,
        network_source_hash, device_hash, request_id,
        reason_code, metadata_json, created_at
      )
      SELECT
        ?, 'REGISTRATION_REJECTED', 'FAILURE', NULL,
        NULL, NULL, ?, ?, ?, ?, 'REGISTRATION_CONFLICT', ?, ?
      WHERE EXISTS (
        SELECT 1 FROM buyer_registration_conflicts WHERE id=?
      )
    `).bind(
      crypto.randomUUID(),
      input.wechatIdHash,
      input.networkSourceHash,
      input.deviceHash,
      input.requestId,
      canonicalJson({ matched_buyer_count: input.matchedBuyerCount }),
      input.now,
      conflictId,
    ),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM buyer_registration_conflicts
        WHERE id=? AND matched_buyer_count=?
      ) THEN 1 ELSE 0 END
    `).bind(conflictId, input.matchedBuyerCount),
  ]);
}

function registrationAssertion(
  database: SqlDatabase,
  input: {
    normalizedWechat: string;
    buyerCustomerId: string;
    identitySubjectId: string;
    accountId: string;
    buyerNumber: string;
    needsPreorder: boolean;
    channel: ChannelRow;
    sequence: number;
    sessionId: string;
    source: BuyerSelfRegistrationSource;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      (SELECT COUNT(DISTINCT buyer.id)
       FROM wechat_identity_claims claim
       JOIN buyer_customers buyer
         ON buyer.identity_subject_id=claim.identity_subject_id
       WHERE claim.normalized_wechat=?)=1
      AND EXISTS (
        SELECT 1 FROM buyer_customers
        WHERE id=? AND identity_subject_id=?
          AND access_status='ACTIVE'
          AND identity_review_status='CLEAR'
      )
      AND (
        SELECT COUNT(*) FROM wechat_identity_claims
        WHERE identity_subject_id=?
          AND normalized_wechat=?
          AND status='ACTIVE'
      )=1
      AND EXISTS (
        SELECT 1 FROM customer_login_accounts
        WHERE id=? AND identity_subject_id=?
          AND account_type='BUYER' AND status='ACTIVE'
          AND session_version=1 AND password_change_required=0
          AND registration_source=?
      )
      AND EXISTS (
        SELECT 1 FROM customer_password_credentials
        WHERE account_id=? AND password_version=1
      )
      AND EXISTS (
        SELECT 1 FROM buyer_registration_session_issuances
        WHERE id=? AND account_id=? AND session_version=1
      )
      AND (
        ?=0
        OR (
          EXISTS (
            SELECT 1 FROM buyer_preorder_number_allocations
            WHERE buyer_customer_id=?
              AND buyer_customer_no=?
              AND buyer_sequence=?
          )
          AND EXISTS (
            SELECT 1 FROM buyer_channels
            WHERE id=? AND next_sequence=? AND version=?
          )
        )
      )
    THEN 1 ELSE 0 END
  `).bind(
    input.normalizedWechat,
    input.buyerCustomerId,
    input.identitySubjectId,
    input.identitySubjectId,
    input.normalizedWechat,
    input.accountId,
    input.identitySubjectId,
    input.source,
    input.accountId,
    input.sessionId,
    input.accountId,
    input.needsPreorder ? 1 : 0,
    input.buyerCustomerId,
    input.buyerNumber,
    input.sequence,
    input.channel.id,
    input.channel.next_sequence + 1,
    input.channel.version + 1,
  );
}

function privacy(command: RegisterBuyerSelfCommand) {
  return {
    requestId: command.requestId,
    idempotencyKey: command.idempotencyKey,
    wechatIdHash: command.wechatIdHash,
    networkSourceHash: command.networkSourceHash,
    deviceHash: command.deviceHash,
  };
}

function cleanId(value: string): string {
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > 120
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new BuyerSelfRegistrationError('CONFIGURATION_INVALID', 503);
  }
  return normalized;
}

function validateCommand(
  command: RegisterBuyerSelfCommand,
  now: number,
): void {
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(command.sessionExpiresAt)
    || command.sessionExpiresAt <= now
    || command.requestId.length < 1
    || command.requestId.length > 200
    || command.idempotencyKey.length < 8
    || command.idempotencyKey.length > 128
    || !/^[0-9a-f]{64}$/u.test(command.wechatIdHash)
    || !/^[0-9a-f]{64}$/u.test(command.networkSourceHash)
    || !/^[0-9a-f]{64}$/u.test(command.deviceHash)) {
    throw new BuyerSelfRegistrationError('INVALID_REQUEST', 400);
  }
}
