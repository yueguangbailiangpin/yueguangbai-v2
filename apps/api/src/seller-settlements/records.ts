import type { SqlDatabase } from '@ygb/contracts';
import {
  SellerSettlementError,
} from './shared';

export interface SellerSettlementProofFileRow {
  id: string;
  upload_intent_id: string;
  status: string;
  version: number;
  purpose: string;
  visibility: string;
  detected_mime: string | null;
  declared_mime: string;
  intent_status: string;
  intent_purpose: string;
  intent_visibility: string;
  owner_actor_type: string;
  owner_actor_id: string;
}

export interface SellerPaymentBalanceRow {
  payment_id: string;
  seller_organization_id: string;
  amount_cny_fen: number;
  effective_amount_cny_fen: number;
  allocated_amount_cny_fen: number;
  unallocated_amount_cny_fen: number;
  derived_status: string;
  paid_at: number;
  recorded_at: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface SellerPayableBalanceRow {
  payable_id: string;
  seller_organization_id: string;
  formal_order_id: string;
  payable_type: string;
  amount_cny_fen: number;
  paid_amount_cny_fen: number;
  outstanding_amount_cny_fen: number;
  derived_status: string;
  financial_snapshot_id: string;
  source_type: string;
  source_id: string;
  due_at: number;
  created_at: number;
}

export interface SellerAllocationBalanceRow {
  allocation_id: string;
  payment_id: string;
  payable_id: string;
  seller_organization_id: string;
  amount_cny_fen: number;
  reversed_amount_cny_fen: number;
  net_amount_cny_fen: number;
  allocated_at: number;
  created_at: number;
}

export async function requireSettlementProofFile(
  database: SqlDatabase,
  fileObjectId: string,
): Promise<SellerSettlementProofFileRow> {
  const row = await database.prepare(`
    SELECT
      object.id,
      object.upload_intent_id,
      object.status,
      object.version,
      object.purpose,
      object.visibility,
      object.detected_mime,
      object.declared_mime,
      intent.status AS intent_status,
      intent.purpose AS intent_purpose,
      intent.visibility AS intent_visibility,
      intent.owner_actor_type,
      intent.owner_actor_id
    FROM file_objects object
    JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
    WHERE object.id=?
  `).bind(fileObjectId).first<SellerSettlementProofFileRow>();
  if (!row) throw new SellerSettlementError('FILE_OBJECT_NOT_FOUND', 404);
  return Object.freeze({ ...row, version: Number(row.version) });
}

export async function assertSettlementProofUnused(
  database: SqlDatabase,
  fileObjectId: string,
): Promise<void> {
  const row = await database.prepare(`
    SELECT 1 AS conflict
    FROM seller_payment_proofs
    WHERE file_object_id=?
    LIMIT 1
  `).bind(fileObjectId).first<{ conflict: number }>();
  if (row) throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
}

export async function requirePaymentBalance(
  database: SqlDatabase,
  paymentId: string,
): Promise<SellerPaymentBalanceRow> {
  const row = await database.prepare(`
    SELECT * FROM seller_payment_balances WHERE payment_id=?
  `).bind(paymentId).first<SellerPaymentBalanceRow>();
  if (!row) throw new SellerSettlementError('NOT_FOUND', 404);
  return normalizePayment(row);
}

export async function requirePayableBalance(
  database: SqlDatabase,
  payableId: string,
): Promise<SellerPayableBalanceRow> {
  const row = await database.prepare(`
    SELECT * FROM seller_payable_balances WHERE payable_id=?
  `).bind(payableId).first<SellerPayableBalanceRow>();
  if (!row) throw new SellerSettlementError('NOT_FOUND', 404);
  return normalizePayable(row);
}

export async function requireAllocationBalance(
  database: SqlDatabase,
  allocationId: string,
): Promise<SellerAllocationBalanceRow> {
  const row = await database.prepare(`
    SELECT * FROM seller_allocation_net_amounts WHERE allocation_id=?
  `).bind(allocationId).first<SellerAllocationBalanceRow>();
  if (!row) throw new SellerSettlementError('NOT_FOUND', 404);
  return normalizeAllocation(row);
}

export async function listActiveAllocationsForPayment(
  database: SqlDatabase,
  paymentId: string,
): Promise<readonly SellerAllocationBalanceRow[]> {
  const rows = await database.prepare(`
    SELECT *
    FROM seller_allocation_net_amounts
    WHERE payment_id=? AND net_amount_cny_fen>0
    ORDER BY allocated_at, allocation_id
  `).bind(paymentId).all<SellerAllocationBalanceRow>();
  return Object.freeze(rows.results.map(normalizeAllocation));
}

function normalizePayment(row: SellerPaymentBalanceRow): SellerPaymentBalanceRow {
  return Object.freeze({
    ...row,
    amount_cny_fen: number(row.amount_cny_fen),
    effective_amount_cny_fen: number(row.effective_amount_cny_fen),
    allocated_amount_cny_fen: number(row.allocated_amount_cny_fen),
    unallocated_amount_cny_fen: number(row.unallocated_amount_cny_fen),
    paid_at: number(row.paid_at),
    recorded_at: number(row.recorded_at),
    version: number(row.version),
    created_at: number(row.created_at),
    updated_at: number(row.updated_at),
  });
}

function normalizePayable(row: SellerPayableBalanceRow): SellerPayableBalanceRow {
  return Object.freeze({
    ...row,
    amount_cny_fen: number(row.amount_cny_fen),
    paid_amount_cny_fen: number(row.paid_amount_cny_fen),
    outstanding_amount_cny_fen: number(row.outstanding_amount_cny_fen),
    due_at: number(row.due_at),
    created_at: number(row.created_at),
  });
}

function normalizeAllocation(
  row: SellerAllocationBalanceRow,
): SellerAllocationBalanceRow {
  return Object.freeze({
    ...row,
    amount_cny_fen: number(row.amount_cny_fen),
    reversed_amount_cny_fen: number(row.reversed_amount_cny_fen),
    net_amount_cny_fen: number(row.net_amount_cny_fen),
    allocated_at: number(row.allocated_at),
    created_at: number(row.created_at),
  });
}

function number(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SellerSettlementError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return parsed;
}