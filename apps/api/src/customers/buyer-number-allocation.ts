import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { chinaBusinessDate, formatBuyerCustomerNumber } from '@ygb/domain';
import { CustomerMasterDataError } from './master-data-shared';

export interface BuyerNumberAllocationPlan {
  channelId: string;
  channelCode: string;
  channelVersion: number;
  sequence: number;
  buyerNumber: string;
  businessDate: string;
}

interface BuyerChannelRow {
  id: string;
  code: string;
  status: string;
  next_sequence: number;
  version: number;
}

/**
 * Stage 6.6 (D-056): buyer numbers are allocated the moment a buyer profile
 * is first recorded. The candidate sequence is the greater of the channel
 * counter and one past the largest sequence already carried by any buyer
 * number in the database, so allocation always continues from the historical
 * maximum even if the counter was seeded too low. The channel advance is an
 * optimistic-lock UPDATE inside the caller's batch; losing the race rolls the
 * whole command back and the retry re-plans safely.
 */
export async function planBuyerNumberAllocation(
  database: SqlDatabase,
  input: { channelId: string; now: number },
): Promise<BuyerNumberAllocationPlan> {
  const channel = await database.prepare(`
    SELECT id, code, status, next_sequence, version
    FROM buyer_channels
    WHERE id=?
  `).bind(input.channelId).first<BuyerChannelRow>();

  if (!channel || channel.status !== 'ACTIVE'
    || !Number.isSafeInteger(Number(channel.next_sequence))
    || Number(channel.next_sequence) < 1) {
    throw new CustomerMasterDataError('CHANNEL_NOT_FOUND', 404);
  }

  // D-056 fixes the buyer number format to YYYYMMDD + B/C + sequence; the
  // database CHECK on buyer_customer_no only accepts these two channel codes.
  if (channel.code !== 'B' && channel.code !== 'C') {
    throw new CustomerMasterDataError('CHANNEL_NOT_FOUND', 404);
  }

  const maxExisting = await database.prepare(`
    SELECT MAX(CAST(substr(buyer_customer_no, 10) AS INTEGER)) AS max_sequence
    FROM buyer_customers
    WHERE buyer_channel_id=?
      AND buyer_customer_no IS NOT NULL
  `).bind(channel.id).first<{ max_sequence: number | null }>();

  const fromExisting = Number(maxExisting?.max_sequence ?? 0) + 1;
  const sequence = Math.max(Number(channel.next_sequence), fromExisting);
  const businessDate = chinaBusinessDate(input.now);

  return {
    channelId: channel.id,
    channelCode: channel.code,
    channelVersion: Number(channel.version),
    sequence,
    buyerNumber: formatBuyerCustomerNumber({
      businessDate,
      channelCode: channel.code,
      sequence,
    }),
    businessDate,
  };
}

export function advanceBuyerChannelSequenceStatement(
  database: SqlDatabase,
  plan: BuyerNumberAllocationPlan,
  now: number,
): SqlStatement {
  return database.prepare(`
    UPDATE buyer_channels
    SET next_sequence=?, version=version+1, updated_at=MAX(?, updated_at+1)
    WHERE id=? AND status='ACTIVE' AND next_sequence=? AND version=?
  `).bind(
    plan.sequence + 1,
    now,
    plan.channelId,
    plan.sequence,
    plan.channelVersion,
  );
}

export function insertBuyerNumberAllocationEventStatement(
  database: SqlDatabase,
  input: {
    buyerCustomerId: string;
    plan: BuyerNumberAllocationPlan;
    allocationSource: 'STAFF_CREATION' | 'INVITED_REGISTRATION';
    actorStaffId: string | null;
    idempotencyKey: string;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO buyer_number_allocation_events (
      id, buyer_customer_id, buyer_channel_id, buyer_customer_no,
      buyer_sequence, allocation_business_date, allocation_source,
      actor_staff_id, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.buyerCustomerId,
    input.plan.channelId,
    input.plan.buyerNumber,
    input.plan.sequence,
    input.plan.businessDate,
    input.allocationSource,
    input.actorStaffId,
    input.idempotencyKey,
    input.now,
  );
}
