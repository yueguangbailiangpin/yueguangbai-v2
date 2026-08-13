import { describe, expect, it } from 'vitest';
import { CursorPaginationError, fetchAllCursorPages } from './fetchAllCursorPages';

describe('fetchAllCursorPages', () => {
  it('continues across empty pages and deduplicates only within its source', async () => {
    const cursors: Array<string | null> = [];
    const result = await fetchAllCursorPages({
      source: 'test source', signal: undefined,
      fetchPage: async (cursor) => {
        cursors.push(cursor);
        if (cursor === null) return { items: [{ id: 'one' }], next_cursor: 'second' };
        if (cursor === 'second') return { items: [], next_cursor: 'third' };
        return { items: [{ id: 'one' }, { id: 'two' }], next_cursor: null };
      },
      itemKey: (item) => `test:${item.id}`,
    });

    expect(cursors).toEqual([null, 'second', 'third']);
    expect(result.items).toEqual([{ id: 'one' }, { id: 'two' }]);
  });

  it('fails closed for a repeated cursor and a hard page cap', async () => {
    await expect(fetchAllCursorPages({
      source: 'cyclic source', signal: undefined,
      fetchPage: async () => ({ items: [], next_cursor: 'again' }), itemKey: () => 'unused',
    })).rejects.toEqual(expect.objectContaining<Partial<CursorPaginationError>>({
      name: 'CursorPaginationError', message: 'cyclic source returned a repeated cursor.',
    }));
    await expect(fetchAllCursorPages({
      source: 'bounded source', signal: undefined, maxPages: 2,
      fetchPage: async (cursor) => ({ items: [{ id: cursor ?? 'first' }], next_cursor: cursor === null ? 'second' : 'third' }),
      itemKey: (item) => item.id,
    })).rejects.toEqual(expect.objectContaining<Partial<CursorPaginationError>>({
      name: 'CursorPaginationError', message: 'bounded source exceeded the 2-page cursor safety limit.',
    }));
  });

  it('propagates cancellation before fetching another page', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Cancelled', 'AbortError'));
    await expect(fetchAllCursorPages({
      source: 'cancelled source', signal: controller.signal,
      fetchPage: async () => ({ items: [], next_cursor: null }), itemKey: () => 'unused',
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
