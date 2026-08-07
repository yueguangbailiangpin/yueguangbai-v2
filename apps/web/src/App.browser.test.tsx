// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router';
import { RootEntry, SellerShell } from './testable';
import { Drawer } from './ui/primitives';

afterEach(cleanup);

describe('foundation accessibility components', () => {
  it('shows exactly the two approved visible strings at root', () => {
    render(<BrowserRouter><RootEntry /></BrowserRouter>);
    const heading = screen.getByRole('heading', { name: '月光白' });
    expect(heading).toBeVisible();
    expect(heading.closest('section')).toHaveTextContent(
      /^月光白请使用工作人员发送的专属链接登录。$/u,
    );
    expect(screen.queryByText('专属访问')).toBeNull();
    expect(screen.queryByText('链接将自动确认您的访问身份')).toBeNull();
    expect(screen.queryByText('月', { exact: true })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the formal Seller metric summary without invented values', () => {
    render(<MemoryRouter initialEntries={['/seller']}><SellerShell /></MemoryRouter>);
    const summary = screen.getByRole('region', { name: '业务指标摘要' });
    for (const label of ['订单', '评论', '结算']) {
      expect(within(summary).getByText(label, { exact: true })).toBeVisible();
    }
    expect(within(summary).getAllByText('—')).toHaveLength(3);
    expect(within(summary).getAllByText('业务模块开放后显示')).toHaveLength(3);
  });

  it.each([
    ['/seller', '概览'],
    ['/seller/products', '商品'],
    ['/seller/orders', '订单'],
  ] as const)('marks only %s navigation as current', (path, currentLabel) => {
    render(<MemoryRouter initialEntries={[path]}><SellerShell /></MemoryRouter>);
    const navigation = screen.getByRole('navigation', { name: '卖家导航' });
    const current = within(navigation).getAllByRole('link').filter(
      (link) => link.getAttribute('aria-current') === 'page',
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(currentLabel);
  });

  it('uses client navigation for Seller links', async () => {
    const user = userEvent.setup();
    function LocationProbe(): React.JSX.Element {
      return <output>{useLocation().pathname}</output>;
    }
    render(<MemoryRouter initialEntries={['/seller']}>
      <SellerShell /><LocationProbe />
    </MemoryRouter>);
    await user.click(screen.getByRole('link', { name: '商品' }));
    expect(screen.getByText('/seller/products')).toBeVisible();
    expect(screen.getByRole('link', { name: '商品' })).toHaveAttribute(
      'aria-current', 'page',
    );
  });

  it('names and closes a drawer with Escape', () => { const close = vi.fn(); render(<Drawer open title="详情结构" onClose={close}>内容</Drawer>); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(close).toHaveBeenCalledOnce(); });
});
