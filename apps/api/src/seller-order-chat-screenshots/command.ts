import type {
  AttachSellerOrderChatScreenshotResult,
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
import { createFileEventStatement } from '../files/file-events';
import {
  FileStorageError,
  normalizeFileStorageError,
} from '../files/file-error';
import { cleanFileIdentifier } from '../files/file-records';
import {
  resolveStaffDataScope,
  scopeAllowsSellerOrganization,
} from '../staff-assignment';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

interface LegacyFormalOrderTargetRow {
  formal_order_id: string;
  submission_id: string;
  seller_organization_id: string;
  seller_store_id: string;
}

type FormalOrderTarget = {
  kind: 'LEGACY';
  formalOrderId: string;
  evidenceEntityId: string;
  sellerOrganizationId: string;
  sellerStoreId: string;
};

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

export async function attachSellerOrderChatScreenshot(
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
): Promise<AttachSellerOrderChatScreenshotResult> {
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

  const legacyTarget = await database.prepare(`
    SELECT
      formal_order.id AS formal_order_id,
      formal_order.order_evidence_submission_id AS submission_id,
      formal_order.seller_organization_id,
      formal_order.store_id AS seller_store_id
    FROM formal_orders formal_order
    JOIN seller_organizations organization
      ON organization.id=formal_order.seller_organization_id
      AND organization.status='ACTIVE'
    JOIN seller_stores store
      ON store.id=formal_order.store_id
      AND store.organization_id=formal_order.seller_organization_id
      AND store.status='ACTIVE'
    WHERE formal_order.id=? AND formal_order.status='CONFIRMED'
  `).bind(formalOrderId).first<LegacyFormalOrderTargetRow>();
  const target: FormalOrderTarget | null = legacyTarget
    ? {
        kind: 'LEGACY',
        formalOrderId: legacyTarget.formal_order_id,
        evidenceEntityId: legacyTarget.submission_id,
        sellerOrganizationId: legacyTarget.seller_organization_id,
        sellerStoreId: legacyTarget.seller_store_id,
      }
    : null;
  if (!target) throw new FileStorageError('NOT_FOUND', 404);

  const scope = await resolveStaffDataScope(database, command.actor, {
    requiredPermission: 'ORDER_CONFIRM',
  });
  if (!scopeAllowsSellerOrganization(scope, target.sellerOrganizationId)) {
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
      AND object.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
      AND intent.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
  `).bind(fileObjectId).first<FileSourceRow>();
  if (!source) throw new FileStorageError('NOT_FOUND', 404);
  if (source.version !== input.expectedFileVersion) {
    throw new FileStorageError('VERSION_CONFLICT', 409);
  }
  if (source.object_status !== 'VERIFIED'
    || source.intent_status !== 'VERIFIED'
    || source.visibility !== 'SELLER_VISIBLE'
    || source.intent_visibility !== 'SELLER_VISIBLE'
    || source.owner_actor_type !== 'STAFF'
    || source.owner_actor_id !== command.actor.staffId
    || !['image/jpeg', 'image/png', 'image/webp'].includes(
      source.detected_mime ?? '',
    )) {
    throw new FileStorageError('FILE_NOT_VERIFIED', 409);
  }

  const requestHash = await hashCanonicalJson({
    action: 'ATTACH_SELLER_ORDER_CHAT_SCREENSHOT',
    formal_order_id: formalOrderId,
    file_object_id: fileObjectId,
    expected_file_version: input.expectedFileVersion,
  });
  const acquired = await acquireIdempotency<AttachSellerOrderChatScreenshotResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'ATTACH_SELLER_ORDER_CHAT_SCREENSHOT',
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
    const existing = await database.prepare(`
          SELECT id FROM order_evidence_internal_files
          WHERE order_evidence_submission_id=? AND slot=1
        `).bind(target.evidenceEntityId).first<{ id: string }>();
    if (existing) throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);

    const linkId = crypto.randomUUID();
    const screenshotId = crypto.randomUUID();
    const grantId = crypto.randomUUID();
    const evidenceEntityId = target.evidenceEntityId;
    const response: AttachSellerOrderChatScreenshotResult = Object.freeze({
      formal_order_id: formalOrderId,
      screenshot_id: screenshotId,
      file_object_id: fileObjectId,
      replayed: false,
    });
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `seller-order-chat-screenshot-attached:${screenshotId}`,
      eventType: 'SELLER_ORDER_CHAT_SCREENSHOT_ATTACHED',
      aggregateType: 'FORMAL_ORDER',
      aggregateId: formalOrderId,
      payload: {
        formal_order_id: formalOrderId,
        screenshot_id: screenshotId,
        file_object_id: fileObjectId,
        seller_organization_id: target.sellerOrganizationId,
        seller_store_id: target.sellerStoreId,
        formal_order_carrier: 'LEGACY',
      },
      createdAt: now,
    });
    const actor: FileActor = {
      type: 'STAFF',
      id: command.actor.staffId,
      roles: [...command.actor.roles],
    };

    const attachmentStatement = database.prepare(`
      INSERT INTO order_evidence_internal_files (
        id, order_evidence_submission_id, slot, file_object_id,
        file_entity_link_id, created_by_staff_id, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?)
    `).bind(
      screenshotId,
      target.evidenceEntityId,
      fileObjectId,
      linkId,
      command.actor.staffId,
      now,
    );
    const attachmentAssertion = database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM order_evidence_internal_files attachment
        JOIN formal_orders formal_order
          ON formal_order.order_evidence_submission_id=
            attachment.order_evidence_submission_id
        JOIN file_entity_audience_grants grant
          ON grant.file_entity_link_id=attachment.file_entity_link_id
          AND grant.subject_type='SELLER_ORGANIZATION'
          AND grant.seller_organization_id=?
        WHERE attachment.id=? AND formal_order.id=?
      ) THEN 1 ELSE 0 END
    `).bind(target.sellerOrganizationId, screenshotId, formalOrderId);

    await database.batch([
      database.prepare(`
        INSERT INTO file_entity_links (
          id, file_object_id, entity_type, entity_id, purpose, visibility,
          linked_by_actor_type, linked_by_actor_id, created_at,
          authorization_mode, expires_at, revoked_at
        ) VALUES (?, ?, 'ORDER_EVIDENCE_SUBMISSION', ?,
          'ORDER_EVIDENCE_INTERNAL_COMMUNICATION', 'SELLER_VISIBLE',
          'STAFF', ?, ?, 'EXPLICIT_AUDIENCES', NULL, NULL)
      `).bind(
        linkId,
        fileObjectId,
        evidenceEntityId,
        command.actor.staffId,
        now,
      ),
      database.prepare(`
        INSERT INTO file_entity_audience_grants (
          id, file_entity_link_id, subject_type, buyer_customer_id,
          seller_organization_id, staff_permission_code, staff_scope_type,
          staff_team_id, granted_by_actor_type, granted_by_actor_id,
          created_at, expires_at, revoked_at
        ) VALUES (?, ?, 'SELLER_ORGANIZATION', NULL, ?, NULL, NULL,
          NULL, 'STAFF', ?, ?, NULL, NULL)
      `).bind(
        grantId,
        linkId,
        target.sellerOrganizationId,
        command.actor.staffId,
        now,
      ),
      attachmentStatement,
      database.prepare(`
        INSERT INTO file_audience_events (
          id, file_entity_link_id, grant_id, event_type,
          file_object_id, entity_type, entity_id,
          subject_type, subject_authority_id,
          actor_type, actor_id, effective_at, created_at
        ) VALUES (?, ?, NULL, 'EXPLICIT_LINK_CREATED', ?,
          'ORDER_EVIDENCE_SUBMISSION', ?, NULL, NULL, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), linkId, fileObjectId, evidenceEntityId,
        'STAFF', command.actor.staffId, now, now,
      ),
      database.prepare(`
        INSERT INTO file_audience_events (
          id, file_entity_link_id, grant_id, event_type,
          file_object_id, entity_type, entity_id,
          subject_type, subject_authority_id,
          actor_type, actor_id, effective_at, created_at
        ) VALUES (?, ?, ?, 'AUDIENCE_GRANT_CREATED', ?,
          'ORDER_EVIDENCE_SUBMISSION', ?, 'SELLER_ORGANIZATION', ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), linkId, grantId, fileObjectId,
        evidenceEntityId, target.sellerOrganizationId,
        'STAFF', command.actor.staffId, now, now,
      ),
      createFileEventStatement(database, {
        uploadIntentId: source.upload_intent_id,
        fileObjectId,
        eventType: 'FILE_OBJECT_LINKED',
        actorType: actor.type,
        actorId: actor.id,
        previousStatus: 'VERIFIED',
        nextStatus: 'VERIFIED',
        metadata: {
          file_entity_link_id: linkId,
          entity_type: 'ORDER_EVIDENCE_SUBMISSION',
          entity_id: evidenceEntityId,
          visibility: 'SELLER_VISIBLE',
        },
        idempotencyKey: command.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'FORMAL_ORDER',
        aggregateId: formalOrderId,
        eventType: 'SELLER_ORDER_CHAT_SCREENSHOT_ATTACHED',
        actor,
        requestId: command.requestId ?? null,
        idempotencyKey: command.idempotencyKey,
        nextState: {
          screenshot_id: screenshotId,
          file_object_id: fileObjectId,
          purpose: 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
          visibility: 'SELLER_VISIBLE',
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      attachmentAssertion,
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
