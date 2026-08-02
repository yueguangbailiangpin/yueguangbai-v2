import type { SqlDatabase } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  normalizeOrderInstructionError,
  OrderInstructionError,
  requireInstructionBuyerScope,
  requireInstructionPermission,
  validateTimestamp,
  type OrderInstructionStaffActor,
} from './shared';

export async function attachOrderEvidenceInternalCommunication(
  database: SqlDatabase,
  input: {
    submissionId: string;
    slot: number;
    fileObjectId: string;
  },
  command: {
    actor: OrderInstructionStaffActor;
    idempotencyKey: string;
    now?: number;
  },
): Promise<{
  internal_file_id: string;
  submission_id: string;
  slot: number;
  replayed: boolean;
}> {
  requireInstructionPermission(command.actor, 'ORDER_INSTRUCTION_MANAGE');
  const now = validateTimestamp(command.now ?? Date.now());
  if (input.slot !== 1) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  const requestHash = await hashCanonicalJson({
    action: 'ATTACH_ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
    submission_id: input.submissionId,
    slot: input.slot,
    file_object_id: input.fileObjectId,
  });
  const acquired = await acquireIdempotency<any>(database, {
    actorType: 'STAFF', actorId: command.actor.staffId,
    action: 'ATTACH_ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
    targetType: 'ORDER_EVIDENCE_SUBMISSION', targetId: input.submissionId,
    idempotencyKey: command.idempotencyKey, requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const submission = await database.prepare(`
      SELECT buyer_customer_id
      FROM order_evidence_submissions
      WHERE id=?
    `).bind(input.submissionId).first<{ buyer_customer_id: string }>();
    if (!submission) throw new OrderInstructionError('NOT_FOUND', 404);
    await requireInstructionBuyerScope(
      database,
      command.actor,
      submission.buyer_customer_id,
      'ORDER_INSTRUCTION_MANAGE',
    );
    const source = await database.prepare(`
      SELECT object.id, object.detected_mime, object.status,
             intent.owner_actor_type, intent.owner_actor_id
      FROM file_objects object
      JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
      WHERE object.id=? AND object.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
    `).bind(input.fileObjectId).first<{
      id: string;
      detected_mime: string;
      status: string;
      owner_actor_type: string;
      owner_actor_id: string;
    }>();
    if (!source) throw new OrderInstructionError('NOT_FOUND', 404);
    if (source.status !== 'VERIFIED'
      || !['image/jpeg', 'image/png', 'image/webp'].includes(source.detected_mime)
      || source.owner_actor_type !== 'STAFF'
      || source.owner_actor_id !== command.actor.staffId) {
      throw new OrderInstructionError('FILE_NOT_VERIFIED', 409);
    }
    const owner = command.actor.roles.has('owner');
    const [verifiedTeamId] = command.actor.memberTeamIds;
    if (!owner && (command.actor.memberTeamIds.length !== 1
      || verifiedTeamId === undefined)) {
      throw new OrderInstructionError('FORBIDDEN', 403);
    }
    const staffTeamId = owner ? null : verifiedTeamId!;
    const linkId = crypto.randomUUID();
    const recordId = crypto.randomUUID();
    const response = {
      internal_file_id: recordId,
      submission_id: input.submissionId,
      slot: input.slot,
      replayed: false,
    };
    await database.batch([
      database.prepare(`
        INSERT INTO file_entity_links (
          id, file_object_id, entity_type, entity_id, purpose, visibility,
          linked_by_actor_type, linked_by_actor_id, created_at,
          authorization_mode, expires_at, revoked_at
        ) VALUES (?, ?, 'ORDER_EVIDENCE_SUBMISSION', ?,
          'ORDER_EVIDENCE_INTERNAL_COMMUNICATION', 'INTERNAL_ONLY',
          'STAFF', ?, ?, 'EXPLICIT_AUDIENCES', NULL, NULL)
      `).bind(
        linkId,
        input.fileObjectId,
        input.submissionId,
        command.actor.staffId,
        now,
      ),
      database.prepare(`
        INSERT INTO file_entity_audience_grants (
          id, file_entity_link_id, subject_type, buyer_customer_id,
          seller_organization_id, staff_permission_code, staff_scope_type,
          staff_team_id, granted_by_actor_type, granted_by_actor_id,
          created_at, expires_at, revoked_at
        ) VALUES (?, ?, 'STAFF_INTERNAL', NULL, NULL,
          'ORDER_INSTRUCTION_VIEW', ?, ?, 'STAFF', ?, ?, NULL, NULL)
      `).bind(
        crypto.randomUUID(),
        linkId,
        command.actor.roles.has('owner') ? 'GLOBAL' : 'TEAM',
        staffTeamId,
        command.actor.staffId,
        now,
      ),
      database.prepare(`
        INSERT INTO order_evidence_internal_files (
          id, order_evidence_submission_id, slot, file_object_id,
          file_entity_link_id, created_by_staff_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        recordId,
        input.submissionId,
        input.slot,
        input.fileObjectId,
        linkId,
        command.actor.staffId,
        now,
      ),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { internal_file_id: recordId },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizeOrderInstructionError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now)
      .catch(() => false);
    throw normalized;
  }
}
