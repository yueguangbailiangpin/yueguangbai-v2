import {
  DriveArchiveClientError,
  type DriveArchiveClient,
  type DriveArchiveFailureCategory,
  type DriveUploadSessionState,
} from '@ygb/contracts';

interface FakeSession {
  fileName: string;
  totalByteSize: number;
  sha256Hex: string;
  accepted: number;
  bytes: Uint8Array[];
  folderKey: string;
  completedFileId: string | null;
}

interface FakeFile {
  bytes: Uint8Array;
  mimeType: string;
  sha256Hex: string;
}

/**
 * Local-only fake for the DriveArchiveClient port. Simulates resumable
 * chunked uploads (including mid-chunk interruption), durable session query,
 * metadata probes and streaming read-back. Never touches the network, never
 * stores tokens, and mirrors the strict failure categories the real client
 * will produce so retry classification is exercised end to end.
 */
export class FakeDriveArchiveClient implements DriveArchiveClient {
  private sessions = new Map<string, FakeSession>();
  private files = new Map<string, FakeFile>();
  private interruptNextUploadChunk = false;
  private failNext: { op: 'create' | 'chunk' | 'query' | 'metadata' | 'read'; category: DriveArchiveFailureCategory } | null = null;
  readonly folderKey: string;
  readonly uploads: {
    fileName: string;
    totalByteSize: number;
    sha256Hex: string;
    fileId: string;
  }[] = [];
  deletedFileIds: string[] = [];

  constructor(folderKey = 'fake-archive-folder') {
    this.folderKey = folderKey;
  }

  failNextOperation(
    op: 'create' | 'chunk' | 'query' | 'metadata' | 'read',
    category: DriveArchiveFailureCategory,
  ): void {
    this.failNext = { op, category };
  }

  interruptNextUpload(): void {
    this.interruptNextUploadChunk = true;
  }

  async createUploadSession(input: {
    fileName: string;
    mimeType: 'application/zip';
    totalByteSize: number;
    sha256Hex: string;
  }): Promise<DriveUploadSessionState> {
    this.takeFailure('create');
    if (typeof input.fileName !== 'string' || input.fileName.length < 1
      || !Number.isSafeInteger(input.totalByteSize) || input.totalByteSize < 0
      || !/^[0-9a-f]{64}$/.test(input.sha256Hex)) {
      throw new DriveArchiveClientError('invalid_response', 'bad session input');
    }
    const sessionKey = `fake-session:${crypto.randomUUID()}`;
    this.sessions.set(sessionKey, {
      fileName: input.fileName,
      totalByteSize: input.totalByteSize,
      sha256Hex: input.sha256Hex,
      accepted: 0,
      bytes: [],
      folderKey: this.folderKey,
      completedFileId: null,
    });
    return {
      sessionKey,
      folderKey: this.folderKey,
      acceptedByteSize: 0,
      completedFileId: null,
    };
  }

  async uploadChunk(input: {
    sessionKey: string;
    offset: number;
    bytes: Uint8Array<ArrayBuffer>;
    isFinal: boolean;
  }): Promise<{ acceptedByteSize: number; completedFileId: string | null }> {
    const session = this.requireSession(input.sessionKey);
    this.takeFailure('chunk');
    if (input.offset !== session.accepted) {
      throw new DriveArchiveClientError('session_conflict', 'offset mismatch');
    }
    let sent = input.bytes;
    if (this.interruptNextUploadChunk) {
      this.interruptNextUploadChunk = false;
      if (input.bytes.byteLength > 1) {
        const acceptedBytes = input.bytes.slice(0, Math.max(1, Math.floor(input.bytes.byteLength / 2)));
        session.bytes.push(acceptedBytes);
        session.accepted += acceptedBytes.byteLength;
        return { acceptedByteSize: session.accepted, completedFileId: null };
      }
      sent = input.bytes;
    }
    if (session.accepted + sent.byteLength > session.totalByteSize) {
      throw new DriveArchiveClientError('session_conflict', 'overflow');
    }
    session.bytes.push(sent);
    session.accepted += sent.byteLength;
    if (input.isFinal) {
      if (session.accepted !== session.totalByteSize) {
        throw new DriveArchiveClientError('session_conflict', 'incomplete final');
      }
      const fileId = `fake-drive-file:${crypto.randomUUID()}`;
      const merged = new Uint8Array(session.accepted);
      let offset = 0;
      for (const chunk of session.bytes) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      this.files.set(fileId, {
        bytes: merged,
        mimeType: 'application/zip',
        sha256Hex: session.sha256Hex,
      });
      session.completedFileId = fileId;
      this.uploads.push({
        fileName: session.fileName,
        totalByteSize: session.totalByteSize,
        sha256Hex: session.sha256Hex,
        fileId,
      });
    }
    return { acceptedByteSize: session.accepted, completedFileId: session.completedFileId };
  }

  async queryUploadSession(sessionKey: string): Promise<DriveUploadSessionState | null> {
    const session = this.sessions.get(sessionKey);
    if (!session) return null;
    this.takeFailure('query');
    return {
      sessionKey,
      folderKey: session.folderKey,
      acceptedByteSize: session.accepted,
      completedFileId: session.completedFileId,
    };
  }

  async readFileMetadata(fileId: string): Promise<{ byteSize: number; mimeType: string }> {
    const file = this.files.get(fileId);
    if (!file) throw new DriveArchiveClientError('not_found');
    this.takeFailure('metadata');
    return { byteSize: file.bytes.byteLength, mimeType: file.mimeType };
  }

  async openFileStream(fileId: string): Promise<{
    byteSize: number;
    mimeType: string;
    body: ReadableStream<Uint8Array>;
  }> {
    const file = this.files.get(fileId);
    if (!file) throw new DriveArchiveClientError('not_found');
    this.takeFailure('read');
    const bytes = file.bytes;
    let offset = 0;
    return {
      byteSize: bytes.byteLength,
      mimeType: file.mimeType,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.byteLength) {
            controller.close();
            return;
          }
          const end = Math.min(offset + 4096, bytes.byteLength);
          controller.enqueue(bytes.slice(offset, end));
          offset = end;
        },
      }),
    };
  }

  /** Test assertion helper: the fake must never delete Drive copies. */
  deleteAttempted(fileId: string): boolean {
    this.deletedFileIds.push(fileId);
    return this.deletedFileIds.includes(fileId);
  }

  storedFileCount(): number {
    return this.files.size;
  }

  storedBytes(fileId: string): Uint8Array | null {
    return this.files.get(fileId)?.bytes ?? null;
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  private requireSession(sessionKey: string): FakeSession {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new DriveArchiveClientError('not_found', 'unknown session');
    return session;
  }

  private takeFailure(op: 'create' | 'chunk' | 'query' | 'metadata' | 'read'): void {
    if (this.failNext && this.failNext.op === op) {
      const { category } = this.failNext;
      this.failNext = null;
      throw new DriveArchiveClientError(category);
    }
  }
}
