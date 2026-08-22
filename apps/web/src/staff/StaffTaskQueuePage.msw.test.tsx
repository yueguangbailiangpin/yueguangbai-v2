// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import '../test/msw/lifecycle';
import { StaffSessionBoundary } from '../auth/staff/StaffSessionBoundary';
import { apiUrl } from '../test/msw/handlers';
import { renderWithMsw } from '../test/msw/render';
import { server } from '../test/msw/server';
import { StaffTaskQueuePage } from './StaffTaskQueuePage';
import { staffTestAdapter, staffTestSession, staffTestWorkItem } from './test-fixtures';

afterEach(cleanup);

const mineItem = staffTestWorkItem;
const otherItem = {
  ...staffTestWorkItem,
  work_item_id: 'work-other',
  work_type: 'RESERVATION_DECISION' as const,
  source_entity_type: 'RESERVATION',
  source_entity_id: 'reservation-9',
  assigned_staff_id: 'staff-9',
  created_at: staffTestWorkItem.created_at - 3_600_000,
};

describe('staff task queue home', () => {
  it('splits open work into my todo and claimable pool grouped by type', async () => {
    installQueue({ open: [mineItem, otherItem] });
    renderQueue();
    expect(await screen.findByText('我的待办（1）')).toBeVisible();
    expect(screen.getByText('可认领（1）')).toBeVisible();
    expect(screen.getByText('订单资料核对')).toBeVisible();
    const claimable = screen.getByRole('region', { name: '可认领（1）' });
    expect(claimable.textContent).toContain('预约处理');
    expect(screen.getByRole('button', { name: '认领' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: '去处理' })).toHaveLength(2);
  });

  it('shows friendly empty states when both sections have no items', async () => {
    installQueue({ open: [] });
    renderQueue();
    expect(await screen.findByText('暂无我的待办')).toBeVisible();
    expect(screen.getByText('暂无可认领的待办')).toBeVisible();
  });

  it('moves a claimed item from the pool into my todo', async () => {
    window.localStorage.clear();
    installQueue({ open: [mineItem, otherItem] });
    const user = userEvent.setup();
    renderQueue();
    await screen.findByText('可认领（1）');
    await user.click(screen.getByRole('button', { name: '认领' }));
    expect(await screen.findByText('我的待办（2）')).toBeVisible();
    expect(screen.getByText('可认领（0）')).toBeVisible();
    expect(screen.queryByRole('button', { name: '认领' })).not.toBeInTheDocument();
    window.localStorage.clear();
  });

  it('navigates 去处理 to the work item page', async () => {
    window.localStorage.clear();
    installQueue({ open: [mineItem] });
    const user = userEvent.setup();
    renderQueue();
    await screen.findByText('我的待办（1）');
    await user.click(screen.getByRole('button', { name: '去处理' }));
    expect(await screen.findByText('工作项面板占位')).toBeVisible();
  });

  it('offers the owner an all view without splitting', async () => {
    window.localStorage.clear();
    installQueue({ open: [mineItem, otherItem] });
    const user = userEvent.setup();
    renderQueue();
    await screen.findByText('我的待办（1）');
    await user.click(screen.getByRole('button', { name: '全部' }));
    expect(await screen.findByText('全部待办（2）')).toBeVisible();
    expect(screen.queryByText('我的待办（1）')).not.toBeInTheDocument();
    expect(screen.queryByText('可认领（1）')).not.toBeInTheDocument();
  });

  it('hides the all view from non-owner roles', async () => {
    window.localStorage.clear();
    installQueue({ open: [otherItem] });
    renderQueue(staffTestAdapter(staffTestSession('seller_ops', [])));
    await screen.findByText('可认领（1）');
    expect(screen.queryByRole('button', { name: '全部' })).not.toBeInTheDocument();
  });

  it('lists today completed items in the collapsed section', async () => {
    window.localStorage.clear();
    const now = Date.now();
    installQueue({
      open: [],
      completed: [
        {
          ...mineItem,
          status: 'COMPLETED' as const,
          completed_at: now - 60_000,
        },
      ],
    });
    renderQueue();
    const summary = await screen.findByText(
      (_content, element) =>
        element?.tagName === 'SUMMARY' && /今日已处理（1/u.test(element.textContent ?? ''),
    );
    expect(summary).toBeVisible();
    await userEvent.click(summary);
    expect(screen.getByText('订单资料核对')).toBeVisible();
  });

  it('keeps yesterday completed items out of the today section', async () => {
    window.localStorage.clear();
    installQueue({
      open: [],
      completed: [
        {
          ...mineItem,
          status: 'COMPLETED' as const,
          completed_at: Date.now() - 26 * 3_600_000,
        },
      ],
    });
    renderQueue();
    const summary = await screen.findByText(
      (_content, element) =>
        element?.tagName === 'SUMMARY' && /今日已处理（0/u.test(element.textContent ?? ''),
    );
    await userEvent.click(summary);
    expect(screen.getByText('今天还没有已完成的工作项。')).toBeVisible();
  });
});

function installQueue(options: {
  open: (typeof staffTestWorkItem)[];
  completed?: (typeof staffTestWorkItem)[];
}): void {
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'), ({ request }) => {
      const status = new URL(request.url).searchParams.get('status') ?? 'OPEN';
      const work_items =
        status === 'COMPLETED' ? (options.completed ?? []) : options.open;
      return HttpResponse.json({
        data: { work_items, next_cursor: null },
        meta: { request_id: `queue-${status}` },
      });
    }),
  );
}

function renderQueue(
  adapter = staffTestAdapter(staffTestSession('owner', [])),
): ReturnType<typeof renderWithMsw> {
  return renderWithMsw(
    <StaffSessionBoundary adapter={adapter}>
      <Routes>
        <Route path="/staff" element={<StaffTaskQueuePage />} />
        <Route path="/staff/work/:workItemId" element={<div>工作项面板占位</div>} />
      </Routes>
    </StaffSessionBoundary>,
    { route: '/staff' },
  );
}
