import type {
  AttachOrderCommunicationScreenshotResult,
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

interface FormalOrderTargetRow {
  formal_order_id: string;
  seller_organization_id: string;
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
 * D-056 §4.1: attach one communication screenshot (already verified in R2)
 * to a formal order. Multiple screenshots per order are allowed; the link
 * carries entity_type='ORDER' with purpose ORDER_COMMUNICATION_SCREENSHOT
 * and an explicit SELLER_ORGANIZATION audience grant, so every ACTIVE
 * member of the organization can read it and nobody else.
 */
export async function attachOrderCommunicationScreenshot(
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
): Promise<AttachOrderCommunicationScreenshotResult> {
  const formalOrderId = cleanFileIdentifier(input.formalOrderId, 120);
  const fileObjectId = cleanFileIdentifier(input.fileObjectId, 120);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(input.expectedFileVersion)
    || input.expectedFileVersion < 1) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  if (!command.actor.permissions.has('ORDER_VIEW')) {
    throw new FileStorageError('FORBIDDEN', 403);
  }

  const target = await database.prepare(`
    SELECT
      formal_order.id AS formal_order_id,
      formal_order.seller_organization_id
    FROM formal_orders formal_order
    JOIN seller_organizations organization
      ON organization.id=formal_order.seller_organization_id
      AND organization.status='ACTIVE'
    WHERE formal_order.id=?
  `).bind(formalOrderId).first<FormalOrderTargetRow>();
  if (!target) throw new FileStorageError('NOT_FOUND', 404);

  const scope = await resolveStaffDataScope(database, command.actor, {
    requiredPermission: 'ORDER_VIEW',
  });
  if (!scopeAllowsSellerOrganization(scope, target.seller_organization_id)) {
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
      AND object.purpose='ORDER_COMMUNICATION_SCREENSHOT'
      AND intent.purpose='ORDER_COMMUNICATION_SCREENSHOT'
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
    action: 'ATTACH_ORDER_COMMUNICATION_SCREENSHOT',
    formal_order_id: formalOrderId,
    file_object_id: fileObjectId,
    expected_file_version: input.expectedFileVersion,
  });
  const acquired = await acquireIdempotency<AttachOrderCommunicationScreenshotResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'ATTACH_ORDER_COMMUNICATION_SCREENSHOT',
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
      SELECT id FROM file_entity_links
      WHERE entity_type='ORDER' AND entity_id=?
        AND file_object_id=? AND purpose='ORDER_COMMUNICATION_SCREENSHOT'
        AND revoked_at IS NULL
    `).bind(formalOrderId, fileObjectId).first<{ id: string }>();
    if (existing) {
      const response = Object.freeze({
        formal_order_id: formalOrderId,
        file_object_id: fileObjectId,
        replayed: true,
      }) as AttachOrderCommunicationScreenshotResult;
      await database.batch([
        completeIdempotencyStatement(database, acquired.claim, response, {
          resultReferences: { file_entity_link_id: existing.id },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      return response;
    }

    const linkId = crypto.randomUUID();
    const grantId = crypto.randomUUID();
    const response: AttachOrderCommunicationScreenshotResult = Object.freeze({
      formal_order_id: formalOrderId,
      file_object_id: fileObjectId,
      replayed: false,
    });
    const actor: FileActor = {
      type: 'STAFF',
      id: command.actor.staffId,
      roles: [...command.actor.roles],
    };

    await database.batch([
      database.prepare(`
        INSERT INTO file_entity_links (
          id, file_object_id, entity_type, entity_id, purpose, visibility,
          linked_by_actor_type, linked_by_actor_id, created_at,
          authorization_mode, expires_at, revoked_at
        ) VALUES (?, ?, 'ORDER', ?,
          'ORDER_COMMUNICATION_SCREENSHOT', 'SELLER_VISIBLE',
          'STAFF', ?, ?, 'EXPLICIT_AUDIENCES', NULL, NULL)
      `).bind(
        linkId,
        fileObjectId,
        formalOrderId,
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
        target.seller_organization_id,
        command.actor.staffId,
        now,
      ),
      database.prepare(`
        INSERT INTO file_audience_events (
          id, file_entity_link_id, grant_id, event_type,
          file_object_id, entity_type, entity_id,
          subject_type, subject_authority_id,
          actor_type, actor_id, effective_at, created_at
        ) VALUES (?, ?, NULL, 'EXPLICIT_LINK_CREATED', ?,
          'ORDER', ?, NULL, NULL, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), linkId, fileObjectId, formalOrderId,
        'STAFF', command.actor.staffId, now, now,
      ),
      database.prepare(`
        INSERT INTO file_audience_events (
          id, file_entity_link_id, grant_id, event_type,
          file_object_id, entity_type, entity_id,
          subject_type, subject_authority_id,
          actor_type, actor_id, effective_at, created_at
        ) VALUES (?, ?, ?, 'AUDIENCE_GRANT_CREATED', ?,
          'ORDER', ?, 'SELLER_ORGANIZATION', ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), linkId, grantId, fileObjectId,
        formalOrderId, target.seller_organization_id,
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
          entity_type: 'ORDER',
          entity_id: formalOrderId,
          visibility: 'SELLER_VISIBLE',
        },
        idempotencyKey: command.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'FORMAL_ORDER',
        aggregateId: formalOrderId,
        eventType: 'ORDER_COMMUNICATION_SCREENSHOT_ATTACHED',
        actor,
        requestId: command.requestId ?? null,
        idempotencyKey: command.idempotencyKey,
        nextState: {
          file_object_id: fileObjectId,
          purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
          visibility: 'SELLER_VISIBLE',
          seller_organization_id: target.seller_organization_id,
        },
        createdAt: now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM file_entity_links link
          JOIN file_entity_audience_grants grant
            ON grant.file_entity_link_id=link.id
            AND grant.subject_type='SELLER_ORGANIZATION'
            AND grant.seller_organization_id=?
          WHERE link.id=? AND link.entity_type='ORDER'
            AND link.entity_id=? AND link.file_object_id=?
            AND link.purpose='ORDER_COMMUNICATION_SCREENSHOT'
            AND link.revoked_at IS NULL
        ) THEN 1 ELSE 0 END
      `).bind(
        target.seller_organization_id,
        linkId,
        formalOrderId,
        fileObjectId,
      ),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { file_entity_link_id: linkId },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizeFileStorageError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}
