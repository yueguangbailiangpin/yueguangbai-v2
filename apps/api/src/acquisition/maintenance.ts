import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { canonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import { hashNormalizedWechat, requireAcquisitionSecret } from './privacy';

const LEASE_MS = 5 * 60 * 1000;

export interface AcquisitionMaintenanceResult {
  outcome: 'SUCCEEDED'|'FAILED'|'SKIPPED';
  linked_count: number;
  anonymized_count: number;
  exempt_count: number;
}

interface LeadIdentityRow { id: string; lead_type: 'BUYER'|'SELLER'; identity_hash: string }
interface ClaimRow { id: string; identity_subject_id: string; normalized_wechat: string }
interface CandidateRow { id: string; version: number; status: string }

export async function runAcquisitionMaintenance(
  database: SqlDatabase,
  input: { identitySecret: string; now?: number; dryRun?: boolean; limit?: number },
): Promise<AcquisitionMaintenanceResult> {
  const secret = requireAcquisitionSecret(input.identitySecret);
  const now = input.now ?? Date.now();
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('invalid_acquisition_maintenance_input');
  }
  if (input.dryRun) return inspectMaintenance(database, secret, now, limit);

  const leaseToken = `acquisition-maintenance:${crypto.randomUUID()}`;
  const lease = await database.prepare(`UPDATE acquisition_maintenance_state
    SET lease_token=?,lease_expires_at=?,last_started_at=?,last_error_code=NULL,
      version=version+1,updated_at=?
    WHERE singleton_id=1
      AND (lease_token IS NULL OR lease_expires_at<=?)`).bind(
      leaseToken, now + LEASE_MS, now, now, now,
    ).run();
  if (Number(lease.meta.changes) !== 1) {
    await recordRun(database, 'SKIPPED', 0, 0, 0, null, now);
    return { outcome: 'SKIPPED', linked_count: 0, anonymized_count: 0, exempt_count: 0 };
  }

  let linked = 0; let anonymized = 0; let exempt = 0;
  try {
    const state = await database.prepare(`SELECT link_claim_cursor
      FROM acquisition_maintenance_state WHERE singleton_id=1 AND lease_token=?`)
      .bind(leaseToken).first<{ link_claim_cursor: string|null }>();
    const reconciliation = await reconcileLinks(
      database, secret, now, limit, state?.link_claim_cursor ?? null,
    );
    linked = reconciliation.linked;
    exempt = await countRetentionExemptions(database, now);
    const candidates = await selectAnonymizationCandidates(database, now, limit);
    for (const candidate of candidates.results) {
      const nextVersion = Number(candidate.version) + 1;
      const results = await database.batch([
        database.prepare(`UPDATE acquisition_leads SET
          identity_hash=NULL,identity_ciphertext=NULL,identity_iv=NULL,
          wechat_masked='已匿名化',display_name=NULL,note=NULL,
          status='ANONYMIZED',invalidation_reason=NULL,invalidated_at=NULL,
          anonymized_at=?,version=version+1,updated_at=?
          WHERE id=? AND version=? AND status IN ('ACTIVE','INVALIDATED')
            AND retention_due_at<=? AND retention_hold_reason IS NULL
            AND NOT EXISTS (SELECT 1 FROM acquisition_lead_links link
              WHERE link.lead_id=acquisition_leads.id AND link.link_type IN (
                'BUYER_CUSTOMER','RESERVATION','FORMAL_ORDER','SELLER_ORGANIZATION'
              ))
            AND NOT EXISTS (
              SELECT 1 FROM acquisition_lead_links identity_link
              JOIN customer_login_accounts account
                ON account.identity_subject_id=identity_link.target_id
              JOIN customer_auth_security_events security ON security.account_id=account.id
              WHERE identity_link.lead_id=acquisition_leads.id
                AND identity_link.link_type='IDENTITY_SUBJECT'
            )`).bind(
          now, now, candidate.id, candidate.version, now,
        ),
        database.prepare(`INSERT INTO acquisition_lead_events (
          id,lead_id,event_type,previous_version,next_version,actor_type,actor_id,
          idempotency_key,request_hash,reason,metadata_json,created_at
        ) VALUES (?,?,'ANONYMIZED',?,?,'SYSTEM',NULL,NULL,NULL,
          'TWELVE_MONTH_UNCONVERTED_RETENTION',?,?)`).bind(
          crypto.randomUUID(), candidate.id, candidate.version, nextVersion,
          canonicalJson({ retention_policy: 'TWELVE_SHANGHAI_MONTHS' }), now,
        ),
        createAuditEventStatement(database, {
          id: crypto.randomUUID(), aggregateType: 'ACQUISITION_LEAD',
          aggregateId: candidate.id, eventType: 'ACQUISITION_LEAD_ANONYMIZED',
          actor: { type: 'SYSTEM', id: null, roles: [] },
          previousState: { status: candidate.status, version: candidate.version,
            private_identity_present: true },
          nextState: { status: 'ANONYMIZED', version: nextVersion,
            private_identity_present: false },
          reason: 'TWELVE_MONTH_UNCONVERTED_RETENTION', createdAt: now,
        }),
        database.prepare(`INSERT INTO transaction_assertions (assertion_value)
          SELECT CASE WHEN EXISTS (
            SELECT 1 FROM acquisition_leads WHERE id=? AND version=?
              AND status='ANONYMIZED' AND identity_hash IS NULL
              AND identity_ciphertext IS NULL AND identity_iv IS NULL
              AND display_name IS NULL AND note IS NULL
          ) THEN 1 ELSE 0 END`).bind(candidate.id, nextVersion),
      ]);
      if (Number(results[0]?.meta.changes ?? 0) === 1) anonymized += 1;
    }
    await database.batch([
      database.prepare(`UPDATE acquisition_maintenance_state SET
        lease_token=NULL,lease_expires_at=NULL,link_claim_cursor=?,last_succeeded_at=?,
        last_error_code=NULL,version=version+1,updated_at=?
        WHERE singleton_id=1 AND lease_token=?`).bind(
        reconciliation.nextClaimCursor, now, now, leaseToken,
      ),
      database.prepare(`INSERT INTO acquisition_maintenance_runs (
        id,trigger_type,outcome,linked_count,anonymized_count,exempt_count,
        failure_code,started_at,finished_at
      ) VALUES (?,'CRON','SUCCEEDED',?,?,?,NULL,?,?)`).bind(
        crypto.randomUUID(), linked, anonymized, exempt, now, now,
      ),
      database.prepare(`INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM acquisition_maintenance_state
          WHERE singleton_id=1 AND lease_token IS NULL
            AND last_succeeded_at=?
        ) THEN 1 ELSE 0 END`).bind(now),
    ]);
    return { outcome: 'SUCCEEDED', linked_count: linked,
      anonymized_count: anonymized, exempt_count: exempt };
  } catch (error) {
    await database.batch([
      database.prepare(`UPDATE acquisition_maintenance_state SET
        lease_token=NULL,lease_expires_at=NULL,last_failed_at=?,
        last_error_code='ACQUISITION_MAINTENANCE_FAILED',
        version=version+1,updated_at=?
        WHERE singleton_id=1 AND lease_token=?`).bind(now, now, leaseToken),
      database.prepare(`INSERT INTO acquisition_maintenance_runs (
        id,trigger_type,outcome,linked_count,anonymized_count,exempt_count,
        failure_code,started_at,finished_at
      ) VALUES (?,'CRON','FAILED',?,?,?,
        'ACQUISITION_MAINTENANCE_FAILED',?,?)`).bind(
        crypto.randomUUID(), linked, anonymized, exempt, now, now,
      ),
    ]).catch(() => []);
    throw error;
  }
}

async function inspectMaintenance(
  database: SqlDatabase,
  secret: string,
  now: number,
  limit: number,
): Promise<AcquisitionMaintenanceResult> {
  const state = await database.prepare(`SELECT link_claim_cursor
    FROM acquisition_maintenance_state WHERE singleton_id=1`)
    .first<{ link_claim_cursor: string|null }>();
  const [claims, candidates, exempt] = await Promise.all([
    selectClaimChunk(database, state?.link_claim_cursor ?? null, limit),
    selectAnonymizationCandidates(database, now, limit),
    countRetentionExemptions(database, now),
  ]);
  let linkable = 0;
  for (const claim of claims) {
    const hash = await hashNormalizedWechat(claim.normalized_wechat, secret);
    const row = await database.prepare(`SELECT COUNT(*) AS count
      FROM acquisition_leads WHERE status IN ('ACTIVE','INVALIDATED')
        AND identity_hash=?`).bind(hash).first<{ count: number }>();
    linkable += Number(row?.count ?? 0);
  }
  return { outcome: 'SUCCEEDED', linked_count: linkable,
    anonymized_count: candidates.results.length, exempt_count: exempt };
}

async function reconcileLinks(
  database: SqlDatabase,
  secret: string,
  now: number,
  limit: number,
  claimCursor: string|null,
): Promise<{ linked: number; nextClaimCursor: string|null }> {
  const claims = await selectClaimChunk(database, claimCursor, limit);
  let linked = 0;
  for (const claim of claims) {
    const hash = await hashNormalizedWechat(claim.normalized_wechat, secret);
    const leads = await database.prepare(`SELECT id,lead_type,identity_hash
      FROM acquisition_leads WHERE status IN ('ACTIVE','INVALIDATED')
        AND identity_hash=? ORDER BY id`).bind(hash).all<LeadIdentityRow>();
    for (const lead of leads.results) {
      const statements = linkStatements(database, lead, claim.identity_subject_id, now);
      const results = await database.batch(statements);
      linked += results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0);
    }
  }
  return {
    linked,
    nextClaimCursor: claims.length === limit ? claims.at(-1)!.id : null,
  };
}

async function selectClaimChunk(
  database: SqlDatabase,
  cursor: string|null,
  limit: number,
): Promise<ClaimRow[]> {
  const query = (after: string|null) => database.prepare(`SELECT id,identity_subject_id,
    normalized_wechat FROM wechat_identity_claims
    WHERE status='ACTIVE' AND (? IS NULL OR id>?) ORDER BY id LIMIT ?`)
    .bind(after, after, limit).all<ClaimRow>();
  let rows = await query(cursor);
  if (rows.results.length === 0 && cursor !== null) rows = await query(null);
  return rows.results;
}

function selectAnonymizationCandidates(
  database: SqlDatabase,
  now: number,
  limit: number,
) {
  return database.prepare(`SELECT lead.id,lead.version,lead.status
    FROM acquisition_leads lead
    WHERE lead.status IN ('ACTIVE','INVALIDATED') AND lead.retention_due_at<=?
      AND lead.retention_hold_reason IS NULL
      AND NOT EXISTS (SELECT 1 FROM acquisition_lead_links link
        WHERE link.lead_id=lead.id AND link.link_type IN (
          'BUYER_CUSTOMER','RESERVATION','FORMAL_ORDER','SELLER_ORGANIZATION'
        ))
      AND NOT EXISTS (
        SELECT 1 FROM acquisition_lead_links identity_link
        JOIN customer_login_accounts account
          ON account.identity_subject_id=identity_link.target_id
        JOIN customer_auth_security_events security ON security.account_id=account.id
        WHERE identity_link.lead_id=lead.id
          AND identity_link.link_type='IDENTITY_SUBJECT'
      )
    ORDER BY lead.retention_due_at,lead.id LIMIT ?`).bind(now, limit).all<CandidateRow>();
}

async function countRetentionExemptions(
  database: SqlDatabase,
  now: number,
): Promise<number> {
  const row = await database.prepare(`SELECT COUNT(*) AS count
    FROM acquisition_leads lead
    WHERE lead.status IN ('ACTIVE','INVALIDATED') AND lead.retention_due_at<=?
      AND (
        lead.retention_hold_reason IS NOT NULL
        OR EXISTS (SELECT 1 FROM acquisition_lead_links link
          WHERE link.lead_id=lead.id AND link.link_type IN (
            'BUYER_CUSTOMER','RESERVATION','FORMAL_ORDER','SELLER_ORGANIZATION'
          ))
        OR EXISTS (
          SELECT 1 FROM acquisition_lead_links identity_link
          JOIN customer_login_accounts account
            ON account.identity_subject_id=identity_link.target_id
          JOIN customer_auth_security_events security ON security.account_id=account.id
          WHERE identity_link.lead_id=lead.id
            AND identity_link.link_type='IDENTITY_SUBJECT'
        )
      )`).bind(now).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function linkStatements(
  database: SqlDatabase,
  lead: LeadIdentityRow,
  subjectId: string,
  now: number,
): SqlStatement[] {
  const insert = (type: string, sql: string, bindings: unknown[]) =>
    database.prepare(`INSERT OR IGNORE INTO acquisition_lead_links (
      id,lead_id,link_type,target_id,linked_at
    ) SELECT lower(hex(randomblob(16))),?,'${type}',target.id,?
      FROM (${sql}) target`).bind(lead.id, now, ...bindings);
  return [
    insert('IDENTITY_SUBJECT', `SELECT ? AS id`, [subjectId]),
    ...(lead.lead_type === 'BUYER' ? [
      insert('BUYER_CUSTOMER', `SELECT id FROM buyer_customers
        WHERE identity_subject_id=?`, [subjectId]),
      insert('RESERVATION', `SELECT reservation.id FROM product_reservations reservation
        JOIN buyer_customers buyer ON buyer.id=reservation.buyer_customer_id
        WHERE buyer.identity_subject_id=?`, [subjectId]),
      insert('FORMAL_ORDER', `SELECT formal_order.id FROM formal_orders formal_order
        JOIN buyer_customers buyer ON buyer.id=formal_order.buyer_customer_id
        WHERE buyer.identity_subject_id=?`, [subjectId]),
    ] : [
      insert('SELLER_MEMBER', `SELECT id FROM seller_organization_members
        WHERE identity_subject_id=?`, [subjectId]),
      insert('SELLER_ORGANIZATION', `SELECT organization.id
        FROM seller_organization_members member
        JOIN seller_organizations organization ON organization.id=member.organization_id
        WHERE member.identity_subject_id=? AND member.status='ACTIVE'
          AND organization.status='ACTIVE'`, [subjectId]),
    ]),
  ];
}

async function recordRun(
  database: SqlDatabase,
  outcome: 'SKIPPED',
  linked: number,
  anonymized: number,
  exempt: number,
  failure: string|null,
  now: number,
): Promise<void> {
  await database.prepare(`INSERT INTO acquisition_maintenance_runs (
    id,trigger_type,outcome,linked_count,anonymized_count,exempt_count,
    failure_code,started_at,finished_at
  ) VALUES (?,'CRON',?,?,?,?,?,?,?)`).bind(
    crypto.randomUUID(), outcome, linked, anonymized, exempt, failure, now, now,
  ).run();
}
