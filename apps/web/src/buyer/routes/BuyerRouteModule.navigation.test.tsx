// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { BuyerRouteSlot } from '../../routes/IdentityRouteSlots';
import BuyerPortal from './BuyerRouteModule';

vi.mock('./BuyerTasksRouteModule', () => ({
  default: () => <h1>任务页面内容</h1>,
}));
vi.mock('./BuyerOrderRouteModule', () => ({
  default: () => <h1>我的页面内容</h1>,
}));

afterEach(cleanup);

describe('buyer primary navigation transitions', () => {
  it('stays clickable while switching between tasks and me repeatedly', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/buyer/tasks']}>
        <Routes>
          <Route path="/buyer/*" element={<BuyerPortal />}>
            <Route path="tasks" element={<BuyerRouteSlot />} />
            <Route path="me" element={<BuyerRouteSlot />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '任务页面内容' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: '我的' }));
    expect(await screen.findByRole('heading', { name: '我的页面内容' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: '任务' }));
    expect(await screen.findByRole('heading', { name: '任务页面内容' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: '我的' }));
    expect(await screen.findByRole('heading', { name: '我的页面内容' })).toBeVisible();
  });
});
