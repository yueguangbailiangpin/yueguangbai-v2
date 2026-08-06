import type {
  MarketplaceCode,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  formatSellerCustomerCode,
  hashCanonicalJson,
} from '@ygb/domain';
import {
  createAuditEventStatement,
} from '../foundation/audit';
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
  batchWithFixedAssignmentRetry,
  prepareInitialSellerAssignment,
} from '../staff-assignment';
import {
  assertWechatAvailable,
  cleanRequiredText,
  createIdentityClaimStatements,
  CustomerMasterDataError,
  normalizeFoundationError,
  normalizeWechatForMasterData,
  requirePermission,
  type CustomerMasterActor,
} from './master-data-shared';
import {
  legacyMarketplaceProjection,
  resolveMarketplace,
} from '../marketplaces/registry';

interface SellerChannelRow {
  id: string;
  prefix: string;
  next_sequence: number;
  version: number;
}

export interface CreateSellerOrganizationInput {
  marketplaceCode: MarketplaceCode;
  sellerChannelId: string;
  organizationName: string;
  ownerDisplayName: string;
  ownerWechatId: string;
}

export interface CreateSellerOrganizationResult {
  seller_organization_id: string;
  seller_code: string;
  owner_member_id: string;
  owner_identity_subject_id: string;
  wechat_claim_id: string;
  status: 'DISABLED';
  replayed: boolean;
}

export async function createSellerOrganization(
  database: SqlDatabase,
  input: CreateSellerOrganizationInput,
  command: {
    actor: CustomerMasterActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<CreateSellerOrganizationResult> {
  requirePermission(command.actor, 'SELLER_MANAGE');

  await resolveMarketplace(database, input.marketplaceCode, {
    requireActive: true,
    requireAdapter: true,
  });
  const sellerChannelId = cleanRequiredText(
    input.sellerChannelId,
    120,
  );
  const organizationName = cleanRequiredText(
    input.organizationName,
    200,
  );
  const ownerDisplayName = cleanRequiredText(
    input.ownerDisplayName,
    100,
  );
  const ownerWechat = normalizeWechatForMasterData(input.ownerWechatId);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new CustomerMasterDataError('VALIDATION_ERROR', 400);
  }

  const targetHash = await hashCanonicalJson({
    marketplace_code: input.marketplaceCode,
    normalized_wechat: ownerWechat.normalized,
  });
  const requestHash = await hashCanonicalJson({
    action: 'CREATE_SELLER_ORGANIZATION',
    marketplace_code: input.marketplaceCode,
    seller_channel_id: sellerChannelId,
    organization_name: organizationName,
    owner_display_name: ownerDisplayName,
    normalized_wechat: ownerWechat.normalized,
  });

  const acquired =
    await acquireIdempotency<CreateSellerOrganizationResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'CREATE_SELLER_ORGANIZATION',
        targetType: 'SELLER_OWNER_IDENTITY',
        targetId: `seller-owner:${targetHash}`,
        idempotencyKey: command.idempotencyKey,
        requestHash,
      },
      { now },
    );

  if (acquired.kind === 'REPLAY') {
    return {
      ...acquired.response,
      replayed: true,
    };
  }

  try {
    const channel = await requireActiveSellerChannel(
      database,
      sellerChannelId,
    );
    await assertWechatAvailable(database, ownerWechat.normalized);

    const sequence = Number(channel.next_sequence);
    const sellerCode = formatSellerCustomerCode({
      prefix: channel.prefix,
      sequence,
    });
    const organizationId = crypto.randomUUID();
    const ownerMemberId = crypto.randomUUID();
    const subjectId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    const response: CreateSellerOrganizationResult = {
      seller_organization_id: organizationId,
      seller_code: sellerCode,
      owner_member_id: ownerMemberId,
      owner_identity_subject_id: subjectId,
      wechat_claim_id: claimId,
      status: 'DISABLED',
      replayed: false,
    };

    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `seller-org-created:${organizationId}`,
      eventType: 'SELLER_ORGANIZATION_CREATED',
      aggregateType: 'SELLER_ORGANIZATION',
      aggregateId: organizationId,
      payload: {
        seller_organization_id: organizationId,
        seller_code: sellerCode,
        marketplace_code: input.marketplaceCode,
        status: 'DISABLED',
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE seller_channels
        SET
          next_sequence=next_sequence+1,
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND status='ACTIVE'
          AND next_sequence=?
          AND version=?
      `).bind(
        now,
        channel.id,
        sequence,
        channel.version,
      ),
      ...createIdentityClaimStatements(database, {
        subjectId,
        subjectType: 'SELLER_ORG_MEMBER',
        claimId,
        displayWechat: ownerWechat.display,
        normalizedWechat: ownerWechat.normalized,
        actor: command.actor,
        idempotencyKey: acquired.claim.idempotencyKey,
        now,
      }),
      database.prepare(`
        INSERT INTO seller_organizations (
          id,
          marketplace_code,
          seller_code,
          origin_channel_id,
          current_channel_id,
          seller_sequence,
          organization_name,
          status,
          version,
          created_at,
          updated_at,
          activated_at,
          disabled_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          'DISABLED', 1, ?, ?, NULL, ?
        )
      `).bind(
        organizationId,
        legacyMarketplaceProjection(),
        sellerCode,
        channel.id,
        channel.id,
        sequence,
        organizationName,
        now,
        now,
        now,
      ),
      database.prepare(`
        INSERT INTO seller_organization_members (
          id,
          identity_subject_id,
          organization_id,
          member_number,
          username_fallback,
          display_name,
          role,
          primary_owner,
          status,
          version,
          created_at,
          updated_at,
          activated_at,
          disabled_at
        ) VALUES (
          ?, ?, ?, 1, ?, ?, 'OWNER', 1,
          'DISABLED', 1, ?, ?, NULL, ?
        )
      `).bind(
        ownerMemberId,
        subjectId,
        organizationId,
        `${sellerCode}-1`,
        ownerDisplayName,
        now,
        now,
        now,
      ),
      database.prepare(`
        INSERT INTO seller_organization_channel_events (
          id,
          organization_id,
          event_type,
          previous_channel_id,
          next_channel_id,
          actor_staff_id,
          reason,
          idempotency_key,
          created_at
        ) VALUES (
          ?, ?, 'ORIGIN_ASSIGNED', NULL, ?, ?,
          NULL, ?, ?
        )
      `).bind(
        crypto.randomUUID(),
        organizationId,
        channel.id,
        command.actor.staffId,
        acquired.claim.idempotencyKey,
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_ORGANIZATION',
        aggregateId: organizationId,
        eventType: 'SELLER_ORGANIZATION_CREATED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
        nextState: {
          seller_organization_id: organizationId,
          seller_code: sellerCode,
          marketplace_code: input.marketplaceCode,
          origin_channel_id: channel.id,
          current_channel_id: channel.id,
          status: 'DISABLED',
          owner_member_id: ownerMemberId,
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            seller_organization_id: organizationId,
            owner_member_id: ownerMemberId,
            identity_subject_id: subjectId,
            wechat_claim_id: claimId,
          },
          now,
        },
      ),
      assertSellerCreatedStatement(
        database,
        acquired.claim,
        channel,
        organizationId,
        ownerMemberId,
        subjectId,
        claimId,
        sellerCode,
        sequence,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await batchWithFixedAssignmentRetry(
      database,
      () => prepareInitialSellerAssignment(database, {
        sellerOrganizationId: organizationId,
        marketplaceCode: 'JP',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        reason: 'seller organization created',
        now,
      }),
      statements,
    );
    return response;
  } catch (error) {
    const normalized = normalizeFoundationError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

async function requireActiveSellerChannel(
  database: SqlDatabase,
  channelId: string,
): Promise<SellerChannelRow> {
  const row = await database.prepare(`
    SELECT
      id,
      prefix,
      next_sequence,
      version
    FROM seller_channels
    WHERE id=?
      AND status='ACTIVE'
  `).bind(channelId).first<SellerChannelRow>();

  if (!row) {
    throw new CustomerMasterDataError('CHANNEL_NOT_FOUND', 404);
  }
  return row;
}

function assertSellerCreatedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  channel: SellerChannelRow,
  organizationId: string,
  memberId: string,
  subjectId: string,
  wechatClaimId: string,
  sellerCode: string,
  sequence: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM seller_channels
        WHERE id=?
          AND next_sequence=?
          AND version=?
      )
      AND EXISTS (
        SELECT 1
        FROM seller_organizations
        WHERE id=?
          AND seller_code=?
          AND seller_sequence=?
          AND status='DISABLED'
      )
      AND EXISTS (
        SELECT 1
        FROM seller_organization_members
        WHERE id=?
          AND organization_id=?
          AND identity_subject_id=?
          AND role='OWNER'
          AND primary_owner=1
          AND status='DISABLED'
      )
      AND EXISTS (
        SELECT 1
        FROM wechat_identity_claims
        WHERE id=?
          AND identity_subject_id=?
          AND status='ACTIVE'
      )
      AND EXISTS (
        SELECT 1
        FROM command_idempotency_records
        WHERE actor_type=?
          AND actor_id=?
          AND idempotency_key=?
          AND status='COMMITTED'
          AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    channel.id,
    sequence + 1,
    channel.version + 1,
    organizationId,
    sellerCode,
    sequence,
    memberId,
    organizationId,
    subjectId,
    wechatClaimId,
    subjectId,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
