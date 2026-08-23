import { useQueries, type QueryKey } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

export type CursorPage<T> = Readonly<{
  items: readonly T[];
  next_cursor: string | null;
}>;

export function useCursorPages<T>(input: Readonly<{
  resetKey: string;
  queryKey: (cursor: string | null) => QueryKey;
  queryFn: (cursor: string | null, signal: AbortSignal) => Promise<CursorPage<T>>;
}>) {
  const [chain, setChain] = useState<Readonly<{
    resetKey: string;
    cursors: readonly (string | null)[];
  }>>({ resetKey: input.resetKey, cursors: [null] });
  const cursors = chain.resetKey === input.resetKey ? chain.cursors : [null];
  useEffect(() => {
    setChain((current) => current.resetKey === input.resetKey
      ? current
      : { resetKey: input.resetKey, cursors: [null] });
  }, [input.resetKey]);
  const queries = useQueries({
    queries: cursors.map((cursor) => ({
      queryKey: input.queryKey(cursor),
      queryFn: ({ signal }: { signal: AbortSignal }) => input.queryFn(cursor, signal),
      // 已翻页的旧页保持挂载只为渲染；窗口聚焦时整链重拉在深翻页后
      // 是 N 个整页请求的放大器（新鲜度交给手动刷新与 mutation 失效）。
      refetchOnWindowFocus: false,
    })),
  });
  // 依赖各页数据的更新时间戳而非 useQueries 的外层数组（每次渲染都是
  // 新数组），否则任何本页 state 变化都会让整列表行重渲染。
  const stamps = queries.map((query) => query.dataUpdatedAt);
  const items = useMemo(
    () => queries.flatMap((query) => query.data?.items ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cursors, ...stamps],
  );
  const last = queries.at(-1);
  const nextCursor = last?.data?.next_cursor ?? null;
  const loadMore = (): void => {
    if (!last?.isSuccess || nextCursor === null || cursors.includes(nextCursor)) return;
    setChain((current) => current.resetKey !== input.resetKey
      ? { resetKey: input.resetKey, cursors: [null] }
      : { ...current, cursors: [...current.cursors, nextCursor] });
  };
  return Object.freeze({
    items,
    isInitialPending: queries[0]?.isPending ?? true,
    initialError: queries[0]?.error ?? null,
    laterError: queries.length > 1 && last?.isError ? last.error : null,
    hasMore: last?.isSuccess === true
      && nextCursor !== null
      && !cursors.includes(nextCursor),
    isLoadingMore: queries.length > 1 && last?.isPending === true,
    loadMore,
    retryInitial: () => { void queries[0]?.refetch(); },
    retryLater: () => { void last?.refetch(); },
    cursors,
  });
}
