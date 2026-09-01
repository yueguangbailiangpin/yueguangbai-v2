import type {
  MarketplaceCode,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
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
  cleanRequiredText,
  createIdentityClaimStatements,
  CustomerMasterDataError,
  normalizeFoundationError,
  normalizeWechatForMasterData,
  requirePermission,
  type CustomerMasterActor,
} from './master-data-shared';
import {
  advanceBuyerChannelSequenceStatement,
  insertBuyerNumberAllocationEventStatement,
  planBuyerNumberAllocation,
} from './buyer-number-allocation';
import {
  resolveMarketplace,
} from '../marketplaces/registry';
import {
  batchWithFixedAssignmentRetry,
  prepareInitialBuyerAssignment,
} from '../staff-assignment';

export interface CreateBuyerInput {
  marketplaceCode: MarketplaceCode;
  buyerChannelId: string;
  displayName: string;
  wechatId: string;
}

export interface CreateBuyerResult {
  buyer_customer_id: string;
  identity_subject_id: string;
  wechat_claim_id: string;
  access_status: 'DISABLED';
  buyer_customer_no: string;
  replayed: boolean;
}

export async function createBuyerCustomer(
  database: SqlDatabase,
  input: CreateBuyerInput,
  command: {
    actor: CustomerMasterActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<CreateBuyerResult> {
  requirePermission(command.actor, 'BUYER_CREATE');

  const displayName = cleanRequiredText(input.displayName, 100);
  const buyerChannelId = cleanRequiredText(input.buyerChannelId, 120);
  const marketplace = await resolveMarketplace(
    database,
    input.marketplaceCode,
    { requireActive: true, requireAdapter: true },
  );
  const wechat = normalizeWechatForMasterData(input.wechatId);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new CustomerMasterDataError('VALIDATION_ERROR', 400);
  }

  const targetHash = await hashCanonicalJson({
    marketplace_code: input.marketplaceCode,
    normalized_wechat: wechat.normalized,
  });
  const requestHash = await hashCanonicalJson({
    action: 'CREATE_BUYER_CUSTOMER',
    marketplace_code: input.marketplaceCode,
    buyer_channel_id: buyerChannelId,
    display_name: displayName,
    normalized_wechat: wechat.normalized,
  });

  const acquired = await acquireIdempotency<CreateBuyerResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'CREATE_BUYER_CUSTOMER',
      targetType: 'BUYER_IDENTITY',
      targetId: `buyer:${targetHash}`,
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
    await assertActiveBuyerChannel(database, buyerChannelId);
    // One WeChat identity can only ever own one buyer profile. When the
    // identity subject already exists (e.g. a Seller member), reuse it instead
    // of creating a second subject — the staff creation only adds the buyer
    // profile, never a duplicate identity.
    const existingClaim = await database.prepare(`
      SELECT claim.id AS claim_id, claim.identity_subject_id AS subject_id,
        EXISTS (
          SELECT 1 FROM buyer_customers buyer
          WHERE buyer.identity_subject_id=claim.identity_subject_id
        ) AS has_buyer
      FROM wechat_identity_claims claim
      WHERE claim.normalized_wechat=? AND claim.status='ACTIVE'
      LIMIT 1
    `).bind(wechat.normalized).first<{
      claim_id: string;
      subject_id: string;
      has_buyer: number;
    }>();
    if (existingClaim && Number(existingClaim.has_buyer) === 1) {
      throw new CustomerMasterDataError('WECHAT_ID_CONFLICT', 409);
    }
    await assertNoReservedWechat(database, wechat.normalized);
    const numberPlan = await planBuyerNumberAllocation(database, {
      channelId: buyerChannelId,
      now,
    });

    const buyerId = crypto.randomUUID();
    const subjectId = existingClaim?.subject_id ?? crypto.randomUUID();
    const claimId = existingClaim?.claim_id ?? crypto.randomUUID();
    const response: CreateBuyerResult = {
      buyer_customer_id: buyerId,
      identity_subject_id: subjectId,
      wechat_claim_id: claimId,
      access_status: 'DISABLED',
      buyer_customer_no: numberPlan.buyerNumber,
      replayed: false,
    };


    const statements: SqlStatement[] = [
      ...(existingClaim
        ? []
        : createIdentityClaimStatements(database, {
          subjectId,
          subjectType: 'BUYER_CUSTOMER',
          claimId,
          displayWechat: wechat.display,
          normalizedWechat: wechat.normalized,
          actor: command.actor,
          idempotencyKey: acquired.claim.idempotencyKey,
          now,
        })),
      database.prepare(`
        INSERT INTO buyer_customers (
          id,
          identity_subject_id,
          marketplace_code,
          buyer_channel_id,
          buyer_customer_no,
          buyer_sequence,
          display_name,
          access_status,
          identity_review_status,
          version,
          created_at,
          updated_at,
          activated_at,
          disabled_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          'DISABLED', 'CLEAR', 1, ?, ?, NULL, ?
        )
      `).bind(
        buyerId,
        subjectId,
        'AMAZON_JP',
        buyerChannelId,
        numberPlan.buyerNumber,
        numberPlan.sequence,
        displayName,
        now,
        now,
        now,
      ),
      advanceBuyerChannelSequenceStatement(database, numberPlan, now),
      insertBuyerNumberAllocationEventStatement(database, {
        buyerCustomerId: buyerId,
        plan: numberPlan,
        allocationSource: 'STAFF_CREATION',
        actorStaffId: command.actor.staffId,
        idempotencyKey: acquired.claim.idempotencyKey,
        now,
      }),
      database.prepare(`
        UPDATE buyer_marketplace_assignments
        SET marketplace_code=?
        WHERE buyer_customer_id=? AND version=1
      `).bind(marketplace.code, buyerId),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_CUSTOMER',
        aggregateId: buyerId,
        eventType: 'BUYER_CUSTOMER_CREATED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
        nextState: {
          buyer_customer_id: buyerId,
          marketplace_code: input.marketplaceCode,
          buyer_channel_id: buyerChannelId,
          buyer_customer_no: numberPlan.buyerNumber,
          access_status: 'DISABLED',
          identity_review_status: 'CLEAR',
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            buyer_customer_id: buyerId,
            identity_subject_id: subjectId,
            wechat_claim_id: claimId,
          },
          now,
        },
      ),
      assertBuyerCreatedStatement(
        database,
        acquired.claim,
        buyerId,
        subjectId,
        claimId,
        marketplace.code,
        numberPlan.buyerNumber,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await batchWithFixedAssignmentRetry(
      database,
      () => prepareInitialBuyerAssignment(database, {
        buyerCustomerId: buyerId,
        marketplaceCode: marketplace.code,
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        reason: 'buyer customer created',
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

async function assertNoReservedWechat(
  database: SqlDatabase,
  normalizedWechat: string,
): Promise<void> {
  const reserved = await database.prepare(`
    SELECT 1 AS present FROM wechat_identity_claims
    WHERE normalized_wechat=? AND status='RESERVED' LIMIT 1
  `).bind(normalizedWechat).first<{ present: number }>();
  if (reserved) {
    throw new CustomerMasterDataError('WECHAT_ID_CONFLICT', 409);
  }
}

async function assertActiveBuyerChannel(
  database: SqlDatabase,
  buyerChannelId: string,
): Promise<void> {
  const row = await database.prepare(`
    SELECT id
    FROM buyer_channels
    WHERE id=?
      AND status='ACTIVE'
  `).bind(buyerChannelId).first<{ id: string }>();

  if (!row) {
    throw new CustomerMasterDataError('CHANNEL_NOT_FOUND', 404);
  }
}

function assertBuyerCreatedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  buyerId: string,
  subjectId: string,
  claimId: string,
  marketplaceCode: string,
  buyerCustomerNo: string,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM buyer_customers
        WHERE id=?
          AND identity_subject_id=?
          AND access_status='DISABLED'
          AND buyer_customer_no=?
      )
      AND EXISTS (
        SELECT 1
        FROM buyer_marketplace_assignments
        WHERE buyer_customer_id=?
          AND marketplace_code=?
          AND version=1
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
    buyerId,
    subjectId,
    buyerCustomerNo,
    buyerId,
    marketplaceCode,
    claimId,
    subjectId,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
