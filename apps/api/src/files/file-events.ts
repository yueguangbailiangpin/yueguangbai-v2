import type {
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { canonicalJson } from '@ygb/domain';

export type FileEventType =
  | 'UPLOAD_INTENT_ISSUED'
  | 'FILE_OBJECT_UPLOADED'
  | 'FILE_UPLOAD_VERIFIED'
  | 'FILE_UPLOAD_FAILED'
  | 'FILE_OBJECT_LINKED'
  | 'FILE_READ_INTENT_ISSUED'
  | 'FILE_READ_INTENT_CONSUMED'
  | 'FILE_COMPENSATION_SCHEDULED'
  | 'FILE_OBJECT_DELETED';

export function createFileEventStatement(
  database: SqlDatabase,
  input: {
    uploadIntentId: string | null;
    fileObjectId: string | null;
    eventType: FileEventType;
    actorType: string;
    actorId: string;
    previousStatus: string | null;
    nextStatus: string;
    metadata?: unknown;
    idempotencyKey: string | null;
    createdAt: number;
  },
): SqlStatement {
  if (input.uploadIntentId === null && input.fileObjectId === null) {
    throw new Error('file_event_aggregate_required');
  }
  return database.prepare(`
    INSERT INTO file_events (
      id,
      upload_intent_id,
      file_object_id,
      event_type,
      actor_type,
      actor_id,
      previous_status,
      next_status,
      metadata_json,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.uploadIntentId,
    input.fileObjectId,
    input.eventType,
    input.actorType,
    input.actorId,
    input.previousStatus,
    input.nextStatus,
    canonicalJson(input.metadata ?? {}),
    input.idempotencyKey,
    input.createdAt,
  );
}
