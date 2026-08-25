import type { ArchiveQueueMessage, DriveArchiveClient } from '@ygb/contracts';

/**
 * Queue producer port. The real Cloudflare Queue binding is template-only
 * this stage (wrangler.example.jsonc); tests and local runs inject a fake.
 * Messages carry only the opaque envelope allowed on the wire.
 */
export interface ArchiveQueueProducer {
  send(message: ArchiveQueueMessage): Promise<void>;
}

export interface ArchiveRuntimeBindings {
  ARCHIVE_DRIVE_CLIENT?: DriveArchiveClient;
  ARCHIVE_QUEUE?: ArchiveQueueProducer;
  ARCHIVE_SELECTOR_ENABLED?: string;
  ARCHIVE_DRIVE_UPLOAD_ENABLED?: string;
  ARCHIVE_HOT_DELETE_ENABLED?: string;
  ARCHIVE_RESTORE_WORKER_ENABLED?: string;
}

export interface ArchiveRuntime {
  client: DriveArchiveClient | null;
  queue: ArchiveQueueProducer | null;
  selectorEnabled: boolean;
  driveUploadEnabled: boolean;
  hotDeleteEnabled: boolean;
  restoreWorkerEnabled: boolean;
}

/**
 * Resolve the archive runtime from bindings. Every switch defaults OFF; the
 * D1 archive_runtime_controls table is the second, independent gate (the
 * scheduled runner checks both). No Google Drive credentials exist in this
 * stage — the client must be injected (fake in tests/local).
 */
export function archiveRuntime(bindings: ArchiveRuntimeBindings): ArchiveRuntime {
  return {
    client: bindings.ARCHIVE_DRIVE_CLIENT ?? null,
    queue: bindings.ARCHIVE_QUEUE ?? null,
    selectorEnabled: bindings.ARCHIVE_SELECTOR_ENABLED === 'true',
    driveUploadEnabled: bindings.ARCHIVE_DRIVE_UPLOAD_ENABLED === 'true',
    hotDeleteEnabled: bindings.ARCHIVE_HOT_DELETE_ENABLED === 'true',
    restoreWorkerEnabled: bindings.ARCHIVE_RESTORE_WORKER_ENABLED === 'true',
  };
}

/** In-memory producer used by tests and local drain wiring. */
export class CapturingArchiveQueueProducer implements ArchiveQueueProducer {
  readonly sent: ArchiveQueueMessage[] = [];

  async send(message: ArchiveQueueMessage): Promise<void> {
    this.sent.push(message);
  }
}
