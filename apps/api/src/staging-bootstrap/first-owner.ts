import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { canonicalJson, hashCanonicalJson } from '@ygb/domain';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  IdempotencyError,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import { normalizeStaffEmail } from '../staff-auth/cloudflare-access';

const TARGET_SCHEMA = 71;
const STAGING_BUYER_CHANNEL_ID = 'staging-buyer-channel';
const STAGING_DATABASE_NAME = /^yueguangbai-v2-staging(?:-[a-z0-9-]+)?$/u;
const DATABASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STAGING_ZERO_STOCK_TABLES = [
  'acquisition_channels',
  'acquisition_leads',
  'acquisition_prospects',
  'audit_events',
  'buyer_channels',
  'buyer_customers',
  'buyer_refund_obligations',
  'customer_account_personas',
  'customer_identity_subjects',
  'customer_login_accounts',
  'demand_batches',
  'file_objects',
  'formal_orders',
  'integration_outbox',
  'order_evidence_submissions',
  'order_instructions',
  'platform_order_identities',
  'product_applications',
  'product_reservations',
  'products',
  'review_cases',
  'seller_member_invitations',
  'seller_organization_members',
  'seller_organizations',
  'seller_partner_import_batches',
  'seller_payables',
  'seller_payments',
  'seller_stores',
  'standard_products',
] as const;

export interface StagingFirstOwnerInput {
  environment: string;
  databaseName: string;
  databaseId: string;
  displayName: string;
  email: string;
  idempotencyKey: string;
}

export interface StagingFirstOwnerResult {
  staff_id: string;
  role_code: 'owner';
  status: 'ACTIVE';
}

export class StagingFirstOwnerError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_STAGING_TARGET'
      | 'INVALID_INPUT'
      | 'SCHEMA_NOT_READY'
      | 'STAFF_AUTHORITY_NOT_EMPTY'
      | 'STAGING_FOUNDATION_NOT_EMPTY'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'StagingFirstOwnerError';
  }
}

export async function bootstrapStagingFirstOwner(
  database: SqlDatabase,
  rawInput: StagingFirstOwnerInput,
  now = Date.now(),
): Promise<StagingFirstOwnerResult> {
  const input = normalizeInput(rawInput);
  const schema = await database.prepare(
    'SELECT schema_version FROM app_schema_state WHERE singleton_id=1',
  ).first<{schema_version:number}>().catch(() => null);
  if (Number(schema?.schema_version ?? 0) !== TARGET_SCHEMA) {
    throw new StagingFirstOwnerError('SCHEMA_NOT_READY');
  }

  const requestHash = await hashCanonicalJson({
    environment: input.environment,
    database_name: input.databaseName,
    database_id: input.databaseId,
    display_name: input.displayName,
    normalized_email: input.email,
  });
  let acquired;
  try {
    acquired = await acquireIdempotency<StagingFirstOwnerResult>(database, {
      actorType: 'SYSTEM',
      actorId: 'staging-first-owner-operator',
      action: 'BOOTSTRAP_STAGING_FIRST_OWNER',
      targetType: 'D1_DATABASE',
      targetId: input.databaseId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    }, { now });
  } catch (error) {
    throw normalizeError(error);
  }
  if (acquired.kind === 'REPLAY') return acquired.response;

  const staffId = `staging-owner-${crypto.randomUUID()}`;
  const roleId = `staging-role-${crypto.randomUUID()}`;
  const identityId = `staging-email-${crypto.randomUUID()}`;
  const authorizationEventId = `staging-auth-${crypto.randomUUID()}`;
  const result: StagingFirstOwnerResult = {
    staff_id: staffId,
    role_code: 'owner',
    status: 'ACTIVE',
  };
  const statements: SqlStatement[] = [
    emptyStagingAssertion(database),
    database.prepare(`INSERT INTO staff_users(
      id,display_name,status,authorization_version,version,
      created_at,updated_at,disabled_at,session_version
    ) VALUES(?,?,'ACTIVE',1,1,?,?,NULL,1)`).bind(
      staffId, input.displayName, now, now,
    ),
    database.prepare(`INSERT INTO staff_role_assignments(
      id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,
      revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at
    ) VALUES(?,?,'owner','ACTIVE',NULL,?,NULL,NULL,NULL,?,?)`).bind(
      roleId, staffId, now, now, now,
    ),
    database.prepare(`INSERT INTO staff_email_identities(
      id,staff_id,normalized_email,status,verified_at,last_login_at,
      created_at,updated_at,revoked_at
    ) VALUES(?,?,?,'ACTIVE',NULL,NULL,?,?,NULL)`).bind(
      identityId, staffId, input.email, now, now,
    ),
    database.prepare(`INSERT INTO staff_assignment_fallbacks(
      marketplace_code,staff_id,version,configured_by_staff_id,
      created_at,updated_at
    ) VALUES('JP',?,1,?,?,?)`).bind(
      staffId, staffId, now, now,
    ),
    database.prepare(`INSERT INTO staff_authorization_events(
      id,staff_id,authorization_version,event_type,actor_staff_id,
      request_id,idempotency_key,change_summary_json,created_at
    ) VALUES(?,?,1,'STAGING_FIRST_OWNER_BOOTSTRAPPED',NULL,NULL,?,?,?)`).bind(
      authorizationEventId,
      staffId,
      input.idempotencyKey,
      JSON.stringify({
        assignment_fallback_configured: true,
        email_identity_created: true,
        role_code: 'owner',
        source: 'STAGING_FIRST_OWNER_BOOTSTRAP',
      }),
      now,
    ),
    database.prepare(`INSERT INTO buyer_channels(
      id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at
    ) VALUES(?,'STG','Staging synthetic buyer','ACTIVE',1,1,?,?,NULL)`).bind(
      STAGING_BUYER_CHANNEL_ID, now, now,
    ),
    stagingBootstrapAuditStatement(
      database,
      `staging-audit-${crypto.randomUUID()}`,
      staffId,
      input.idempotencyKey,
      now,
    ),
    completeIdempotencyStatement(database, acquired.claim, result, {
      resultReferences: { staff_id: staffId },
      now,
    }),
    finalAuthorityAssertion(database, staffId, identityId),
    assertIdempotencyCompletionStatement(database, acquired.claim),
  ];

  try {
    await database.batch(statements);
    return result;
  } catch (error) {
    await markIdempotencyFailed(
      database,
      acquired.claim,
      'STAGING_FIRST_OWNER_BOOTSTRAP_FAILED',
      now,
    ).catch(() => false);
    const state = await bootstrapState(database).catch(() => null);
    if (!state?.staffEmpty) {
      throw new StagingFirstOwnerError('STAFF_AUTHORITY_NOT_EMPTY');
    }
    if (!state.businessStockEmpty) {
      throw new StagingFirstOwnerError('STAGING_FOUNDATION_NOT_EMPTY');
    }
    throw normalizeError(error);
  }
}

function normalizeInput(input: StagingFirstOwnerInput): StagingFirstOwnerInput {
  const environment = String(input.environment ?? '').trim();
  const databaseName = String(input.databaseName ?? '').trim().toLowerCase();
  const databaseId = String(input.databaseId ?? '').trim().toLowerCase();
  if (environment !== 'staging'
    || !STAGING_DATABASE_NAME.test(databaseName)
    || databaseName.includes('production')
    || databaseName.includes('default')
    || !DATABASE_ID.test(databaseId)) {
    throw new StagingFirstOwnerError('INVALID_STAGING_TARGET');
  }
  const displayName = text(input.displayName, 100);
  const email = normalizeStaffEmail(input.email);
  const idempotencyKey = text(input.idempotencyKey, 128);
  if (!email || idempotencyKey.length < 8) {
    throw new StagingFirstOwnerError('INVALID_INPUT');
  }
  return {
    environment,
    databaseName,
    databaseId,
    displayName,
    email,
    idempotencyKey,
  };
}

function emptyStagingAssertion(database: SqlDatabase): SqlStatement {
  return database.prepare(`INSERT INTO transaction_assertions(assertion_value)
    SELECT CASE WHEN
      EXISTS(SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=71)
      AND NOT EXISTS(SELECT 1 FROM staff_users)
      AND NOT EXISTS(SELECT 1 FROM staff_role_assignments)
      AND NOT EXISTS(SELECT 1 FROM staff_email_identities)
      AND NOT EXISTS(SELECT 1 FROM staff_marketplace_scopes)
      AND NOT EXISTS(SELECT 1 FROM staff_team_memberships)
      AND NOT EXISTS(SELECT 1 FROM staff_team_leaders)
      AND NOT EXISTS(SELECT 1 FROM staff_permission_overrides)
      AND NOT EXISTS(SELECT 1 FROM staff_availability)
      AND NOT EXISTS(SELECT 1 FROM staff_assignment_fallbacks)
      AND NOT EXISTS(SELECT 1 FROM staff_sessions)
      AND NOT EXISTS(SELECT 1 FROM staff_mcp_subject_bindings)
      AND NOT EXISTS(SELECT 1 FROM staff_mcp_token_revocations)
      AND NOT EXISTS(SELECT 1 FROM staff_mcp_replay_records)
      AND NOT EXISTS(SELECT 1 FROM staff_mcp_rate_limits)
      AND NOT EXISTS(SELECT 1 FROM staff_assignment_events)
      AND NOT EXISTS(SELECT 1 FROM staff_assignment_cursors)
      AND NOT EXISTS(SELECT 1 FROM staff_reassignment_batches)
      AND NOT EXISTS(SELECT 1 FROM staff_reassignment_batch_items)
      AND NOT EXISTS(SELECT 1 FROM staff_work_items)
      AND NOT EXISTS(SELECT 1 FROM staff_role_consolidation_mappings)
      AND NOT EXISTS(SELECT 1 FROM staff_authorization_events)
      ${STAGING_ZERO_STOCK_TABLES.map((table) =>
        `AND NOT EXISTS(SELECT 1 FROM ${table})`).join('\n      ')}
    THEN 1 ELSE 0 END`);
}

function finalAuthorityAssertion(
  database: SqlDatabase,
  staffId: string,
  identityId: string,
): SqlStatement {
  return database.prepare(`INSERT INTO transaction_assertions(assertion_value)
    SELECT CASE WHEN
      (SELECT COUNT(*) FROM staff_users)=1
      AND (SELECT COUNT(*) FROM staff_users WHERE id=? AND status='ACTIVE')=1
      AND (SELECT COUNT(*) FROM staff_role_assignments
        WHERE staff_id=? AND role_code='owner' AND status='ACTIVE')=1
      AND (SELECT COUNT(*) FROM staff_email_identities
        WHERE id=? AND staff_id=? AND status='ACTIVE')=1
      AND (SELECT COUNT(*) FROM staff_marketplace_scopes)=0
      AND (SELECT COUNT(*) FROM staff_assignment_fallbacks
        WHERE marketplace_code='JP' AND staff_id=? AND version=1)=1
      AND (SELECT COUNT(*) FROM staff_sessions)=0
      AND (SELECT COUNT(*) FROM buyer_channels)=1
      AND (SELECT COUNT(*) FROM buyer_channels
        WHERE id='staging-buyer-channel' AND code='STG'
          AND status='ACTIVE' AND version=1)=1
      AND (SELECT COUNT(*) FROM staff_authorization_events
        WHERE staff_id=? AND authorization_version=1
          AND event_type='STAGING_FIRST_OWNER_BOOTSTRAPPED')=1
      AND (SELECT COUNT(*) FROM audit_events
        WHERE aggregate_type='STAFF' AND aggregate_id=?
          AND event_type='STAGING_FIRST_OWNER_BOOTSTRAPPED')=1
    THEN 1 ELSE 0 END`).bind(
      staffId, staffId, identityId, staffId, staffId, staffId, staffId,
    );
}

async function bootstrapState(database: SqlDatabase): Promise<{
  staffEmpty: boolean;
  businessStockEmpty: boolean;
}> {
  const row = await database.prepare(`SELECT
    (SELECT COUNT(*) FROM staff_users)
    +(SELECT COUNT(*) FROM staff_role_assignments)
    +(SELECT COUNT(*) FROM staff_email_identities)
    +(SELECT COUNT(*) FROM staff_marketplace_scopes)
    +(SELECT COUNT(*) FROM staff_team_memberships)
    +(SELECT COUNT(*) FROM staff_team_leaders)
    +(SELECT COUNT(*) FROM staff_permission_overrides)
    +(SELECT COUNT(*) FROM staff_availability)
    +(SELECT COUNT(*) FROM staff_assignment_fallbacks)
    +(SELECT COUNT(*) FROM staff_sessions)
    +(SELECT COUNT(*) FROM staff_mcp_subject_bindings)
    +(SELECT COUNT(*) FROM staff_mcp_token_revocations)
    +(SELECT COUNT(*) FROM staff_mcp_replay_records)
    +(SELECT COUNT(*) FROM staff_mcp_rate_limits)
    +(SELECT COUNT(*) FROM staff_assignment_events)
    +(SELECT COUNT(*) FROM staff_assignment_cursors)
    +(SELECT COUNT(*) FROM staff_reassignment_batches)
    +(SELECT COUNT(*) FROM staff_reassignment_batch_items)
    +(SELECT COUNT(*) FROM staff_work_items)
    +(SELECT COUNT(*) FROM staff_role_consolidation_mappings)
    +(SELECT COUNT(*) FROM staff_authorization_events) AS staff_total,
    ${STAGING_ZERO_STOCK_TABLES.map((table) =>
      `(SELECT COUNT(*) FROM ${table})`).join('\n    +')} AS business_total`
  ).first<{staff_total:number;business_total:number}>();
  return {
    staffEmpty: Number(row?.staff_total ?? -1) === 0,
    businessStockEmpty: Number(row?.business_total ?? -1) === 0,
  };
}

function stagingBootstrapAuditStatement(
  database: SqlDatabase,
  id: string,
  staffId: string,
  idempotencyKey: string,
  now: number,
): SqlStatement {
  return database.prepare(`INSERT INTO audit_events(
    id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,
    actor_roles_json,request_id,idempotency_key,previous_state_json,
    next_state_json,reason,metadata_json,created_at
  ) VALUES(?,'STAFF',?,'STAGING_FIRST_OWNER_BOOTSTRAPPED','SYSTEM',NULL,
    '[]',NULL,?,NULL,?,NULL,?,?)`).bind(
      id,
      staffId,
      idempotencyKey,
      canonicalJson({
        assignment_fallback_configured: true,
        buyer_registration_channel_id: STAGING_BUYER_CHANNEL_ID,
        email_identity_created: true,
        role_code: 'owner',
        staff_id: staffId,
        status: 'ACTIVE',
      }),
      canonicalJson({ environment: 'staging', schema_version: TARGET_SCHEMA }),
      now,
    );
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string') throw new StagingFirstOwnerError('INVALID_INPUT');
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new StagingFirstOwnerError('INVALID_INPUT');
  }
  return normalized;
}

function normalizeError(error: unknown): StagingFirstOwnerError {
  if (error instanceof StagingFirstOwnerError) return error;
  if (error instanceof IdempotencyError) {
    if (error.code === 'IDEMPOTENCY_CONFLICT') {
      return new StagingFirstOwnerError('IDEMPOTENCY_CONFLICT');
    }
    if (error.code === 'REQUEST_IN_PROGRESS') {
      return new StagingFirstOwnerError('REQUEST_IN_PROGRESS');
    }
  }
  return new StagingFirstOwnerError('DEPENDENCY_UNAVAILABLE');
}
