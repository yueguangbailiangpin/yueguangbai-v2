import type {
  SqlDatabase,
  SqlStatement,
  StaffOrderInstructionSummaryDto,
} from '@ygb/contracts';
import {
  calculateBuyerSelfPayFacts,
  canonicalJson,
  orderInstructionContentHash,
  parseJpyInteger,
  sha256Hex,
  toD1SafeInteger,
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
  prepareWorkItemCompletionStatements,
  requireAssignedWorkflowActor,
} from '../staff-assignment';
import {
  cleanIdentifier,
  cleanOptionalPublicText,
  insertInstructionEventStatement,
  normalizeOrderInstructionError,
  OrderInstructionError,
  requireInstructionBuyerScope,
  requireInstructionPermission,
  SIX_HOURS_MS,
  validateExpectedVersion,
  validateTimestamp,
  type OrderInstructionStaffActor,
} from './shared';
import {
  parseOrderedKeywords,
  requireInstructionContext,
  requireMainImage,
} from './records';

export interface PublishOrderInstructionResult {
  instruction: StaffOrderInstructionSummaryDto;
  instruction_version_id: string;
  content_hash: string;
  replayed: boolean;
  unchanged: boolean;
}

export async function publishOrderInstruction(
  database: SqlDatabase,
  input: {
    instructionId: string;
    expectedVersion: number;
    staffPublicNote?: string | null;
  },
  command: {
    actor: OrderInstructionStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<PublishOrderInstructionResult> {
  requireInstructionPermission(command.actor, 'ORDER_INSTRUCTION_PUBLISH');
  const instructionId = cleanIdentifier(input.instructionId);
  const expectedVersion = validateExpectedVersion(input.expectedVersion);
  const staffPublicNote = cleanOptionalPublicText(input.staffPublicNote, 2000);
  const now = validateTimestamp(command.now ?? Date.now());

  const requestHash = await sha256Hex(canonicalJson({
    action: 'PUBLISH_ORDER_INSTRUCTION',
    instruction_id: instructionId,
    expected_version: expectedVersion,
    staff_public_note: staffPublicNote,
  }));
  const acquired = await acquireIdempotency<PublishOrderInstructionResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'PUBLISH_ORDER_INSTRUCTION',
      targetType: 'ORDER_INSTRUCTION',
      targetId: instructionId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const source = await requireInstructionContext(database, instructionId);
    await requireInstructionBuyerScope(
      database,
      command.actor,
      source.buyer_customer_id,
      'ORDER_INSTRUCTION_PUBLISH',
    );
    if (source.instruction_version !== expectedVersion) {
      throw new OrderInstructionError('VERSION_CONFLICT', 409);
    }
    if (source.reservation_status !== 'APPROVED') {
      throw new OrderInstructionError('RESERVATION_NOT_APPROVED', 409);
    }
    if (source.instruction_status !== 'UNPUBLISHED'
      && source.instruction_status !== 'ACTIVE') {
      throw new OrderInstructionError('INSTRUCTION_TERMINAL', 409);
    }
    if (source.evidence_version_count > 0) {
      throw new OrderInstructionError('EVIDENCE_ALREADY_EXISTS', 409);
    }
    const initialPublication = source.current_version_no === 0;
    if (initialPublication && source.order_deadline - now < SIX_HOURS_MS) {
      throw new OrderInstructionError('INSUFFICIENT_ORDER_WINDOW', 409);
    }
    if (!initialPublication
      && (source.initial_deadline_at == null
        || source.initial_deadline_at <= now)) {
      throw new OrderInstructionError('INSUFFICIENT_ORDER_WINDOW', 409);
    }
    if (source.ordering_guide_expected_amount_jpy == null
      || source.color_spec_mode == null) {
      throw new OrderInstructionError('ORDERING_PROFILE_REQUIRED', 409);
    }
    const expectedAmount = Number(source.ordering_guide_expected_amount_jpy);
    if (!Number.isSafeInteger(expectedAmount) || expectedAmount < 0) {
      throw new OrderInstructionError('ORDERING_PROFILE_REQUIRED', 409);
    }
    const orderedKeywords = parseOrderedKeywords(source.search_keywords_json);
    const mainImage = await requireMainImage(
      database,
      source.product_version_id,
    );

    await requireAssignedWorkflowActor(database, {
      staffId: command.actor.staffId,
      workType: 'ORDER_INSTRUCTION_PUBLISH',
      sourceEntityType: 'ORDER_INSTRUCTION',
      sourceEntityId: instructionId,
    });

    const initialDeadlineAt = initialPublication
      ? now + SIX_HOURS_MS
      : source.initial_deadline_at!;
    const publishedAt = source.published_at ?? now;
    const selfPayFacts = calculateBuyerSelfPayFacts(
      parseJpyInteger(String(expectedAmount)),
      Number(source.buyer_self_pay_bps_snapshot),
    );
    const contentHash = await orderInstructionContentHash({
      reservationId: source.reservation_id,
      productVersionId: source.product_version_id,
      productVersionNo: Number(source.product_version_no),
      productName: source.product_name,
      mainImageFileObjectId: mainImage.file_object_id,
      mainImageSha256: mainImage.sha256,
      storeDisplayName: source.store_display_name,
      buyerVisibleNotes: source.buyer_visible_notes,
      staffPublicNote,
      referenceOrderAmountJpy: expectedAmount,
      buyerSelfPayBps: Number(source.buyer_self_pay_bps_snapshot),
      colorSpecMode: source.color_spec_mode,
      orderedKeywords,
    });

    const current = await database.prepare(`
      SELECT id, content_hash
      FROM order_instruction_versions
      WHERE instruction_id=? AND version_no=?
    `).bind(
      instructionId,
      source.current_version_no,
    ).first<{ id: string; content_hash: string }>();
    if (current?.content_hash === contentHash) {
      const response: PublishOrderInstructionResult = {
        instruction: summary(source),
        instruction_version_id: current.id,
        content_hash: contentHash,
        replayed: false,
        unchanged: true,
      };
      await database.batch([
        ...await prepareWorkItemCompletionStatements(database, {
          workType: 'ORDER_INSTRUCTION_PUBLISH',
          sourceEntityType: 'ORDER_INSTRUCTION',
          sourceEntityId: instructionId,
          outcome: 'COMPLETED',
          actorType: 'STAFF',
          actorId: command.actor.staffId,
          requestId: command.requestId ?? null,
          idempotencyKey: acquired.claim.idempotencyKey,
          now,
        }),
        completeIdempotencyStatement(database, acquired.claim, response, {
          resultReferences: {
            instruction_id: instructionId,
            instruction_version_id: current.id,
          },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      return response;
    }

    const nextVersionNo = source.current_version_no + 1;
    const nextAggregateVersion = source.instruction_version + 1;
    const instructionVersionId = crypto.randomUUID();
    const mainImageLinkId = crypto.randomUUID();
    const mainBuyerGrantId = crypto.randomUUID();
    const mainStaffGrantId = crypto.randomUUID();
    const nextSummary: StaffOrderInstructionSummaryDto = {
      instruction_id: instructionId,
      reservation_id: source.reservation_id,
      buyer_customer_id: source.buyer_customer_id,
      marketplace_code: source.marketplace_code,
      status: 'ACTIVE',
      current_version_no: nextVersionNo,
      version: nextAggregateVersion,
      published_at: publishedAt,
      initial_deadline_at: initialDeadlineAt,
      resubmission_deadline_at: null,
      expired_at: null,
      cancelled_at: null,
      completed_at: null,
    };
    const response: PublishOrderInstructionResult = {
      instruction: nextSummary,
      instruction_version_id: instructionVersionId,
      content_hash: contentHash,
      replayed: false,
      unchanged: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `order-instruction-published:${instructionVersionId}`,
      eventType: source.current_version_no === 0
        ? 'ORDER_INSTRUCTION_PUBLISHED'
        : 'ORDER_INSTRUCTION_REPUBLISHED',
      aggregateType: 'ORDER_INSTRUCTION',
      aggregateId: instructionId,
      payload: {
        instruction_id: instructionId,
        reservation_id: source.reservation_id,
        buyer_customer_id: source.buyer_customer_id,
        version_no: nextVersionNo,
        deadline_at: initialDeadlineAt,
        image_count: 1,
        keyword_count: orderedKeywords.length,
        content_hash: contentHash,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      ...revokeSupersededVersionFilesStatements(
        database, instructionId, instructionVersionId, now,
      ),
      insertImageLink(database, {
        linkId: mainImageLinkId,
        fileObjectId: mainImage.file_object_id,
        instructionVersionId,
        purpose: 'PRODUCT_IMAGE',
        visibility: 'BUYER_VISIBLE',
        actorId: command.actor.staffId,
        now,
      }),
      insertBuyerGrant(database, mainBuyerGrantId, mainImageLinkId,
        source.buyer_customer_id, command.actor.staffId, now),
      insertStaffGrant(database, mainStaffGrantId, mainImageLinkId,
        command.actor.staffId, now),

      database.prepare(`
        INSERT INTO order_instruction_versions (
          id, instruction_id, version_no, reservation_id,
          product_id, product_version_id, product_version_no,
          main_image_file_entity_link_id, store_display_name_snapshot,
          demand_buyer_visible_notes_snapshot, staff_public_note,
          reference_order_amount_jpy, buyer_self_pay_bps,
          estimated_self_pay_jpy, estimated_refundable_principal_jpy,
          color_spec_mode, content_hash, generator_version,
          published_by_staff_id, published_at, initial_deadline_at, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).bind(
        instructionVersionId,
        instructionId,
        nextVersionNo,
        source.reservation_id,
        source.product_id,
        source.product_version_id,
        source.product_version_no,
        mainImageLinkId,
        source.store_display_name,
        source.buyer_visible_notes,
        staffPublicNote,
        expectedAmount,
        source.buyer_self_pay_bps_snapshot,
        toD1SafeInteger(selfPayFacts.buyerSelfPayJpy),
        toD1SafeInteger(selfPayFacts.refundablePrincipalJpy),
        source.color_spec_mode,
        contentHash,
        'PLAINTEXT_KEYWORDS_V1',
        command.actor.staffId,
        now,
        initialDeadlineAt,
        now,
      ),
    ];
    statements.push(
      database.prepare(`
        UPDATE order_instructions
        SET status='ACTIVE', current_version_no=?, version=version+1,
            published_at=COALESCE(published_at, ?),
            initial_deadline_at=COALESCE(initial_deadline_at, ?),
            resubmission_deadline_at=NULL, expired_at=NULL,
            updated_at=MAX(?, updated_at+1)
        WHERE id=? AND version=? AND status IN ('UNPUBLISHED','ACTIVE')
      `).bind(
        nextVersionNo,
        now,
        initialDeadlineAt,
        now,
        instructionId,
        expectedVersion,
      ),
      insertInstructionEventStatement(database, {
        instructionId,
        reservationId: source.reservation_id,
        instructionVersionId,
        eventType: source.current_version_no === 0
          ? 'INSTRUCTION_PUBLISHED'
          : 'INSTRUCTION_REPUBLISHED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousStatus: source.instruction_status,
        nextStatus: 'ACTIVE',
        instructionVersion: nextAggregateVersion,
        metadata: {
          version_no: nextVersionNo,
          content_hash: contentHash,
          image_count: 1,
          keyword_count: orderedKeywords.length,
          deadline_at: initialDeadlineAt,
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ORDER_INSTRUCTION',
        aggregateId: instructionId,
        eventType: source.current_version_no === 0
          ? 'ORDER_INSTRUCTION_PUBLISHED'
          : 'ORDER_INSTRUCTION_REPUBLISHED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: source.instruction_status,
          current_version_no: source.current_version_no,
          version: source.instruction_version,
        },
        nextState: response,
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          instruction_id: instructionId,
          instruction_version_id: instructionVersionId,
        },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (SELECT 1 FROM order_instructions
            WHERE id=? AND status='ACTIVE' AND version=?
              AND current_version_no=? AND initial_deadline_at=?)
          AND EXISTS (SELECT 1 FROM order_instruction_versions
            WHERE id=? AND instruction_id=? AND content_hash=?)
          AND (SELECT COUNT(*) FROM order_instruction_keyword_images
            WHERE order_instruction_version_id=?)=0
        THEN 1 ELSE 0 END
      `).bind(
        instructionId,
        nextAggregateVersion,
        nextVersionNo,
        initialDeadlineAt,
        instructionVersionId,
        instructionId,
        contentHash,
        instructionVersionId,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
      ...await prepareWorkItemCompletionStatements(database, {
        workType: 'ORDER_INSTRUCTION_PUBLISH',
        sourceEntityType: 'ORDER_INSTRUCTION',
        sourceEntityId: instructionId,
        outcome: 'COMPLETED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        now,
      }),
    );
    await database.batch(statements);
    return response;
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

function revokeSupersededVersionFilesStatements(
  database: SqlDatabase,
  instructionId: string,
  newInstructionVersionId: string,
  now: number,
): readonly SqlStatement[] {
  return [
    database.prepare(`
      UPDATE file_read_intents
      SET status='REVOKED', revoked_at=?, updated_at=MAX(?, updated_at+1)
      WHERE status='ISSUED' AND file_entity_link_id IN (
        SELECT link.id
        FROM file_entity_links link
        JOIN order_instruction_versions version ON version.id=link.entity_id
        WHERE version.instruction_id=?
          AND version.id<>?
          AND link.entity_type='ORDER_INSTRUCTION_VERSION'
      )
    `).bind(now, now, instructionId, newInstructionVersionId),
    database.prepare(`
      UPDATE file_entity_audience_grants
      SET revoked_at=?
      WHERE revoked_at IS NULL AND file_entity_link_id IN (
        SELECT link.id
        FROM file_entity_links link
        JOIN order_instruction_versions version ON version.id=link.entity_id
        WHERE version.instruction_id=?
          AND version.id<>?
          AND link.entity_type='ORDER_INSTRUCTION_VERSION'
      )
    `).bind(now, instructionId, newInstructionVersionId),
    database.prepare(`
      UPDATE file_entity_links
      SET revoked_at=?
      WHERE revoked_at IS NULL
        AND entity_type='ORDER_INSTRUCTION_VERSION'
        AND entity_id IN (
          SELECT id FROM order_instruction_versions
          WHERE instruction_id=? AND id<>?
        )
    `).bind(now, instructionId, newInstructionVersionId),
  ];
}

function insertImageLink(
  database: SqlDatabase,
  input: {
    linkId: string;
    fileObjectId: string;
    instructionVersionId: string;
    purpose: 'PRODUCT_IMAGE' | 'ORDER_INSTRUCTION_KEYWORD_IMAGE';
    visibility: 'BUYER_VISIBLE';
    actorId: string;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (?, ?, 'ORDER_INSTRUCTION_VERSION', ?, ?, ?,
      'STAFF', ?, ?, 'EXPLICIT_AUDIENCES', NULL, NULL)
  `).bind(
    input.linkId,
    input.fileObjectId,
    input.instructionVersionId,
    input.purpose,
    input.visibility,
    input.actorId,
    input.now,
  );
}

function insertBuyerGrant(
  database: SqlDatabase,
  grantId: string,
  linkId: string,
  buyerCustomerId: string,
  actorId: string,
  now: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type, buyer_customer_id,
      seller_organization_id, staff_permission_code, staff_scope_type,
      staff_team_id, granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES (?, ?, 'BUYER', ?, NULL, NULL, NULL, NULL,
      'STAFF', ?, ?, NULL, NULL)
  `).bind(grantId, linkId, buyerCustomerId, actorId, now);
}

function insertStaffGrant(
  database: SqlDatabase,
  grantId: string,
  linkId: string,
  staffId: string,
  now: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type, buyer_customer_id,
      seller_organization_id, staff_permission_code, staff_scope_type,
      staff_team_id, granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES (?, ?, 'STAFF_INTERNAL', NULL, NULL,
      'ORDER_INSTRUCTION_VIEW', ?, ?,
      'STAFF', ?, ?, NULL, NULL)
  `).bind(
    grantId,
    linkId,
    'GLOBAL',
    null,
    staffId,
    now,
  );
}

function summary(source: {
  instruction_id: string;
  reservation_id: string;
  buyer_customer_id: string;
  marketplace_code: 'JP';
  instruction_status: 'UNPUBLISHED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'COMPLETED';
  current_version_no: number;
  instruction_version: number;
  published_at: number | null;
  initial_deadline_at: number | null;
  resubmission_deadline_at: number | null;
}): StaffOrderInstructionSummaryDto {
  return {
    instruction_id: source.instruction_id,
    reservation_id: source.reservation_id,
    buyer_customer_id: source.buyer_customer_id,
    marketplace_code: source.marketplace_code,
    status: source.instruction_status,
    current_version_no: source.current_version_no,
    version: source.instruction_version,
    published_at: source.published_at,
    initial_deadline_at: source.initial_deadline_at,
    resubmission_deadline_at: source.resubmission_deadline_at,
    expired_at: null,
    cancelled_at: null,
    completed_at: null,
  };
}
