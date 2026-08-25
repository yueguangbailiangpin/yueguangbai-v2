import type { SqlDatabase } from '@ygb/contracts';
import { createAuditEventStatement } from '../foundation/audit';
import { createOutboxStatements, prepareOutboxEvent } from '../foundation/outbox';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import {
  acquireAcquisitionCommand,
  failAcquisitionCommand,
  finishAcquisitionCommand,
  type AcquisitionCommandContext,
} from './command';
import { AcquisitionError } from './errors';
import { requireAcquisitionOperator } from './authorization';

export async function listSourceCorrectionCandidates(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  limit = 100,
) {
  requireAcquisitionOperator(actor);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new AcquisitionError('VALIDATION_ERROR', 400);
  const markets = actor.roles.has('owner')
    ? []
    : await resolveStaffMarketplaceCodes(database, actor);
  if (!actor.roles.has('owner') && markets.length === 0) return Object.freeze([]);
  const where = markets.length
    ? `WHERE fact.marketplace_code IN (${markets.map(() => '?').join(',')})`
    : '';
  const rows = await database
    .prepare(
      `SELECT fact.lead_id,lead.lead_type,fact.marketplace_code,fact.business_date,
      lead.display_name,lead.wechat_masked,fact.original_channel_id,original.display_name AS original_channel_name,
      COALESCE((SELECT correction.new_channel_id FROM acquisition_lead_source_corrections correction
        WHERE correction.lead_id=fact.lead_id ORDER BY correction.corrected_at DESC,correction.id DESC LIMIT 1),fact.original_channel_id) AS effective_channel_id,
      COALESCE((SELECT channel.display_name FROM acquisition_lead_source_corrections correction
        JOIN acquisition_channels channel ON channel.id=correction.new_channel_id
        WHERE correction.lead_id=fact.lead_id ORDER BY correction.corrected_at DESC,correction.id DESC LIMIT 1),original.display_name) AS effective_channel_name,
      (SELECT COUNT(*) FROM acquisition_lead_source_corrections correction WHERE correction.lead_id=fact.lead_id) AS correction_count
    FROM acquisition_customer_intake_facts fact JOIN acquisition_leads lead ON lead.id=fact.lead_id
    JOIN acquisition_channels original ON original.id=fact.original_channel_id ${where}
    ORDER BY fact.recorded_at DESC,fact.lead_id DESC LIMIT ?`,
    )
    .bind(...markets, limit)
    .all<any>();
  return Object.freeze(
    rows.results.map((row) =>
      Object.freeze({
        lead_id: String(row.lead_id),
        lead_type: row.lead_type as 'BUYER' | 'SELLER',
        marketplace_code: String(row.marketplace_code),
        business_date: String(row.business_date),
        display_name: row.display_name === null ? null : String(row.display_name),
        wechat_masked: String(row.wechat_masked),
        original_channel_id: String(row.original_channel_id),
        original_channel_name: String(row.original_channel_name),
        effective_channel_id: String(row.effective_channel_id),
        effective_channel_name: String(row.effective_channel_name),
        correction_count: Number(row.correction_count),
      }),
    ),
  );
}

export async function correctLeadSource(
  database: SqlDatabase,
  input: {
    leadId: string;
    newChannelId: string;
    expectedCorrectionSequence: number;
    reason: string;
  },
  command: AcquisitionCommandContext,
) {
  requireAcquisitionOperator(command.actor);
  const reason = input.reason.normalize('NFKC').trim();
  if (
    reason.length < 3 ||
    reason.length > 1000 ||
    !Number.isSafeInteger(input.expectedCorrectionSequence) ||
    input.expectedCorrectionSequence < 0
  )
    throw new AcquisitionError('VALIDATION_ERROR', 400);
  const leadId = clean(input.leadId),
    newChannelId = clean(input.newChannelId),
    expected = input.expectedCorrectionSequence;
  const acquired = await acquireAcquisitionCommand<{
    correction: {
      correction_id: string;
      lead_id: string;
      previous_channel_id: string;
      new_channel_id: string;
      new_channel_name: string;
      reason: string;
      corrected_at: number;
      correction_sequence: number;
    };
  }>(database, command, 'CORRECT_ACQUISITION_LEAD_SOURCE', 'ACQUISITION_LEAD', leadId, {
    lead_id: leadId,
    new_channel_id: newChannelId,
    expected_correction_sequence: expected,
    reason,
  });
  if (acquired.acquired.kind === 'REPLAY') return { ...acquired.acquired.response, replayed: true };
  try {
    const lead = await database
      .prepare(
        `SELECT lead.id,lead.lead_type,lead.marketplace_code,fact.original_channel_id
      FROM acquisition_leads lead JOIN acquisition_customer_intake_facts fact ON fact.lead_id=lead.id WHERE lead.id=?`,
      )
      .bind(leadId)
      .first<any>();
    if (!lead) throw new AcquisitionError('NOT_FOUND', 404);
    await requireMarket(database, command.actor, String(lead.marketplace_code));
    const channel = await database
      .prepare(
        `SELECT id,lead_type,marketplace_code,display_name,status FROM acquisition_channels WHERE id=?`,
      )
      .bind(newChannelId)
      .first<any>();
    if (!channel || String(channel.marketplace_code) !== String(lead.marketplace_code))
      throw new AcquisitionError('NOT_FOUND', 404);
    if (
      channel.status !== 'ACTIVE' ||
      !(channel.lead_type === lead.lead_type || channel.lead_type === 'BOTH')
    )
      throw new AcquisitionError('VALIDATION_ERROR', 400);
    const currentState = await effectiveChannelState(
      database,
      leadId,
      String(lead.original_channel_id),
    );
    if (currentState.sequence !== expected) throw new AcquisitionError('VERSION_CONFLICT', 409);
    if (currentState.channelId === newChannelId) throw new AcquisitionError('STATE_CONFLICT', 409);
    const correctionId = crypto.randomUUID();
    const correction = Object.freeze({
      correction_id: correctionId,
      lead_id: leadId,
      previous_channel_id: currentState.channelId,
      new_channel_id: newChannelId,
      new_channel_name: String(channel.display_name),
      reason,
      corrected_at: acquired.now,
      correction_sequence: expected + 1,
    });
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `acquisition-source-corrected:${correctionId}`,
      eventType: 'ACQUISITION_SOURCE_CORRECTED',
      aggregateType: 'ACQUISITION_LEAD',
      aggregateId: leadId,
      payload: { ...correction },
      createdAt: acquired.now,
    });
    await database.batch([
      database
        .prepare(
          `INSERT INTO acquisition_lead_source_corrections(id,lead_id,previous_channel_id,new_channel_id,reason,corrected_by_staff_id,corrected_at)
        SELECT ?,?,?,?,?,?,? WHERE
          (SELECT COUNT(*) FROM acquisition_lead_source_corrections WHERE lead_id=?)=?
          AND COALESCE((SELECT new_channel_id FROM acquisition_lead_source_corrections WHERE lead_id=? ORDER BY corrected_at DESC,id DESC LIMIT 1),?)=?`,
        )
        .bind(
          correctionId,
          leadId,
          currentState.channelId,
          newChannelId,
          reason,
          command.actor.staffId,
          acquired.now,
          leadId,
          expected,
          leadId,
          String(lead.original_channel_id),
          currentState.channelId,
        ),
      database.prepare(
        `INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END`,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ACQUISITION_LEAD',
        aggregateId: leadId,
        eventType: 'ACQUISITION_SOURCE_CORRECTED',
        actor: { type: 'STAFF', id: command.actor.staffId, roles: [...command.actor.roles] },
        requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        previousState: { channel_id: currentState.channelId, correction_sequence: expected },
        nextState: {
          channel_id: newChannelId,
          channel_name: String(channel.display_name),
          correction_sequence: expected + 1,
        },
        reason,
        createdAt: acquired.now,
      }),
      ...createOutboxStatements(database, outbox),
      ...finishAcquisitionCommand(database, acquired.acquired.claim, { correction }, acquired.now, {
        lead_id: leadId,
        correction_id: correctionId,
      }),
      database
        .prepare(
          `INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN
        (SELECT COUNT(*) FROM acquisition_lead_source_corrections WHERE lead_id=?)=?
        AND (SELECT id FROM acquisition_lead_source_corrections WHERE lead_id=? ORDER BY corrected_at DESC,id DESC LIMIT 1)=?
        THEN 1 ELSE 0 END`,
        )
        .bind(leadId, expected + 1, leadId, correctionId),
    ]);
    return { correction, replayed: false };
  } catch (error) {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    if (error instanceof AcquisitionError) throw error;
    if (String(error).includes('transaction_assertion_failed')) {
      const latest = await database
        .prepare(
          `SELECT COUNT(*) AS count FROM acquisition_lead_source_corrections WHERE lead_id=?`,
        )
        .bind(leadId)
        .first<{ count: number }>()
        .catch(() => null);
      if (latest && Number(latest.count) !== expected)
        throw new AcquisitionError('VERSION_CONFLICT', 409);
    }
    throw error;
  }
}
async function effectiveChannelState(
  database: SqlDatabase,
  leadId: string,
  original: string,
): Promise<{ channelId: string; sequence: number }> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS sequence,(SELECT new_channel_id FROM acquisition_lead_source_corrections WHERE lead_id=? ORDER BY corrected_at DESC,id DESC LIMIT 1) AS new_channel_id FROM acquisition_lead_source_corrections WHERE lead_id=?`,
    )
    .bind(leadId, leadId)
    .first<{ sequence: number; new_channel_id: string | null }>();
  return { channelId: row?.new_channel_id ?? original, sequence: Number(row?.sequence ?? 0) };
}
async function requireMarket(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  market: string,
) {
  if (actor.roles.has('owner')) return;
  const markets = await resolveStaffMarketplaceCodes(database, actor);
  if (!markets.includes(market)) throw new AcquisitionError('NOT_FOUND', 404);
}
function clean(value: string) {
  const v = value.normalize('NFKC').trim();
  if (v.length < 1 || v.length > 200 || /[\u0000-\u001f\u007f]/u.test(v))
    throw new AcquisitionError('VALIDATION_ERROR', 400);
  return v;
}
