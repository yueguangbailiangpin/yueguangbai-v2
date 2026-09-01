/**
 * 会话级受保护图私有缓存（图片性能）。同一文件版本在同一会话内只走
 * 一次"签发读意图 → 取字节"链路：blob URL 由本模块持有并在预算内复用，
 * 组件卸载不回收；超预算按最旧淘汰并回收 URL。密钥含身份与版本，
 * 重新上传（版本+1）自然失效。这是纯前端缓存——一次性令牌与
 * no-store 传输语义完全不变。
 */

const DEFAULT_BUDGET_BYTES = 48 * 1024 * 1024;
const MAXIMUM_SINGLE_ENTRY_BYTES = 26 * 1024 * 1024;

export interface SessionBlobInfo {
  objectUrl: string;
  contentType: string;
  byteSize: number;
}

interface CacheEntry extends SessionBlobInfo {
  key: string;
}

const entries = new Map<string, CacheEntry>();
let totalBytes = 0;
let budgetBytes = DEFAULT_BUDGET_BYTES;

export function configureSessionBlobBudget(bytes: number): void {
  budgetBytes = Math.max(1024 * 1024, bytes);
  evictToBudget();
}

export function sessionBlobCacheKey(input: {
  identity: string;
  reference: { file_object_id: string; file_version: number };
}): string {
  return `${input.identity}:${input.reference.file_object_id}:${input.reference.file_version}`;
}

export function peekSessionBlob(key: string): SessionBlobInfo | null {
  const entry = entries.get(key);
  if (!entry) return null;
  // refresh LRU position
  entries.delete(key);
  entries.set(key, entry);
  return {
    objectUrl: entry.objectUrl,
    contentType: entry.contentType,
    byteSize: entry.byteSize,
  };
}

/**
 * Stores the blob and returns its cached info. Returns null when the blob is
 * too large to cache — the caller keeps ownership of a self-created URL in
 * that case.
 */
export function storeSessionBlob(
  key: string,
  blob: Blob,
  contentType: string,
): SessionBlobInfo | null {
  if (blob.size > MAXIMUM_SINGLE_ENTRY_BYTES || blob.size > budgetBytes) {
    return null;
  }
  const existing = entries.get(key);
  if (existing) {
    return {
      objectUrl: existing.objectUrl,
      contentType: existing.contentType,
      byteSize: existing.byteSize,
    };
  }
  const entry: CacheEntry = {
    key,
    objectUrl: URL.createObjectURL(blob),
    contentType,
    byteSize: blob.size,
  };
  entries.set(key, entry);
  totalBytes += blob.size;
  evictToBudget();
  return {
    objectUrl: entry.objectUrl,
    contentType: entry.contentType,
    byteSize: entry.byteSize,
  };
}

export function isSessionCachedObjectUrl(
  key: string,
  objectUrl: string,
): boolean {
  return entries.get(key)?.objectUrl === objectUrl;
}

export function clearSessionBlobCache(): void {
  for (const entry of entries.values()) {
    URL.revokeObjectURL(entry.objectUrl);
  }
  entries.clear();
  totalBytes = 0;
}

function evictToBudget(): void {
  while (totalBytes > budgetBytes && entries.size > 1) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    const entry = entries.get(oldest.value);
    entries.delete(oldest.value);
    if (entry) {
      totalBytes -= entry.byteSize;
      URL.revokeObjectURL(entry.objectUrl);
    }
  }
}
