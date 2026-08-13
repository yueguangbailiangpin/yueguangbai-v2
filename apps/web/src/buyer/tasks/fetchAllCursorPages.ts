export const BUYER_TASK_CURSOR_PAGE_LIMIT = 50;
export const BUYER_TASK_CURSOR_MAX_PAGES = 1_000;

export type CursorPage<Item> = Readonly<{
  items: readonly Item[];
  next_cursor: string | null;
}>;

export class CursorPaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CursorPaginationError';
  }
}

export async function fetchAllCursorPages<Item>(options: Readonly<{
  source: string;
  signal: AbortSignal | undefined;
  fetchPage: (cursor: string | null) => Promise<CursorPage<Item>>;
  itemKey: (item: Item) => string;
  maxPages?: number;
}>): Promise<Readonly<{ items: readonly Item[] }>> {
  const maxPages = options.maxPages ?? BUYER_TASK_CURSOR_MAX_PAGES;
  const items: Item[] = [];
  const seenItemKeys = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    throwIfAborted(options.signal);
    const page = await options.fetchPage(cursor);
    throwIfAborted(options.signal);

    for (const item of page.items) {
      const key = options.itemKey(item);
      if (seenItemKeys.has(key)) continue;
      seenItemKeys.add(key);
      items.push(item);
    }

    if (page.next_cursor === null) return { items };
    if (seenCursors.has(page.next_cursor)) {
      throw new CursorPaginationError(`${options.source} returned a repeated cursor.`);
    }
    seenCursors.add(page.next_cursor);
    cursor = page.next_cursor;
  }

  throw new CursorPaginationError(`${options.source} exceeded the ${maxPages}-page cursor safety limit.`);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
