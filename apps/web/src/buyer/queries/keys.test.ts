import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { buyerQueryKeys, cursorQuery, formalOrderQuery } from './keys';

describe('Module 1 buyer query authority', () => {
  it('separates limit 8, 20, and 100 and every cursor', () => {
    const make = (limit: number, cursor: string | null) => buyerQueryKeys.evidenceEligiblePage({ limit, cursor });
    expect(new Set([make(8, null), make(20, null), make(100, null), make(20, 'c1')]
      .map((key) => JSON.stringify(key))).size).toBe(4);
  });

  it('produces a stable key for identical complete parameters', () => {
    const parameters = { limit: 20, cursor: 'c1', marketplace: 'AMAZON_JP', productName: '月白', reviewType: 'IMAGE',
      confirmedBusinessDate: '2026-08-06', formalOrderId: 'o1', amazonOrderNumber: 'a1' };
    expect(buyerQueryKeys.formalOrdersPage(parameters)).toEqual(buyerQueryKeys.formalOrdersPage({ ...parameters }));
  });

  it('uses stable roots that match every page but no unrelated Buyer data', async () => {
    const client = new QueryClient();
    client.setQueryData(buyerQueryKeys.demandsPage({ limit: 8, cursor: null }), 'dashboard');
    client.setQueryData(buyerQueryKeys.demandsPage({ limit: 20, cursor: 'next' }), 'list');
    client.setQueryData(buyerQueryKeys.reservationsPage({ limit: 20, cursor: null }), 'reservation');
    await client.invalidateQueries({ queryKey: buyerQueryKeys.demandsRoot, refetchType: 'none' });
    expect(client.getQueryState(buyerQueryKeys.demandsPage({ limit: 8, cursor: null }))?.isInvalidated).toBe(true);
    expect(client.getQueryState(buyerQueryKeys.demandsPage({ limit: 20, cursor: 'next' }))?.isInvalidated).toBe(true);
    expect(client.getQueryState(buyerQueryKeys.reservationsPage({ limit: 20, cursor: null }))?.isInvalidated).toBe(false);
  });

  it('builds one cursor parameter and replaces it for formal order paging', () => {
    expect(cursorQuery({ limit: 20, cursor: 'next' })).toBe('limit=20&cursor=next');
    const query = formalOrderQuery({ limit: 20, cursor: 'next-2', marketplace: 'AMAZON_JP', productName: null,
      reviewType: null, confirmedBusinessDate: null, formalOrderId: null, amazonOrderNumber: null });
    const params = new URLSearchParams(query);
    expect(params.getAll('cursor')).toEqual(['next-2']);
    expect(params.get('marketplace')).toBe('AMAZON_JP');
  });

  it('separates state, content version, list page, and detail facts', () => {
    expect(new Set([
      JSON.stringify(buyerQueryKeys.instructionState('r1')),
      JSON.stringify(buyerQueryKeys.instruction('r1', 1)),
      JSON.stringify(buyerQueryKeys.instruction('r1', 2)),
      JSON.stringify(buyerQueryKeys.reservation('r1')),
      JSON.stringify(buyerQueryKeys.reservationsPage({ limit: 20, cursor: null })),
    ]).size).toBe(5);
  });
});
