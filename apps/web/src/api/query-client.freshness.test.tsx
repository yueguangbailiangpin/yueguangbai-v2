// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient as exportedQueryClient, reviewQueryClient } from './query-client';

function clientWithExportedDefaults(): QueryClient {
  return new QueryClient({ defaultOptions: exportedQueryClient.getDefaultOptions() });
}

function wrapperFor(client: QueryClient): (props: { children: ReactNode }) => React.JSX.Element {
  return function Wrapper({ children }: { children: ReactNode }): React.JSX.Element {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('tiered query freshness', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the main business client at 15s staleTime and the review/demo client at 0', () => {
    expect(exportedQueryClient.getDefaultOptions().queries?.staleTime).toBe(15_000);
    expect(reviewQueryClient.getDefaultOptions().queries?.staleTime).toBe(0);
  });

  it('serves a normal query from cache on immediate remount (no duplicate fetch within 15s)', async () => {
    const client = clientWithExportedDefaults();
    let fetches = 0;
    const key = ['freshness', 'normal-remount'];
    const queryFn = async (): Promise<number> => {
      fetches += 1;
      return fetches;
    };
    const wrapper = wrapperFor(client);

    const first = renderHook(() => useQuery({ queryKey: key, queryFn }), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(fetches).toBe(1);
    first.unmount();

    const second = renderHook(() => useQuery({ queryKey: key, queryFn }), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(second.result.current.data).toBe(1);
    expect(fetches).toBe(1);
    second.unmount();
  });

  it('refetches a normal query on remount after the 15s freshness window', async () => {
    vi.useFakeTimers();
    const client = clientWithExportedDefaults();
    let fetches = 0;
    const key = ['freshness', 'stale-after-window'];
    const queryFn = async (): Promise<number> => {
      fetches += 1;
      return fetches;
    };
    const wrapper = wrapperFor(client);

    const first = renderHook(() => useQuery({ queryKey: key, queryFn }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(first.result.current.isSuccess).toBe(true);
    expect(fetches).toBe(1);
    first.unmount();

    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });

    const second = renderHook(() => useQuery({ queryKey: key, queryFn }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(second.result.current.isSuccess).toBe(true);
    expect(second.result.current.data).toBe(2);
    expect(fetches).toBe(2);
    second.unmount();
  });

  it('refetches a staleTime:0 realtime query on immediate remount', async () => {
    const client = clientWithExportedDefaults();
    let fetches = 0;
    const key = ['freshness', 'realtime-remount'];
    const queryFn = async (): Promise<number> => {
      fetches += 1;
      return fetches;
    };
    const wrapper = wrapperFor(client);

    const first = renderHook(() => useQuery({ queryKey: key, queryFn, staleTime: 0 }), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(fetches).toBe(1);
    first.unmount();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const second = renderHook(() => useQuery({ queryKey: key, queryFn, staleTime: 0 }), { wrapper });
    await waitFor(() => expect(second.result.current.data).toBe(2));
    expect(fetches).toBe(2);
    second.unmount();
  });

  it('keeps mutation invalidation refetching immediately regardless of staleTime', async () => {
    const client = clientWithExportedDefaults();
    let fetches = 0;
    const key = ['freshness', 'invalidate-still-refetches'];
    const queryFn = async (): Promise<number> => {
      fetches += 1;
      return fetches;
    };
    const wrapper = wrapperFor(client);

    const { result } = renderHook(() => {
      const query = useQuery({ queryKey: key, queryFn });
      const queryClientInstance = useQueryClient();
      return {
        query,
        invalidate: (): void => {
          void queryClientInstance.invalidateQueries({ queryKey: key });
        },
      };
    }, { wrapper });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(fetches).toBe(1);

    result.current.invalidate();
    await waitFor(() => expect(fetches).toBe(2));
    expect(result.current.query.isFetching).toBe(false);
  });
});
