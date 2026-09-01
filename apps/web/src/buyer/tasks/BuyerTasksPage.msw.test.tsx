// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  buyerApi: {
    reservations: vi.fn(), evidenceEligible: vi.fn(), evidenceList: vi.fn(),
    reviewEligible: vi.fn(), reviews: vi.fn(), refunds: vi.fn(),
  },
}));

import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { BuyerTasksPage } from './BuyerTasksPage';

const methods = [
  buyerApi.reservations, buyerApi.evidenceEligible, buyerApi.evidenceList,
  buyerApi.reviewEligible, buyerApi.reviews, buyerApi.refunds,
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BuyerTasksPage cursor aggregation', () => {
  it('shows and counts an actionable task after more than 50 earlier source records', async () => {
    useEmptySources();
    const firstPage = Array.from({ length: 50 }, (_, index) => eligibleEvidence(`first-${index}`));
    vi.mocked(buyerApi.evidenceEligible).mockImplementation(async (_client, query) => page(
      query?.includes('cursor=next') ? [eligibleEvidence('page-two')] : firstPage,
      query?.includes('cursor=next') ? null : 'next',
    ) as never);

    renderPage();

    expect(await screen.findByText('您有 51 件待办事项')).toBeVisible();
    expect(document.querySelectorAll('.buyer-task-row')).toHaveLength(51);
  });

  it('continues an empty first page when the next page contains actionable work', async () => {
    useEmptySources();
    vi.mocked(buyerApi.evidenceEligible).mockImplementation(async (_client, query) => page(
      query?.includes('cursor=page-two') ? [eligibleEvidence('later-action')] : [],
      query?.includes('cursor=page-two') ? null : 'page-two',
    ) as never);

    renderPage();

    expect(await screen.findByText('您有 1 件待办事项')).toBeVisible();
    expect(screen.getByText('查看下单步骤')).toBeVisible();
  });

  it('keeps processing-only later pages out of the actionable count', async () => {
    useEmptySources();
    vi.mocked(buyerApi.refunds).mockImplementation(async (_client, query) => page(
      query?.includes('cursor=refund-two')
        ? [refund('refund-50')]
        : Array.from({ length: 50 }, (_, index) => refund(`refund-${index}`)),
      query?.includes('cursor=refund-two') ? null : 'refund-two',
    ) as never);

    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: '系统处理中' })).toBeVisible());
    expect(screen.getByText('暂时没有待办事项，休息一下～')).toBeVisible();
    expect(screen.getByText('51')).toBeVisible();
  });

  it('keeps a completed actionable source visible while a necessary source fails', async () => {
    useEmptySources();
    let successfulSourceCompleted = false;
    vi.mocked(buyerApi.evidenceEligible).mockImplementation(async (_client, query) => {
      expect(query).toBe('limit=50');
      successfulSourceCompleted = true;
      return page([eligibleEvidence('surviving-action')]) as never;
    });
    vi.mocked(buyerApi.reservations).mockImplementation(async (_client, query) => {
      expect(query).toBe('limit=50');
      throw new Error('network down');
    });

    renderPage();

    await waitFor(() => {
      expect(successfulSourceCompleted).toBe(true);
      expect(vi.mocked(buyerApi.reservations)).toHaveBeenCalledTimes(1);
      expect(screen.getByText('查看下单步骤')).toBeVisible();
    });
    expect(screen.getByText('产品 surviving-action · 图片评论')).toBeVisible();
    expect(screen.getByRole('heading', { name: '任务状态暂时无法完整读取' })).toBeVisible();
    expect(screen.getByText('部分任务状态暂时无法加载，请稍后刷新；已成功读取的事项仍可继续处理。')).toBeVisible();
    expect(screen.queryByText(/您有 \d+ 件待办事项/u)).not.toBeInTheDocument();
  });

  it('uses limit and cursor parameters for every one of the six sources', async () => {
    for (const [index, method] of methods.entries()) {
      vi.mocked(method).mockImplementation(async (_client, query) => page([], query?.includes(`cursor=source-${index}`) ? null : `source-${index}`) as never);
    }

    renderPage();
    await waitFor(() => expect(methods.every((method) => vi.mocked(method).mock.calls.length === 2)).toBe(true));

    const expectedQueries = [
      ['limit=50', 'limit=50&cursor=source-0'],
      ['limit=50', 'limit=50&cursor=source-1'],
      ['limit=50&status=CHANGES_REQUESTED%2CPENDING_VERIFICATION', 'limit=50&cursor=source-2&status=CHANGES_REQUESTED%2CPENDING_VERIFICATION'],
      ['limit=50', 'limit=50&cursor=source-3'],
      ['limit=50&status=CHANGES_REQUESTED%2CPENDING_REVIEW', 'limit=50&cursor=source-4&status=CHANGES_REQUESTED%2CPENDING_REVIEW'],
      ['limit=50&outstanding_only=true', 'limit=50&cursor=source-5&outstanding_only=true'],
    ];
    for (const [index, method] of methods.entries()) {
      expect(vi.mocked(method).mock.calls.map(([, query]) => query))
        .toEqual(expectedQueries[index]);
    }
  });

  it('requests active-status filters for history sources and keeps filter-aware cache keys', async () => {
    useEmptySources();
    renderPage();
    await waitFor(() => expect(methods.every((method) => vi.mocked(method).mock.calls.length === 1)).toBe(true));

    const queriesFor = (method: (typeof methods)[number]) =>
      vi.mocked(method).mock.calls.map(([, query]) => query);
    expect(queriesFor(buyerApi.reservations)).toEqual(['limit=50']);
    expect(queriesFor(buyerApi.evidenceEligible)).toEqual(['limit=50']);
    expect(queriesFor(buyerApi.evidenceList)).toEqual(['limit=50&status=CHANGES_REQUESTED%2CPENDING_VERIFICATION']);
    expect(queriesFor(buyerApi.reviewEligible)).toEqual(['limit=50']);
    expect(queriesFor(buyerApi.reviews)).toEqual(['limit=50&status=CHANGES_REQUESTED%2CPENDING_REVIEW']);
    expect(queriesFor(buyerApi.refunds)).toEqual(['limit=50&outstanding_only=true']);

    expect(buyerQueryKeys.evidenceListPage({ limit: 50, cursor: null, status: ['CHANGES_REQUESTED', 'PENDING_VERIFICATION'] }))
      .not.toEqual(buyerQueryKeys.evidenceListPage({ limit: 50, cursor: null }));
    expect(buyerQueryKeys.reviewsPage({ limit: 50, cursor: null, status: ['CHANGES_REQUESTED', 'PENDING_REVIEW'] }))
      .not.toEqual(buyerQueryKeys.reviewsPage({ limit: 50, cursor: null }));
    expect(buyerQueryKeys.refundsPage({ limit: 50, cursor: null, outstandingOnly: true }))
      .not.toEqual(buyerQueryKeys.refundsPage({ limit: 50, cursor: null }));
  });

  it('deduplicates a resource within one source but fails closed for a cyclic cursor', async () => {
    useEmptySources();
    vi.mocked(buyerApi.evidenceEligible).mockImplementation(async (_client, query) => page(
      [eligibleEvidence('once')], query?.includes('cursor=dedupe') ? null : 'dedupe',
    ) as never);
    renderPage();
    expect(await screen.findByText('您有 1 件待办事项')).toBeVisible();
    expect(document.querySelectorAll('.buyer-task-row')).toHaveLength(1);
    cleanup();

    useEmptySources();
    vi.mocked(buyerApi.evidenceEligible).mockResolvedValue(page([], 'cycle') as never);
    renderPage();
    expect(await screen.findByText('任务状态暂时无法完整读取')).toBeVisible();
    expect(screen.queryByText(/您有 \d+ 件待办事项/u)).not.toBeInTheDocument();
  });

  it('passes the query signal to the source request and aborts it on unmount', async () => {
    useEmptySources();
    let sourceSignal: AbortSignal | undefined;
    vi.mocked(buyerApi.reservations).mockImplementation(async (_client, _query, signal) => {
      sourceSignal = signal;
      return await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const rendered = renderPage();
    await waitFor(() => expect(sourceSignal).toBeDefined());
    rendered.unmount();
    await waitFor(() => expect(sourceSignal?.aborted).toBe(true));
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><BuyerTasksPage /></QueryClientProvider></MemoryRouter>);
}

function useEmptySources(): void {
  for (const method of methods) vi.mocked(method).mockResolvedValue(page([]) as never);
}

function page(items: readonly unknown[], next_cursor: string | null = null) {
  return { data: { items, next_cursor } };
}

function eligibleEvidence(reservation_id: string) {
  return { reservation_id, product_name: `产品 ${reservation_id}`, review_type: 'IMAGE', allowed_actions: ['SUBMIT'] };
}

function refund(refund_obligation_id: string) {
  return { refund_obligation_id, status: 'DUE', order: { product_name: `返款产品 ${refund_obligation_id}` } };
}
