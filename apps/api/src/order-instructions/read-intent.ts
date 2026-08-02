import type {
  BuyerInstructionReadIntentDto,
  SqlDatabase,
} from '@ygb/contracts';
import {
  generateOpaqueFileToken,
  hashCanonicalJson,
  hashOpaqueFileToken,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  instructionCanReadImages,
  normalizeOrderInstructionError,
  OrderInstructionError,
  validateBuyerActor,
  validateTimestamp,
  type BuyerInstructionActor,
} from './shared';
import { requireInstructionContextForReservation } from './records';
import { expireInstructionIfDue } from './expiry';

const READ_TTL_MS = 5 * 60 * 1000;

export async function createBuyerInstructionImageReadIntent(
  database: SqlDatabase,
  input: {
    reservationId: string;
    position: number | 'main';
  },
  command: {
    actor: BuyerInstructionActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<BuyerInstructionReadIntentDto> {
  validateBuyerActor(command.actor);
  const now = validateTimestamp(command.now ?? Date.now());
  if (input.position !== 'main'
    && (!Number.isSafeInteger(input.position) || input.position < 1)) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  let source = await requireInstructionContextForReservation(
    database,
    input.reservationId,
    command.actor.buyerCustomerId,
  );
  source = await expireInstructionIfDue(database, source.instruction_id, {
    actorType: 'SYSTEM',
    actorId: `buyer-file-read:${command.actor.buyerCustomerId}`,
    now,
  });
  if (!instructionCanReadImages({
    status: source.instruction_status,
    evidenceStatus: source.evidence_status,
    resubmissionDeadlineAt: source.resubmission_deadline_at,
    formalOrderId: source.formal_order_id,
    now,
  })) {
    throw new OrderInstructionError('FILE_ACCESS_DENIED', 403);
  }
  const image = await resolveCurrentImage(
    database,
    source.instruction_id,
    source.current_version_no,
    input.position,
    command.actor.buyerCustomerId,
    now,
  );

  const requestHash = await hashCanonicalJson({
    action: 'CREATE_BUYER_INSTRUCTION_IMAGE_READ_INTENT',
    reservation_id: input.reservationId,
    instruction_id: source.instruction_id,
    current_version_no: source.current_version_no,
    image_selector: input.position,
  });
  const acquired = await acquireIdempotency<BuyerInstructionReadIntentDto>(
    database,
    {
      actorType: 'BUYER_CUSTOMER',
      actorId: command.actor.buyerCustomerId,
      action: 'CREATE_BUYER_INSTRUCTION_IMAGE_READ_INTENT',
      targetType: 'ORDER_INSTRUCTION',
      targetId: source.instruction_id,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return {
      ...acquired.response,
      access_token: null,
      access_token_available: false,
    };
  }

  try {
    const readIntentId = crypto.randomUUID();
    const token = generateOpaqueFileToken();
    const tokenHash = await hashOpaqueFileToken(token);
    const expiresAt = now + READ_TTL_MS;
    const firstResponse: BuyerInstructionReadIntentDto = {
      read_intent_id: readIntentId,
      access_token: token,
      access_token_available: true,
      expires_at: expiresAt,
    };
    const storedResponse: BuyerInstructionReadIntentDto = {
      ...firstResponse,
      access_token: null,
      access_token_available: false,
    };
    await database.batch([
      database.prepare(`
        INSERT INTO file_read_intents (
          id, file_object_id, actor_type, actor_id, token_hash,
          status, use_count, expires_at, created_at, updated_at,
          consumed_at, revoked_at, file_entity_link_id
        ) VALUES (?, ?, 'BUYER_CUSTOMER', ?, ?, 'ISSUED', 0,
          ?, ?, ?, NULL, NULL, ?)
      `).bind(
        readIntentId,
        image.file_object_id,
        command.actor.buyerCustomerId,
        tokenHash,
        expiresAt,
        now,
        now,
        image.file_entity_link_id,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ORDER_INSTRUCTION',
        aggregateId: source.instruction_id,
        eventType: 'ORDER_INSTRUCTION_IMAGE_READ_INTENT_ISSUED',
        actor: {
          type: 'BUYER_CUSTOMER',
          id: command.actor.buyerCustomerId,
          roles: [],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: {
          read_intent_id: readIntentId,
          expires_at: expiresAt,
          image_selector: input.position,
          instruction_version_no: source.current_version_no,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, storedResponse, {
        resultReferences: { read_intent_id: readIntentId },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM file_read_intents
          WHERE id=? AND file_entity_link_id=? AND status='ISSUED'
        ) THEN 1 ELSE 0 END
      `).bind(readIntentId, image.file_entity_link_id),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return firstResponse;
  } catch (error) {
    const normalized = normalizeOrderInstructionError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

async function resolveCurrentImage(
  database: SqlDatabase,
  instructionId: string,
  currentVersionNo: number,
  position: number | 'main',
  buyerCustomerId: string,
  now: number,
): Promise<{ file_object_id: string; file_entity_link_id: string }> {
  const selector = position === 'main'
    ? `version.main_image_file_entity_link_id=link.id`
    : `keyword.file_entity_link_id=link.id AND keyword.keyword_position=?`;
  const row = await database.prepare(`
    SELECT link.file_object_id, link.id AS file_entity_link_id
    FROM order_instruction_versions version
    JOIN file_entity_links link
      ON link.entity_type='ORDER_INSTRUCTION_VERSION'
      AND link.entity_id=version.id
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
    ${position === 'main'
      ? ''
      : `JOIN order_instruction_keyword_images keyword
           ON keyword.order_instruction_version_id=version.id`}
    JOIN file_objects object
      ON object.id=link.file_object_id AND object.status='VERIFIED'
    JOIN file_entity_audience_grants grant
      ON grant.file_entity_link_id=link.id
      AND grant.subject_type='BUYER'
      AND grant.buyer_customer_id=?
      AND grant.revoked_at IS NULL
      AND (grant.expires_at IS NULL OR grant.expires_at>?)
    WHERE version.instruction_id=? AND version.version_no=?
      AND ${selector}
    LIMIT 1
  `).bind(
    now,
    buyerCustomerId,
    now,
    instructionId,
    currentVersionNo,
    ...(position === 'main' ? [] : [position]),
  ).first<{ file_object_id: string; file_entity_link_id: string }>();
  if (!row) throw new OrderInstructionError('FILE_ACCESS_DENIED', 403);
  return row;
}
