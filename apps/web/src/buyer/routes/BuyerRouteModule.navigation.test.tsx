// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { BuyerRouteSlot } from '../../routes/IdentityRouteSlots';
import BuyerPortal from './BuyerRouteModule';

vi.mock('./BuyerTasksRouteModule', () => ({
  default: () => <h1>任务页面内容</h1>,
}));
vi.mock('./BuyerAfterSalesRouteModule', () => ({
  default: () => <h1>评论页面内容</h1>,
}));
vi.mock('./BuyerOrderRouteModule', () => ({
  default: () => <h1>我的页面内容</h1>,
}));

function withBuyerPortal(initialPath: string): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/buyer/*" element={<BuyerPortal />}>
            <Route path="tasks" element={<BuyerRouteSlot />} />
            <Route path="reviews" element={<BuyerRouteSlot />} />
            <Route path="me" element={<BuyerRouteSlot />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(cleanup);

describe('buyer primary navigation transitions', () => {
  it('stays clickable while switching between sidebar destinations repeatedly', async () => {
    const user = userEvent.setup();
    render(withBuyerPortal('/buyer/tasks'));

    expect(await screen.findByRole('heading', { name: '任务页面内容' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: '账户资料' }));
    expect(await screen.findByRole('heading', { name: '我的页面内容' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: '评论任务' }));
    expect(await screen.findByRole('heading', { name: '评论页面内容' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: '账户资料' }));
    expect(await screen.findByRole('heading', { name: '我的页面内容' })).toBeVisible();
  });
});
