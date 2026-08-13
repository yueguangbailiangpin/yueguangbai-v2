import { describe, expect, it, vi } from 'vitest';
import { CloudflareD1RestDatabase } from './cloudflare-d1-rest-database.mjs';

const ACCOUNT = 'a'.repeat(32);
const DATABASE = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'operator-token-value-that-is-never-logged';

describe('Cloudflare D1 REST database adapter', () => {
  it('uses parameter arrays and one provider batch without putting values in SQL', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({ batch: [
        { sql: 'INSERT INTO example(value) VALUES(?)', params: ['owner@example.test'] },
        { sql: 'INSERT INTO example(value) VALUES(?)', params: ['1000'] },
        { sql: 'SELECT COUNT(*) FROM example', params: [] },
      ] });
      expect(String(init.headers.Authorization)).toBe(`Bearer ${TOKEN}`);
      return Response.json({ success: true, result: [
        { success: true, results: [], meta: { changes: 1 } },
        { success: true, results: [], meta: { changes: 1 } },
        { success: true, results: [{ total: 1 }], meta: { changes: 0 } },
      ] });
    });
    const database = new CloudflareD1RestDatabase({
      accountId: ACCOUNT,
      databaseId: DATABASE,
      token: TOKEN,
      fetchImpl,
    });
    await expect(database.batch([
      database.prepare('INSERT INTO example(value) VALUES(?)').bind('owner@example.test'),
      database.prepare('INSERT INTO example(value) VALUES(?)').bind(1000),
      database.prepare('SELECT COUNT(*) FROM example'),
    ])).resolves.toMatchObject([
      { meta: { changes: 1 } },
      { meta: { changes: 1 } },
      { meta: { changes: 0 } },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).not.toContain(TOKEN);
    expect(() => database.prepare('SELECT ?').bind(null))
      .toThrow('unsupported_d1_rest_binding');
  });

  it('returns a fixed sanitized failure without provider body or token', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: TOKEN, email: 'owner@example.test' }),
      { status: 500 },
    ));
    const database = new CloudflareD1RestDatabase({
      accountId: ACCOUNT,
      databaseId: DATABASE,
      token: TOKEN,
      fetchImpl,
    });
    const error = await database.prepare('SELECT 1').first().catch((value) => value);
    expect(String(error)).toBe('Error: d1_rest_query_failed');
    expect(String(error)).not.toContain(TOKEN);
    expect(String(error)).not.toContain('owner@example.test');
  });
});
