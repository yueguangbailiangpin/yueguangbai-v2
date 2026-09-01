// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, within } from '@testing-library/react';
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
  it('shows only work items fixed to me; no claimable pool exists', async () => {
    installQueue({ open: [mineItem, otherItem] });
    renderQueue();
    const mineSection = await screen.findByRole('region', { name: '我的待办（1）' });
    expect(mineSection).toBeVisible();
    expect(within(mineSection).queryByText('预约处理')).not.toBeInTheDocument();
    expect(screen.queryByText('可认领')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '认领' })).not.toBeInTheDocument();
    expect(within(mineSection).getAllByRole('button', { name: '去处理' })).toHaveLength(1);
  });

  it('shows a friendly empty state when nothing is assigned to me', async () => {
    installQueue({ open: [] });
    renderQueue();
    expect(await screen.findByText('暂无待办')).toBeVisible();
  });

  it('navigates 去处理 to the work item page', async () => {
    installQueue({ open: [mineItem] });
    const user = userEvent.setup();
    renderQueue();
    const mineSection = await screen.findByRole('region', { name: '我的待办（1）' });
    await user.click(within(mineSection).getByRole('button', { name: '去处理' }));
    expect(await screen.findByText('工作项面板占位')).toBeVisible();
  });

  it('offers the owner an all view of every open work item', async () => {
    installQueue({ open: [mineItem, otherItem] });
    const user = userEvent.setup();
    renderQueue();
    await screen.findByRole('region', { name: '我的待办（1）' });
    await user.click(screen.getByText('全部待办（2）'));
    expect(await screen.findByText('预约处理')).toBeVisible();
    expect(screen.queryByText('可认领')).not.toBeInTheDocument();
  });

  it('hides the all view from non-owner roles', async () => {
    installQueue({ open: [mineItem] });
    renderQueue(staffTestAdapter(staffTestSession('seller_ops', [])));
    await screen.findByRole('region', { name: '我的待办（1）' });
    expect(screen.queryByText(/全部待办/u)).not.toBeInTheDocument();
  });

  it('lists today completed items in the recent section', async () => {
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
    expect(await screen.findByText('订单资料核对')).toBeVisible();
  });

  it('keeps yesterday completed items out of the recent section', async () => {
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
    expect(await screen.findByRole('heading', { name: '我的工作' })).toBeVisible();
    expect(screen.getByText(/今天完成/u)).toHaveTextContent('今天完成 0');
  });
});

function installQueue(options: {
  open: (typeof staffTestWorkItem)[];
  completed?: (typeof staffTestWorkItem)[];
}): void {
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'), ({ request }) => {
      const status = new URL(request.url).searchParams.get('status') ?? 'OPEN';
      const work_items = status === 'COMPLETED' ? (options.completed ?? []) : options.open;
      return HttpResponse.json({
        data: { work_items, next_cursor: null },
        meta: { request_id: `queue-${status}` },
      });
    }),
    http.get(apiUrl('/api/staff/me/work-items/summary'), () =>
      HttpResponse.json({
        data: {
          summary: {
            open_count: options.open.length,
            due_today_count: options.open.filter((item) => item.priority === 'DUE_TODAY').length,
            overdue_count: options.open.filter((item) => item.is_overdue).length,
            exception_order_count: 0,
            refund_due_today_cny_fen: null,
            recent: options.completed ?? [],
          },
        },
        meta: { request_id: 'queue-summary' },
      }),
    ),
    http.get(apiUrl('/api/staff/formal-orders'), () =>
      HttpResponse.json({
        data: { items: [], next_cursor: null },
        meta: { request_id: 'queue-orders' },
      }),
    ),
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
