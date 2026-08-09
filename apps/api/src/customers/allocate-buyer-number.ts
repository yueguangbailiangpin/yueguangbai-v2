import type {
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  formatBuyerCustomerNumber,
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
  CustomerMasterDataError,
  normalizeFoundationError,
  requirePermission,
  type CustomerMasterActor,
} from './master-data-shared';

interface BuyerNumberSourceRow {
  buyer_id: string;
  access_status: string;
  buyer_customer_no: string | null;
  buyer_sequence: number | null;
  first_valid_order_business_date: string | null;
  buyer_channel_id: string;
  channel_code: string;
  channel_status: string;
  next_sequence: number;
  channel_version: number;
  buyer_version: number;
  preorder_buyer_customer_no: string | null;
  preorder_buyer_sequence: number | null;
}

export interface AllocateBuyerNumberResult {
  buyer_customer_id: string;
  buyer_customer_no: string;
  buyer_sequence: number;
  first_valid_order_business_date: string;
  already_allocated: boolean;
  replayed: boolean;
}

export async function allocateBuyerCustomerNumber(
  database: SqlDatabase,
  input: {
    buyerCustomerId: string;
    firstValidOrderBusinessDate: string;
  },
  command: {
    actor: CustomerMasterActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<AllocateBuyerNumberResult> {
  requirePermission(command.actor, 'ORDER_CONFIRM');
  const buyerCustomerId = input.buyerCustomerId.trim();
  if (buyerCustomerId.length < 1 || buyerCustomerId.length > 120) {
    throw new CustomerMasterDataError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new CustomerMasterDataError('VALIDATION_ERROR', 400);
  }
  const requestHash = await hashCanonicalJson({
    action: 'ALLOCATE_BUYER_CUSTOMER_NUMBER',
    buyer_customer_id: buyerCustomerId,
    first_valid_order_business_date: input.firstValidOrderBusinessDate,
  });
  const acquired = await acquireIdempotency<AllocateBuyerNumberResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'ALLOCATE_BUYER_CUSTOMER_NUMBER',
      targetType: 'BUYER_CUSTOMER',
      targetId: buyerCustomerId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const source = await requireBuyerNumberSource(database, buyerCustomerId);
    if (source.buyer_customer_no !== null) {
      const existing = existingResult(source);
      await database.batch([
        completeIdempotencyStatement(database, acquired.claim, existing, {
          resultReferences: {
            buyer_customer_id: buyerCustomerId,
            buyer_customer_no: source.buyer_customer_no,
          },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      return existing;
    }
    if (source.access_status !== 'ACTIVE') {
      throw new CustomerMasterDataError('CUSTOMER_NOT_ACTIVE', 409);
    }
    if (source.channel_status !== 'ACTIVE') {
      throw new CustomerMasterDataError('CHANNEL_NOT_FOUND', 404);
    }
    if (source.preorder_buyer_customer_no !== null
      && source.preorder_buyer_sequence !== null) {
      return await promotePreorderNumber(
        database,
        source,
        input.firstValidOrderBusinessDate,
        command,
        acquired.claim,
        now,
      );
    }

    const sequence = Number(source.next_sequence);
    const buyerNumber = formatBuyerCustomerNumber({
      businessDate: input.firstValidOrderBusinessDate,
      channelCode: source.channel_code,
      sequence,
    });
    const response: AllocateBuyerNumberResult = {
      buyer_customer_id: buyerCustomerId,
      buyer_customer_no: buyerNumber,
      buyer_sequence: sequence,
      first_valid_order_business_date: input.firstValidOrderBusinessDate,
      already_allocated: false,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `buyer-number-allocated:${buyerCustomerId}`,
      eventType: 'BUYER_NUMBER_ALLOCATED',
      aggregateType: 'BUYER_CUSTOMER',
      aggregateId: buyerCustomerId,
      payload: {
        buyer_customer_id: buyerCustomerId,
        buyer_customer_no: buyerNumber,
      },
      createdAt: now,
    });
    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE buyer_channels
        SET next_sequence=next_sequence+1, version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=? AND status='ACTIVE' AND next_sequence=? AND version=?
      `).bind(now, source.buyer_channel_id, sequence, source.channel_version),
      buyerUpdateStatement(database, source, buyerNumber, sequence,
        input.firstValidOrderBusinessDate, now),
      buyerNumberEventStatement(database, source, buyerNumber, sequence,
        input.firstValidOrderBusinessDate, command.actor.staffId,
        acquired.claim.idempotencyKey, now),
      numberAuditStatement(database, source, buyerNumber, sequence,
        input.firstValidOrderBusinessDate, command, acquired.claim.idempotencyKey,
        now, false),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          buyer_customer_id: buyerCustomerId,
          buyer_customer_no: buyerNumber,
        },
        now,
      }),
      assertBuyerNumberAllocatedStatement(database, source,
        buyerNumber, sequence, input.firstValidOrderBusinessDate),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeFoundationError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

async function promotePreorderNumber(
  database: SqlDatabase,
  source: BuyerNumberSourceRow,
  businessDate: string,
  command: {
    actor: CustomerMasterActor;
    idempotencyKey: string;
    requestId?: string | null;
  },
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
    action: string;
    targetType: string;
    targetId: string;
    requestHash: string;
  },
  now: number,
): Promise<AllocateBuyerNumberResult> {
  const buyerNumber = source.preorder_buyer_customer_no!;
  const sequence = Number(source.preorder_buyer_sequence);
  const response: AllocateBuyerNumberResult = {
    buyer_customer_id: source.buyer_id,
    buyer_customer_no: buyerNumber,
    buyer_sequence: sequence,
    first_valid_order_business_date: businessDate,
    already_allocated: false,
    replayed: false,
  };
  const outbox = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: `buyer-number-allocated:${source.buyer_id}`,
    eventType: 'BUYER_NUMBER_ALLOCATED',
    aggregateType: 'BUYER_CUSTOMER',
    aggregateId: source.buyer_id,
    payload: {
      buyer_customer_id: source.buyer_id,
      buyer_customer_no: buyerNumber,
      allocation_origin: 'SELF_REGISTRATION_PREORDER',
    },
    createdAt: now,
  });
  await database.batch([
    buyerUpdateStatement(database, source, buyerNumber, sequence, businessDate, now),
    buyerNumberEventStatement(database, source, buyerNumber, sequence,
      businessDate, command.actor.staffId, claim.idempotencyKey, now),
    numberAuditStatement(database, source, buyerNumber, sequence, businessDate,
      command, claim.idempotencyKey, now, true),
    ...createOutboxStatements(database, outbox),
    completeIdempotencyStatement(database, claim, response, {
      resultReferences: {
        buyer_customer_id: source.buyer_id,
        buyer_customer_no: buyerNumber,
      },
      now,
    }),
    assertPreorderPromotionStatement(database, source,
      buyerNumber, sequence, businessDate),
    assertIdempotencyCompletionStatement(database, claim),
  ]);
  return response;
}

async function requireBuyerNumberSource(
  database: SqlDatabase,
  buyerCustomerId: string,
): Promise<BuyerNumberSourceRow> {
  const row = await database.prepare(`
    SELECT
      buyer.id AS buyer_id,
      buyer.access_status,
      buyer.buyer_customer_no,
      buyer.buyer_sequence,
      buyer.first_valid_order_business_date,
      buyer.buyer_channel_id,
      channel.code AS channel_code,
      channel.status AS channel_status,
      channel.next_sequence,
      channel.version AS channel_version,
      buyer.version AS buyer_version,
      preorder.buyer_customer_no AS preorder_buyer_customer_no,
      preorder.buyer_sequence AS preorder_buyer_sequence
    FROM buyer_customers buyer
    JOIN buyer_channels channel ON channel.id=buyer.buyer_channel_id
    LEFT JOIN buyer_preorder_number_allocations preorder
      ON preorder.buyer_customer_id=buyer.id
    WHERE buyer.id=?
  `).bind(buyerCustomerId).first<BuyerNumberSourceRow>();
  if (!row) throw new CustomerMasterDataError('CUSTOMER_NOT_FOUND', 404);
  return row;
}

function existingResult(source: BuyerNumberSourceRow): AllocateBuyerNumberResult {
  if (source.buyer_customer_no === null
    || source.buyer_sequence === null
    || source.first_valid_order_business_date === null) {
    throw new CustomerMasterDataError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return {
    buyer_customer_id: source.buyer_id,
    buyer_customer_no: source.buyer_customer_no,
    buyer_sequence: Number(source.buyer_sequence),
    first_valid_order_business_date: source.first_valid_order_business_date,
    already_allocated: true,
    replayed: false,
  };
}

function buyerUpdateStatement(
  database: SqlDatabase,
  source: BuyerNumberSourceRow,
  buyerNumber: string,
  sequence: number,
  businessDate: string,
  now: number,
): SqlStatement {
  return database.prepare(`
    UPDATE buyer_customers
    SET buyer_customer_no=?, buyer_sequence=?,
      first_valid_order_business_date=?, version=version+1, updated_at=?
    WHERE id=? AND access_status='ACTIVE'
      AND buyer_customer_no IS NULL AND buyer_sequence IS NULL
      AND first_valid_order_business_date IS NULL AND version=?
  `).bind(
    buyerNumber, sequence, businessDate, now, source.buyer_id, source.buyer_version,
  );
}

function buyerNumberEventStatement(
  database: SqlDatabase,
  source: BuyerNumberSourceRow,
  buyerNumber: string,
  sequence: number,
  businessDate: string,
  actorStaffId: string,
  idempotencyKey: string,
  now: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO buyer_number_allocation_events (
      id, buyer_customer_id, buyer_channel_id, buyer_customer_no,
      buyer_sequence, first_valid_order_business_date,
      actor_staff_id, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), source.buyer_id, source.buyer_channel_id,
    buyerNumber, sequence, businessDate, actorStaffId, idempotencyKey, now,
  );
}

function numberAuditStatement(
  database: SqlDatabase,
  source: BuyerNumberSourceRow,
  buyerNumber: string,
  sequence: number,
  businessDate: string,
  command: { actor: CustomerMasterActor; requestId?: string | null },
  idempotencyKey: string,
  now: number,
  preorderPromoted: boolean,
): SqlStatement {
  return createAuditEventStatement(database, {
    id: crypto.randomUUID(),
    aggregateType: 'BUYER_CUSTOMER',
    aggregateId: source.buyer_id,
    eventType: 'BUYER_NUMBER_ALLOCATED',
    actor: {
      type: 'STAFF',
      id: command.actor.staffId,
      roles: command.actor.roles,
    },
    requestId: command.requestId ?? null,
    idempotencyKey,
    previousState: { buyer_customer_no: null },
    nextState: {
      buyer_customer_no: buyerNumber,
      buyer_sequence: sequence,
      first_valid_order_business_date: businessDate,
    },
    metadata: { preorder_promoted: preorderPromoted },
    createdAt: now,
  });
}

function assertPreorderPromotionStatement(
  database: SqlDatabase,
  source: BuyerNumberSourceRow,
  buyerNumber: string,
  sequence: number,
  businessDate: string,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1 FROM buyer_preorder_number_allocations
        WHERE buyer_customer_id=? AND buyer_customer_no=? AND buyer_sequence=?
      )
      AND EXISTS (
        SELECT 1 FROM buyer_customers
        WHERE id=? AND buyer_customer_no=? AND buyer_sequence=?
          AND first_valid_order_business_date=? AND version=?
      )
      AND EXISTS (
        SELECT 1 FROM buyer_number_allocation_events
        WHERE buyer_customer_id=? AND buyer_customer_no=? AND buyer_sequence=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    source.buyer_id, buyerNumber, sequence,
    source.buyer_id, buyerNumber, sequence, businessDate, source.buyer_version + 1,
    source.buyer_id, buyerNumber, sequence,
  );
}

function assertBuyerNumberAllocatedStatement(
  database: SqlDatabase,
  source: BuyerNumberSourceRow,
  buyerNumber: string,
  sequence: number,
  businessDate: string,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1 FROM buyer_channels
        WHERE id=? AND next_sequence=? AND version=?
      )
      AND EXISTS (
        SELECT 1 FROM buyer_customers
        WHERE id=? AND buyer_customer_no=? AND buyer_sequence=?
          AND first_valid_order_business_date=? AND version=?
      )
      AND EXISTS (
        SELECT 1 FROM buyer_number_allocation_events
        WHERE buyer_customer_id=? AND buyer_customer_no=? AND buyer_sequence=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    source.buyer_channel_id, sequence + 1, source.channel_version + 1,
    source.buyer_id, buyerNumber, sequence, businessDate, source.buyer_version + 1,
    source.buyer_id, buyerNumber, sequence,
  );
}
