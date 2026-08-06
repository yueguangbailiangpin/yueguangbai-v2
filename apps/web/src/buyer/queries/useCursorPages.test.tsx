// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { FrontendApiError } from '../../api/errors';
import { BuyerPagination } from '../shared/BuyerPagination';
import { useCursorPages } from './useCursorPages';

afterEach(cleanup);

function Harness({ resetKey, failSecond = false }: { resetKey: string; failSecond?: boolean }) {
  const pages = useCursorPages({
    resetKey,
    queryKey: (cursor) => ['cursor-test', resetKey, cursor],
    queryFn: async (cursor) => {
      if (failSecond && cursor === 'c2') throw new FrontendApiError('DEPENDENCY_UNAVAILABLE', 503, 'request-page-2', 'DEPENDENCY');
      if (cursor === null) return { items: [`${resetKey}-1`], next_cursor: 'c2' };
      if (cursor === 'c2') return { items: [`${resetKey}-2`], next_cursor: 'c3' };
      return { items: [`${resetKey}-3`], next_cursor: null };
    },
  });
  return <><p>{pages.items.join(',')}</p><BuyerPagination {...pages} onLoadMore={pages.loadMore} onRetry={pages.retryLater} /></>;
}

describe('Buyer cursor page chain', () => {
  it('accumulates three pages without replacing earlier items', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Harness resetKey="all" /></QueryClientProvider>);
    expect(await screen.findByText('all-1')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('all-1,all-2')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('all-1,all-2,all-3')).toBeVisible();
  });

  it('keeps prior pages on later failure and resets the chain when filters change', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(<QueryClientProvider client={client}><Harness resetKey="old" failSecond /></QueryClientProvider>);
    expect(await screen.findByText('old-1')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('后一页暂时无法读取，已加载内容会继续保留。')).toBeVisible();
    expect(screen.getByText('old-1')).toBeVisible();
    expect(screen.getByText(/request-page-2/u)).toBeVisible();
    rendered.rerender(<QueryClientProvider client={client}><Harness resetKey="new" /></QueryClientProvider>);
    expect(await screen.findByText('new-1')).toBeVisible();
    expect(screen.queryByText('old-1')).not.toBeInTheDocument();
  });
});
