// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { staffTestAdapter, staffTestSession } from '../test-fixtures';
import { GlobalSearchDropdown } from './GlobalSearchDropdown';

afterEach(cleanup);

function renderSearch(): ReturnType<typeof renderWithMsw> {
  return renderWithMsw(
    <StaffSessionBoundary adapter={staffTestAdapter(staffTestSession('owner', []))}>
      <Routes>
        <Route path="/" element={<GlobalSearchDropdown />} />
        <Route path="/staff/buyer-customers" element={<p>买家工作台占位</p>} />
        <Route path="/staff/products/:productId" element={<p>产品详情占位</p>} />
        <Route path="/staff/orders/:orderId" element={<p>订单详情占位</p>} />
        <Route
          path="/staff/demands/:demandId/reservations"
          element={<p>投放排期占位</p>}
        />
      </Routes>
    </StaffSessionBoundary>,
    { route: '/' },
  );
}

function searchResult(query: string) {
  return {
    data: {
      query,
      buyers: query.includes('张')
        ? [{
          buyer_customer_id: 'buyer-1',
          buyer_customer_no: '20260824B03590',
          display_name: '张三丰',
          marketplace_code: 'JP',
        }]
        : [],
      products: [],
      orders: query.startsWith('250-')
        ? [{
          formal_order_id: 'order-1',
          amazon_order_number_normalized: '250-9999999-9999999',
          asin_display: 'B0SRCHAA01',
          marketplace_code: 'JP',
        }]
        : [],
      demands: [],
    },
    meta: { request_id: 'search-1' },
  };
}

describe('staff global search dropdown', () => {
  it('debounces input and links grouped results to detail pages', async () => {
    server.use(
      http.get(apiUrl('/api/staff/search'), ({ request }) =>
        HttpResponse.json(searchResult(new URL(request.url).searchParams.get('q') ?? '')),
      ),
    );
    const user = userEvent.setup();
    renderSearch();
    const box = await screen.findByRole('searchbox');
    await user.type(box, '250-9999999-9999999');
    // 防抖 300ms 后出现分组结果与直达链接
    const orderLink = await screen.findByRole('option');
    expect(orderLink).toHaveAttribute('href', '/staff/orders/order-1');
    expect(screen.getByText('250-9999999-9999999')).toBeVisible();
    await user.clear(box);
    await user.type(box, '张三丰');
    expect(await screen.findByText('20260824B03590')).toBeVisible();
    expect(screen.getByRole('option')).toHaveAttribute('href', '/staff/buyer-customers');
  });

  it('stays quiet for short input and shows the empty state', async () => {
    let requestCount = 0;
    server.use(
      http.get(apiUrl('/api/staff/search'), () => {
        requestCount += 1;
        return HttpResponse.json(searchResult(''));
      }),
    );
    const user = userEvent.setup();
    renderSearch();
    await user.type(await screen.findByRole('searchbox'), '张');
    await waitFor(
      () => expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
      { timeout: 600 },
    );
    expect(requestCount).toBe(0);
    await user.type(screen.getByRole('searchbox'), '三丰');
    expect(await screen.findByText(/没有匹配/u)).toBeVisible();
    expect(requestCount).toBe(1);
  });
});
