import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { revokeInstructionFilesStatements } from './expiry';

export function createInstructionForApprovedReservationStatement(
  database: SqlDatabase,
  input: {
    instructionId: string;
    reservationId: string;
    buyerCustomerId: string;
    marketplaceCode: 'AMAZON_JP';
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO order_instructions (
      id, reservation_id, buyer_customer_id, marketplace_code,
      status, current_version_no, version, published_at,
      initial_deadline_at, resubmission_deadline_at,
      expired_at, cancelled_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'UNPUBLISHED', 0, 1,
      NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(reservation_id) DO NOTHING
  `).bind(
    input.instructionId,
    input.reservationId,
    input.buyerCustomerId,
    input.marketplaceCode,
    input.now,
    input.now,
  );
}

export function completeInstructionWithFormalOrderStatements(
  database: SqlDatabase,
  input: {
    instructionId: string;
    reservationId: string;
    expectedVersion: number;
    formalOrderId: string;
    now: number;
  },
): readonly SqlStatement[] {
  return [
    database.prepare(`
      UPDATE order_instructions
      SET status='COMPLETED', version=version+1,
          completed_at=?, updated_at=MAX(?, updated_at+1),
          resubmission_deadline_at=NULL
      WHERE id=? AND reservation_id=? AND status='ACTIVE' AND version=?
    `).bind(
      input.now,
      input.now,
      input.instructionId,
      input.reservationId,
      input.expectedVersion,
    ),
    ...revokeInstructionFilesStatements(database, input.instructionId, input.now),
    database.prepare(`
      INSERT INTO order_instruction_events (
        id, instruction_id, reservation_id, instruction_version_id,
        event_type, actor_type, actor_id, previous_status, next_status,
        aggregate_version, reason, metadata_json, idempotency_key, created_at
      ) VALUES (?, ?, ?, NULL, 'INSTRUCTION_COMPLETED', 'SYSTEM',
        'formal-order-confirmation', 'ACTIVE', 'COMPLETED', ?, NULL,
        json_object('formal_order_id', ?), ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.instructionId,
      input.reservationId,
      input.expectedVersion + 1,
      input.formalOrderId,
      `formal-order:${input.formalOrderId}`,
      input.now,
    ),
  ];
}
