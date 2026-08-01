import type {
  ExplicitAudienceFileLinkResult,
  ExplicitFileAudienceGrantInput,
  ExplicitFileAudienceGrantResult,
  FileActor,
  FileEntityType,
  FilePurpose,
  FileVisibility,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { filePurposeEntityType } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import type { FileAuthorizationService } from './authorization';
import { createFileEventStatement } from './file-events';
import { FileStorageError } from './file-error';
import { cleanFileIdentifier } from './file-records';

interface ExplicitLinkSourceRow {
  id: string;
  upload_intent_id: string;
  purpose: FilePurpose;
  visibility: FileVisibility;
  status: string;
  version: number;
  owner_actor_type: string;
  owner_actor_id: string;
  intent_status: string;
}

interface ExplicitLinkRow {
  id: string;
  file_object_id: string;
  entity_type: FileEntityType;
  entity_id: string;
  purpose: FilePurpose;
  visibility: FileVisibility;
  authorization_mode: string;
  expires_at: number | null;
  revoked_at: number | null;
}

interface AudienceGrantRow {
  id: string;
  file_entity_link_id: string;
  subject_type: 'BUYER' | 'SELLER_ORGANIZATION' | 'STAFF_INTERNAL';
  buyer_customer_id: string | null;
  seller_organization_id: string | null;
  staff_permission_code: string | null;
  staff_scope_type: 'GLOBAL' | 'TEAM' | null;
  staff_team_id: string | null;
  expires_at: number | null;
  revoked_at: number | null;
}

export interface PreparedExplicitAudienceFileLink {
  result: ExplicitAudienceFileLinkResult;
  statements: readonly SqlStatement[];
}

export async function createExplicitAudienceFileLinkStatements(
  database: SqlDatabase,
  authorization: FileAuthorizationService,
  input: {
    fileObjectId: string;
    expectedFileVersion: number;
    entityType: FileEntityType;
    entityId: string;
    expiresAt?: number | null;
    grants: readonly ExplicitFileAudienceGrantInput[];
  },
  command: {
    actor: FileActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<PreparedExplicitAudienceFileLink> {
  const fileObjectId = cleanFileIdentifier(input.fileObjectId, 120);
  const entityId = cleanFileIdentifier(input.entityId, 200);
  const now = command.now ?? Date.now();
  const linkExpiresAt = input.expiresAt ?? null;
  validateTiming(now, linkExpiresAt);
  if (!Number.isSafeInteger(input.expectedFileVersion)
    || input.expectedFileVersion < 1
    || input.grants.length < 1) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }

  const source = await requireExplicitLinkSource(database, fileObjectId);
  if (source.version !== input.expectedFileVersion) {
    throw new FileStorageError('VERSION_CONFLICT', 409);
  }
  if (input.entityType !== filePurposeEntityType(source.purpose)) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  await authorization.assertCanLink(command.actor, {
    uploadIntentId: source.upload_intent_id,
    fileObjectId,
    ownerActorType: source.owner_actor_type,
    ownerActorId: source.owner_actor_id,
    purpose: source.purpose,
    visibility: source.visibility,
    entityType: input.entityType,
    entityId,
  });

  const grants = normalizeGrants(input.grants, now);
  const linkId = crypto.randomUUID();
  const result: ExplicitAudienceFileLinkResult = Object.freeze({
    linkId,
    fileObjectId,
    entityType: input.entityType,
    entityId,
    purpose: source.purpose,
    visibility: source.visibility,
    authorizationMode: 'EXPLICIT_AUDIENCES',
    expiresAt: linkExpiresAt,
    grants: Object.freeze(grants.map((grant) => grant.result)),
  });
  const outbox = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: `explicit-file-link-created:${linkId}`,
    eventType: 'EXPLICIT_FILE_AUDIENCES_CREATED',
    aggregateType: 'FILE_ENTITY_LINK',
    aggregateId: linkId,
    payload: {
      file_entity_link_id: linkId,
      file_object_id: fileObjectId,
      entity_type: input.entityType,
      entity_id: entityId,
      authorization_mode: 'EXPLICIT_AUDIENCES',
      grant_subjects: grants.map((grant) => ({
        subject_type: grant.result.subjectType,
        subject_authority_id: grant.result.subjectAuthorityId,
        expires_at: grant.result.expiresAt,
      })),
      expires_at: linkExpiresAt,
    },
    createdAt: now,
  });

  const statements: SqlStatement[] = [
    database.prepare(`
      INSERT INTO file_entity_links (
        id,
        file_object_id,
        entity_type,
        entity_id,
        purpose,
        visibility,
        linked_by_actor_type,
        linked_by_actor_id,
        created_at,
        authorization_mode,
        expires_at,
        revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EXPLICIT_AUDIENCES', ?, NULL)
    `).bind(
      linkId,
      fileObjectId,
      input.entityType,
      entityId,
      source.purpose,
      source.visibility,
      command.actor.type,
      command.actor.id,
      now,
      linkExpiresAt,
    ),
    ...grants.map((grant) => database.prepare(`
      INSERT INTO file_entity_audience_grants (
        id,
        file_entity_link_id,
        subject_type,
        buyer_customer_id,
        seller_organization_id,
        staff_permission_code,
        staff_scope_type,
        staff_team_id,
        granted_by_actor_type,
        granted_by_actor_id,
        created_at,
        expires_at,
        revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).bind(
      grant.result.grantId,
      linkId,
      grant.result.subjectType,
      grant.buyerCustomerId,
      grant.sellerOrganizationId,
      grant.staffPermissionCode,
      grant.staffScopeType,
      grant.staffTeamId,
      command.actor.type,
      command.actor.id,
      now,
      grant.result.expiresAt,
    )),
    database.prepare(`
      INSERT INTO file_audience_events (
        id, file_entity_link_id, grant_id, event_type,
        file_object_id, entity_type, entity_id,
        subject_type, subject_authority_id,
        actor_type, actor_id, effective_at, created_at
      ) VALUES (
        ?, ?, NULL, 'EXPLICIT_LINK_CREATED',
        ?, ?, ?, NULL, NULL, ?, ?, ?, ?
      )
    `).bind(
      crypto.randomUUID(),
      linkId,
      fileObjectId,
      input.entityType,
      entityId,
      command.actor.type,
      command.actor.id,
      now,
      now,
    ),
    ...grants.map((grant) => database.prepare(`
      INSERT INTO file_audience_events (
        id, file_entity_link_id, grant_id, event_type,
        file_object_id, entity_type, entity_id,
        subject_type, subject_authority_id,
        actor_type, actor_id, effective_at, created_at
      ) VALUES (
        ?, ?, ?, 'AUDIENCE_GRANT_CREATED',
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).bind(
      crypto.randomUUID(),
      linkId,
      grant.result.grantId,
      fileObjectId,
      input.entityType,
      entityId,
      grant.result.subjectType,
      grant.result.subjectAuthorityId,
      command.actor.type,
      command.actor.id,
      now,
      now,
    )),
    createFileEventStatement(database, {
      uploadIntentId: source.upload_intent_id,
      fileObjectId,
      eventType: 'FILE_OBJECT_LINKED',
      actorType: command.actor.type,
      actorId: command.actor.id,
      previousStatus: 'VERIFIED',
      nextStatus: 'VERIFIED',
      metadata: {
        file_entity_link_id: linkId,
        entity_type: input.entityType,
        entity_id: entityId,
        authorization_mode: 'EXPLICIT_AUDIENCES',
        grant_count: grants.length,
      },
      idempotencyKey: command.idempotencyKey,
      createdAt: now,
    }),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'FILE_ENTITY_LINK',
      aggregateId: linkId,
      eventType: 'EXPLICIT_FILE_AUDIENCES_CREATED',
      actor: {
        type: command.actor.type,
        id: command.actor.id,
        roles: command.actor.roles,
      },
      requestId: command.requestId ?? null,
      idempotencyKey: command.idempotencyKey,
      nextState: {
        file_object_id: fileObjectId,
        entity_type: input.entityType,
        entity_id: entityId,
        authorization_mode: 'EXPLICIT_AUDIENCES',
        expires_at: linkExpiresAt,
        grants: result.grants,
      },
      createdAt: now,
    }),
    ...createOutboxStatements(database, outbox),
    assertExplicitLinkCreatedStatement(
      database,
      result,
      grants.length,
      now,
    ),
  ];

  return Object.freeze({
    result,
    statements: Object.freeze(statements),
  });
}

export async function createRevokeFileAudienceGrantStatements(
  database: SqlDatabase,
  input: { grantId: string },
  command: {
    actor: FileActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<readonly SqlStatement[]> {
  const grantId = cleanFileIdentifier(input.grantId, 120);
  const now = command.now ?? Date.now();
  validateTiming(now, null);
  const grant = await database.prepare(`
    SELECT
      grant.*,
      link.file_object_id,
      link.entity_type,
      link.entity_id
    FROM file_entity_audience_grants grant
    JOIN file_entity_links link
      ON link.id=grant.file_entity_link_id
    WHERE grant.id=?
      AND link.authorization_mode='EXPLICIT_AUDIENCES'
  `).bind(grantId).first<AudienceGrantRow & {
    file_object_id: string;
    entity_type: FileEntityType;
    entity_id: string;
  }>();
  if (!grant) throw new FileStorageError('NOT_FOUND', 404);
  if (grant.revoked_at !== null) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  const subjectAuthorityId = authorityId(grant);
  return Object.freeze([
    database.prepare(`
      UPDATE file_entity_audience_grants
      SET revoked_at=?
      WHERE id=? AND revoked_at IS NULL
    `).bind(now, grantId),
    database.prepare(`
      INSERT INTO file_audience_events (
        id, file_entity_link_id, grant_id, event_type,
        file_object_id, entity_type, entity_id,
        subject_type, subject_authority_id,
        actor_type, actor_id, effective_at, created_at
      ) VALUES (
        ?, ?, ?, 'AUDIENCE_GRANT_REVOKED', ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).bind(
      crypto.randomUUID(),
      grant.file_entity_link_id,
      grant.id,
      grant.file_object_id,
      grant.entity_type,
      grant.entity_id,
      grant.subject_type,
      subjectAuthorityId,
      command.actor.type,
      command.actor.id,
      now,
      now,
    ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'FILE_AUDIENCE_GRANT',
      aggregateId: grant.id,
      eventType: 'FILE_AUDIENCE_GRANT_REVOKED',
      actor: {
        type: command.actor.type,
        id: command.actor.id,
        roles: command.actor.roles,
      },
      requestId: command.requestId ?? null,
      idempotencyKey: command.idempotencyKey,
      previousState: { revoked_at: null },
      nextState: {
        file_entity_link_id: grant.file_entity_link_id,
        subject_type: grant.subject_type,
        subject_authority_id: subjectAuthorityId,
        revoked_at: now,
      },
      createdAt: now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM file_entity_audience_grants
        WHERE id=? AND revoked_at=?
      ) THEN 1 ELSE 0 END
    `).bind(grant.id, now),
  ]);
}

export async function createRevokeExplicitAudienceFileLinkStatements(
  database: SqlDatabase,
  input: { linkId: string },
  command: {
    actor: FileActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<readonly SqlStatement[]> {
  const linkId = cleanFileIdentifier(input.linkId, 120);
  const now = command.now ?? Date.now();
  validateTiming(now, null);
  const link = await database.prepare(`
    SELECT *
    FROM file_entity_links
    WHERE id=? AND authorization_mode='EXPLICIT_AUDIENCES'
  `).bind(linkId).first<ExplicitLinkRow>();
  if (!link) throw new FileStorageError('NOT_FOUND', 404);
  if (link.revoked_at !== null) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  return Object.freeze([
    database.prepare(`
      UPDATE file_entity_links
      SET revoked_at=?
      WHERE id=? AND revoked_at IS NULL
    `).bind(now, linkId),
    database.prepare(`
      INSERT INTO file_audience_events (
        id, file_entity_link_id, grant_id, event_type,
        file_object_id, entity_type, entity_id,
        subject_type, subject_authority_id,
        actor_type, actor_id, effective_at, created_at
      ) VALUES (
        ?, ?, NULL, 'EXPLICIT_LINK_REVOKED', ?, ?, ?, NULL, NULL, ?, ?, ?, ?
      )
    `).bind(
      crypto.randomUUID(),
      linkId,
      link.file_object_id,
      link.entity_type,
      link.entity_id,
      command.actor.type,
      command.actor.id,
      now,
      now,
    ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'FILE_ENTITY_LINK',
      aggregateId: linkId,
      eventType: 'EXPLICIT_FILE_LINK_REVOKED',
      actor: {
        type: command.actor.type,
        id: command.actor.id,
        roles: command.actor.roles,
      },
      requestId: command.requestId ?? null,
      idempotencyKey: command.idempotencyKey,
      previousState: { revoked_at: null },
      nextState: { revoked_at: now },
      createdAt: now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM file_entity_links
        WHERE id=? AND revoked_at=?
      ) THEN 1 ELSE 0 END
    `).bind(linkId, now),
  ]);
}

async function requireExplicitLinkSource(
  database: SqlDatabase,
  fileObjectId: string,
): Promise<ExplicitLinkSourceRow> {
  const source = await database.prepare(`
    SELECT
      object.id,
      object.upload_intent_id,
      object.purpose,
      object.visibility,
      object.status,
      object.version,
      intent.owner_actor_type,
      intent.owner_actor_id,
      intent.status AS intent_status
    FROM file_objects object
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
    WHERE object.id=?
  `).bind(fileObjectId).first<ExplicitLinkSourceRow>();
  if (!source) throw new FileStorageError('FILE_OBJECT_NOT_FOUND', 404);
  if (source.status !== 'VERIFIED' || source.intent_status !== 'VERIFIED') {
    throw new FileStorageError('FILE_NOT_VERIFIED', 409);
  }
  return source;
}

function normalizeGrants(
  inputs: readonly ExplicitFileAudienceGrantInput[],
  now: number,
): Array<{
  result: ExplicitFileAudienceGrantResult;
  buyerCustomerId: string | null;
  sellerOrganizationId: string | null;
  staffPermissionCode: string | null;
  staffScopeType: 'GLOBAL' | 'TEAM' | null;
  staffTeamId: string | null;
}> {
  const seen = new Set<string>();
  return inputs.map((input) => {
    const expiresAt = input.expiresAt ?? null;
    validateTiming(now, expiresAt);
    const grantId = crypto.randomUUID();
    if (input.subjectType === 'BUYER') {
      const buyerCustomerId = cleanFileIdentifier(
        input.buyerCustomerId,
        120,
      );
      assertUnique(seen, `BUYER:${buyerCustomerId}`);
      return {
        result: {
          grantId,
          subjectType: input.subjectType,
          subjectAuthorityId: buyerCustomerId,
          expiresAt,
        },
        buyerCustomerId,
        sellerOrganizationId: null,
        staffPermissionCode: null,
        staffScopeType: null,
        staffTeamId: null,
      };
    }
    if (input.subjectType === 'SELLER_ORGANIZATION') {
      const sellerOrganizationId = cleanFileIdentifier(
        input.sellerOrganizationId,
        120,
      );
      assertUnique(seen, `SELLER_ORGANIZATION:${sellerOrganizationId}`);
      return {
        result: {
          grantId,
          subjectType: input.subjectType,
          subjectAuthorityId: sellerOrganizationId,
          expiresAt,
        },
        buyerCustomerId: null,
        sellerOrganizationId,
        staffPermissionCode: null,
        staffScopeType: null,
        staffTeamId: null,
      };
    }

    const staffTeamId = input.scope.type === 'TEAM'
      ? cleanFileIdentifier(input.scope.teamId, 120)
      : null;
    assertUnique(seen, 'STAFF_INTERNAL');
    const subjectAuthorityId = input.scope.type === 'TEAM'
      ? `staff:${input.permissionCode}:team:${staffTeamId}`
      : `staff:${input.permissionCode}:global`;
    return {
      result: {
        grantId,
        subjectType: input.subjectType,
        subjectAuthorityId,
        expiresAt,
      },
      buyerCustomerId: null,
      sellerOrganizationId: null,
      staffPermissionCode: input.permissionCode,
      staffScopeType: input.scope.type,
      staffTeamId,
    };
  });
}

function assertUnique(seen: Set<string>, key: string): void {
  if (seen.has(key)) {
    throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  seen.add(key);
}

function validateTiming(now: number, expiresAt: number | null): void {
  if (!Number.isSafeInteger(now) || now < 0
    || (expiresAt !== null
      && (!Number.isSafeInteger(expiresAt) || expiresAt <= now))) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
}

function authorityId(grant: AudienceGrantRow): string {
  if (grant.subject_type === 'BUYER' && grant.buyer_customer_id) {
    return grant.buyer_customer_id;
  }
  if (grant.subject_type === 'SELLER_ORGANIZATION'
    && grant.seller_organization_id) {
    return grant.seller_organization_id;
  }
  if (grant.subject_type === 'STAFF_INTERNAL'
    && grant.staff_permission_code
    && grant.staff_scope_type) {
    return grant.staff_scope_type === 'TEAM'
      ? `staff:${grant.staff_permission_code}:team:${grant.staff_team_id}`
      : `staff:${grant.staff_permission_code}:global`;
  }
  throw new FileStorageError('FILE_STORAGE_CONFLICT', 409);
}

function assertExplicitLinkCreatedStatement(
  database: SqlDatabase,
  result: ExplicitAudienceFileLinkResult,
  grantCount: number,
  now: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM file_entity_links
        WHERE id=?
          AND file_object_id=?
          AND entity_type=?
          AND entity_id=?
          AND authorization_mode='EXPLICIT_AUDIENCES'
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at>?)
      )
      AND (
        SELECT COUNT(*)
        FROM file_entity_audience_grants
        WHERE file_entity_link_id=?
          AND revoked_at IS NULL
      )=?
    THEN 1 ELSE 0 END
  `).bind(
    result.linkId,
    result.fileObjectId,
    result.entityType,
    result.entityId,
    now,
    result.linkId,
    grantCount,
  );
}
