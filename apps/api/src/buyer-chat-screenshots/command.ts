import type {
  AttachBuyerChatScreenshotResult,
  FileActor,
  SqlDatabase,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
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
import { createAuditEventStatement } from '../foundation/audit';
import { FileStorageError, normalizeFileStorageError } from '../files/file-error';
import { cleanFileIdentifier } from '../files/file-records';
import { createExplicitAudienceFileLinkStatements } from '../files/explicit-audience-links';
import type { FileAuthorizationResource, FileAuthorizationService } from '../files/authorization';
import {
  resolveStaffDataScope,
  scopeAllowsBuyer,
} from '../staff-assignment';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

interface FormalOrderTargetRow {
  formal_order_id: string;
  buyer_customer_id: string;
}

interface FileSourceRow {
  file_object_id: string;
  upload_intent_id: string;
  version: number;
  detected_mime: string | null;
  object_status: string;
  intent_status: string;
  owner_actor_type: string;
  owner_actor_id: string;
  purpose: string;
  visibility: string;
  intent_visibility: string;
}

/**
 * Staff-uploaded WeChat conversation screenshots with the buyer, parked on
 * the confirmed formal order that conversation belongs to.  Reuses the
 * ORDER_EVIDENCE purpose (the only ORDER-entity purpose) with INTERNAL_ONLY
 * visibility — every existing ORDER_EVIDENCE consumer additionally filters
 * on owner_actor_type='BUYER_CUSTOMER'/visibility='BUYER_VISIBLE', so this
 * staff-owned slice stays invisible to buyer portal, seller portal and the
 * approval clone pipeline.
 */
export async function attachBuyerChatScreenshot(
  database: SqlDatabase,
  input: {
    formalOrderId: string;
    fileObjectId: string;
    expectedFileVersion: number;
  },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<AttachBuyerChatScreenshotResult> {
  const formalOrderId = cleanFileIdentifier(input.formalOrderId, 120);
  const fileObjectId = cleanFileIdentifier(input.fileObjectId, 120);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(input.expectedFileVersion)
    || input.expectedFileVersion < 1) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  if (!command.actor.permissions.has('ORDER_CONFIRM')) {
    throw new FileStorageError('FORBIDDEN', 403);
  }

  const target = await database.prepare(`
    SELECT id AS formal_order_id, buyer_customer_id
    FROM formal_orders
    WHERE id=? AND status='CONFIRMED'
  `).bind(formalOrderId).first<FormalOrderTargetRow>();
  if (!target) throw new FileStorageError('NOT_FOUND', 404);

  const scope = await resolveStaffDataScope(database, command.actor, {
    requiredPermission: 'ORDER_CONFIRM',
  });
  if (!scopeAllowsBuyer(scope, target.buyer_customer_id)) {
    throw new FileStorageError('NOT_FOUND', 404);
  }

  const source = await database.prepare(`
    SELECT
      object.id AS file_object_id,
      object.upload_intent_id,
      object.version,
      object.detected_mime,
      object.status AS object_status,
      intent.status AS intent_status,
      intent.owner_actor_type,
      intent.owner_actor_id,
      object.purpose,
      object.visibility,
      intent.visibility AS intent_visibility
    FROM file_objects object
    JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
    WHERE object.id=?
      AND object.purpose='ORDER_EVIDENCE'
      AND intent.purpose='ORDER_EVIDENCE'
  `).bind(fileObjectId).first<FileSourceRow>();
  if (!source) throw new FileStorageError('NOT_FOUND', 404);
  if (source.version !== input.expectedFileVersion) {
    throw new FileStorageError('VERSION_CONFLICT', 409);
  }
  if (source.object_status !== 'VERIFIED'
    || source.intent_status !== 'VERIFIED'
    || source.visibility !== 'INTERNAL_ONLY'
    || source.intent_visibility !== 'INTERNAL_ONLY'
    || source.owner_actor_type !== 'STAFF'
    || source.owner_actor_id !== command.actor.staffId
    || !['image/jpeg', 'image/png', 'image/webp'].includes(
      source.detected_mime ?? '',
    )) {
    throw new FileStorageError('FILE_NOT_VERIFIED', 409);
  }

  const requestHash = await hashCanonicalJson({
    action: 'ATTACH_BUYER_ORDER_CHAT_SCREENSHOT',
    formal_order_id: formalOrderId,
    file_object_id: fileObjectId,
    expected_file_version: input.expectedFileVersion,
  });
  const acquired = await acquireIdempotency<AttachBuyerChatScreenshotResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'ATTACH_BUYER_ORDER_CHAT_SCREENSHOT',
      targetType: 'FORMAL_ORDER',
      targetId: formalOrderId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const alreadyLinked = await database.prepare(`
      SELECT 1 FROM file_entity_links
      WHERE file_object_id=? AND revoked_at IS NULL
    `).bind(fileObjectId).first();
    if (alreadyLinked) throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);

    const screenshotId = crypto.randomUUID();
    const actor: FileActor = {
      type: 'STAFF',
      id: command.actor.staffId,
      roles: [...command.actor.roles],
    };
    const prepared = await createExplicitAudienceFileLinkStatements(
      database,
      new BuyerChatScreenshotLinkAuthorization(command.actor.staffId),
      {
        fileObjectId,
        expectedFileVersion: input.expectedFileVersion,
        entityType: 'ORDER',
        entityId: formalOrderId,
        grants: [{
          subjectType: 'STAFF_INTERNAL',
          permissionCode: 'ORDER_VIEW',
          scope: { type: 'GLOBAL' },
        }],
      },
      {
        actor,
        idempotencyKey: acquired.claim.idempotencyKey,
        requestId: command.requestId ?? null,
        now,
      },
    );
    const response: AttachBuyerChatScreenshotResult = Object.freeze({
      formal_order_id: formalOrderId,
      screenshot_id: screenshotId,
      file_object_id: fileObjectId,
      file_version: source.version,
      attached_at: now,
      replayed: false,
    });
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `buyer-order-chat-screenshot-attached:${screenshotId}`,
      eventType: 'BUYER_ORDER_CHAT_SCREENSHOT_ATTACHED',
      aggregateType: 'FORMAL_ORDER',
      aggregateId: formalOrderId,
      payload: {
        formal_order_id: formalOrderId,
        screenshot_id: screenshotId,
        file_object_id: fileObjectId,
        file_entity_link_id: prepared.result.linkId,
        buyer_customer_id: target.buyer_customer_id,
      },
      createdAt: now,
    });
    const linkAssertion = database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM file_entity_links link
        WHERE link.id=?
          AND link.file_object_id=?
          AND link.entity_type='ORDER'
          AND link.entity_id=?
          AND link.purpose='ORDER_EVIDENCE'
          AND link.visibility='INTERNAL_ONLY'
          AND link.authorization_mode='EXPLICIT_AUDIENCES'
          AND link.revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM file_entity_audience_grants grant
            WHERE grant.file_entity_link_id=link.id
              AND grant.subject_type='STAFF_INTERNAL'
              AND grant.staff_permission_code='ORDER_VIEW'
              AND grant.staff_scope_type='GLOBAL'
              AND grant.revoked_at IS NULL
          )
      ) THEN 1 ELSE 0 END
    `).bind(prepared.result.linkId, fileObjectId, formalOrderId);

    await database.batch([
      ...prepared.statements,
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'FORMAL_ORDER',
        aggregateId: formalOrderId,
        eventType: 'BUYER_ORDER_CHAT_SCREENSHOT_ATTACHED',
        actor,
        requestId: command.requestId ?? null,
        idempotencyKey: command.idempotencyKey,
        nextState: {
          screenshot_id: screenshotId,
          file_object_id: fileObjectId,
          file_entity_link_id: prepared.result.linkId,
          purpose: 'ORDER_EVIDENCE',
          visibility: 'INTERNAL_ONLY',
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      linkAssertion,
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          formal_order_id: formalOrderId,
          screenshot_id: screenshotId,
          file_object_id: fileObjectId,
        },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizeFileStorageError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now)
      .catch(() => false);
    throw normalized;
  }
}

class BuyerChatScreenshotLinkAuthorization implements FileAuthorizationService {
  constructor(private readonly staffId: string) {}

  assertCanLink(actor: FileActor, resource: FileAuthorizationResource): void {
    if (actor.type !== 'STAFF'
      || actor.id !== this.staffId
      || resource.ownerActorType !== 'STAFF'
      || resource.ownerActorId !== this.staffId
      || resource.purpose !== 'ORDER_EVIDENCE'
      || resource.visibility !== 'INTERNAL_ONLY'
      || resource.entityType !== 'ORDER') {
      throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
    }
  }
  assertCanCreateUpload(): never { return denyLink(); }
  assertCanUpload(): never { return denyLink(); }
  assertCanCompleteUpload(): never { return denyLink(); }
  assertCanRead(): never { return denyLink(); }
}

function denyLink(): never {
  throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
}
