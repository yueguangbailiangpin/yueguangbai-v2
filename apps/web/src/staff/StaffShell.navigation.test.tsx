// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StaffSessionContext } from '../auth/staff/StaffSessionBoundary';
import type { StaffSession } from '../auth/staff/staff-auth-api';
import { StaffShell } from './StaffShell';
import {
  formatMarketplaceScope,
  getBreadcrumbForPath,
  getPageTitleForPath,
  getVisibleNavItems,
  STAFF_NAV_ITEMS,
} from './staff-navigation';
import { staffTestSession } from './test-fixtures';

afterEach(cleanup);

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderShell(
  session: StaffSession,
  route = '/staff',
): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={createClient()}>
      <MemoryRouter initialEntries={[route]}>
        <StaffSessionContext.Provider value={session}>
          <StaffShell />
        </StaffSessionContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/* ============================================================
   纯函数测试：导航配置
   ============================================================ */

describe('staff-navigation config', () => {
  it('has exactly 11 top-level items', () => {
    expect(STAFF_NAV_ITEMS).toHaveLength(11);
    expect(STAFF_NAV_ITEMS.map((i) => i.id)).toEqual([
      'workbench', 'customers', 'products', 'orders', 'reviews-evidence',
      'buyer-refunds', 'seller-settlements', 'finance', 'archive',
      'access-management', 'system',
    ]);
  });

  it('owner sees all non-upcoming items with required permissions', () => {
    const session = staffTestSession('owner', [
      'STAFF_MANAGE', 'FINANCIAL_VIEW', 'SELLER_MANAGE',
    ]);
    const items = getVisibleNavItems(session);
    const ids = items.map((i) => i.id);
    expect(ids).toContain('workbench');
    expect(ids).toContain('customers');
    expect(ids).toContain('products');
    expect(ids).toContain('buyer-refunds');
    expect(ids).toContain('finance');
    expect(ids).toContain('access-management');
    expect(ids).toContain('system');
    // upcoming items still show (marked as 规划中)
    expect(ids).toContain('orders');
    expect(ids).toContain('reviews-evidence');
    expect(ids).toContain('seller-settlements');
    expect(ids).toContain('archive');
  });


  it('pre_sales sees workbench, customers (buyer), products, but not refunds/finance/access', () => {
    const session = staffTestSession('pre_sales', []);
    const items = getVisibleNavItems(session);
    const ids = items.map((i) => i.id);
    expect(ids).toContain('workbench');
    expect(ids).toContain('customers');
    expect(ids).toContain('products');
    expect(ids).not.toContain('buyer-refunds');
    expect(ids).not.toContain('finance');
    expect(ids).not.toContain('access-management');
  });

  it('seller_ops without SELLER_MANAGE does not see finance', () => {
    const session = staffTestSession('seller_ops', []);
    const items = getVisibleNavItems(session);
    const ids = items.map((i) => i.id);
    expect(ids).toContain('products');
    expect(ids).not.toContain('finance');
  });

  it('seller_ops with SELLER_MANAGE sees finance', () => {
    const session = staffTestSession('seller_ops', ['SELLER_MANAGE']);
    const items = getVisibleNavItems(session);
    expect(items.map((i) => i.id)).toContain('finance');
  });

  it('buyer_refund sees refunds but not products/finance/access', () => {
    const session = staffTestSession('buyer_refund', []);
    const items = getVisibleNavItems(session);
    const ids = items.map((i) => i.id);
    expect(ids).toContain('buyer-refunds');
    expect(ids).not.toContain('products');
    expect(ids).not.toContain('finance');
    expect(ids).not.toContain('access-management');
  });

  it('owner without STAFF_MANAGE does not see access-management', () => {
    const session = staffTestSession('owner', ['FINANCIAL_VIEW']);
    const items = getVisibleNavItems(session);
    expect(items.map((i) => i.id)).not.toContain('access-management');
  });

  it('owner without FINANCIAL_VIEW does not see admin-dashboard in system', () => {
    const session = staffTestSession('owner', ['STAFF_MANAGE']);
    // 系统设置组只剩经营看板一个子项；无 FINANCIAL_VIEW 时整组随之隐藏。
    const system = STAFF_NAV_ITEMS.find((i) => i.id === 'system');
    expect(system).toBeDefined();
    const dashboardChild = system!.children!.find((c) => c.id === 'admin-dashboard');
    expect(dashboardChild).toBeDefined();
    expect(dashboardChild!.visible(session)).toBe(false);
    expect(getVisibleNavItems(session).map((i) => i.id)).not.toContain('system');
    // 旧“运行完整性工具”子项已随独立订单工具页退役。
    expect(system!.children).toHaveLength(1);
  });

  it('Personal DENY simulation: permissions array controls visibility', () => {
    // owner with STAFF_MANAGE sees access-management
    const withPerm = staffTestSession('owner', ['STAFF_MANAGE']);
    expect(getVisibleNavItems(withPerm).map((i) => i.id)).toContain('access-management');
    // owner without STAFF_MANAGE (simulating Personal DENY) does not
    const withoutPerm = staffTestSession('owner', []);
    expect(getVisibleNavItems(withoutPerm).map((i) => i.id)).not.toContain('access-management');
  });
});

describe('staff-navigation breadcrumb and title', () => {
  const ownerSession = staffTestSession('owner', ['STAFF_MANAGE', 'FINANCIAL_VIEW']);

  it('returns breadcrumb for finance page', () => {
    const crumbs = getBreadcrumbForPath('/staff/finance', ownerSession);
    expect(crumbs).toEqual([
      { label: '工作台', href: '/staff' },
      { label: '财务' },
    ]);
  });

  it('returns breadcrumb for nested customer page', () => {
    const crumbs = getBreadcrumbForPath('/staff/buyer-customers', ownerSession);
    expect(crumbs).toEqual([
      { label: '工作台', href: '/staff' },
      { label: '客户' },
      { label: '买家' },
    ]);
  });

  it('returns breadcrumb for work item', () => {
    const crumbs = getBreadcrumbForPath('/staff/work/w-123', ownerSession);
    const last = crumbs.at(-1);
    expect(last?.label).toBe('工作项');
  });

  it('returns page title for refunds', () => {
    expect(getPageTitleForPath('/staff/refunds', ownerSession)).toBe('买家返款');
  });

  it('returns page title for access-management', () => {
    expect(getPageTitleForPath('/staff/access-management', ownerSession)).toBe('员工与权限');
  });

  it('returns 工作台 for root', () => {
    expect(getPageTitleForPath('/staff', ownerSession)).toBe('工作台');
  });
});

describe('staff-navigation marketplace scope', () => {
  it('formats GLOBAL scope', () => {
    const session = staffTestSession('owner', []);
    expect(formatMarketplaceScope(session)).toBe('全部站点');
  });

  it('formats marketplace scope with AMAZON_JP', () => {
    const session = staffTestSession('pre_sales', []);
    expect(formatMarketplaceScope(session)).toBe('亚马逊日本');
  });

  it('does not include retired RAKUTEN_JP or TIKTOK_JP labels', () => {
    // Verify the labels object only contains active marketplaces
    const session = {
      ...staffTestSession('owner', []),
      data_scope: {
        type: 'MARKETPLACE' as const,
        marketplaceCodes: ['AMAZON_JP', 'AMAZON_US', 'COUPANG_KR'],
        buyerCustomerIds: [],
        sellerOrganizationIds: [],
        teamIds: [],
      },
    };
    const result = formatMarketplaceScope(session);
    expect(result).toContain('亚马逊日本');
    expect(result).toContain('亚马逊美国');
    expect(result).toContain('Coupang 韩国');
    expect(result).not.toContain('乐天');
    expect(result).not.toContain('TikTok');
  });
});

/* ============================================================
   组件测试：StaffShell
   ============================================================ */

describe('StaffShell rendering', () => {
  it('renders sidebar with brand and navigation for owner', () => {
    const session = staffTestSession('owner', ['STAFF_MANAGE', 'FINANCIAL_VIEW', 'SELLER_MANAGE']);
    renderShell(session, '/staff');
    // brand appears in topbar
    expect(screen.getByText('月光白', { selector: '.staff-brand strong' })).toBeInTheDocument();
    // nav links by role
    expect(screen.getByRole('link', { name: '工作台' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '财务' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '员工与权限' })).toBeInTheDocument();
  });

  it('renders session context with name, role and scope', () => {
    const session = staffTestSession('owner', []);
    renderShell(session, '/staff');
    // topbar session context
    const topbar = screen.getByRole('banner');
    expect(within(topbar).getByText('测试员工')).toBeInTheDocument();
    expect(within(topbar).getByText('总管理员')).toBeInTheDocument();
    expect(within(topbar).getByText('全部站点')).toBeInTheDocument();
  });

  it('highlights current route with active class', () => {
    const session = staffTestSession('owner', ['SELLER_MANAGE']);
    renderShell(session, '/staff/finance');
    const financeLink = screen.getByRole('link', { name: '财务' });
    expect(financeLink).toHaveClass('active');
  });

  it('does not show access-management for non-owner', () => {
    const session = staffTestSession('pre_sales', []);
    renderShell(session, '/staff');
    expect(screen.queryByRole('link', { name: '员工与权限' })).not.toBeInTheDocument();
  });

  it('does not show retired rate-center in navigation', () => {
    const session = staffTestSession('owner', ['SELLER_MANAGE']);
    renderShell(session, '/staff');
    expect(screen.queryByText('汇率中心')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /rate-center/i })).not.toBeInTheDocument();
  });

  it('marks upcoming items with 规划中 badge', () => {
    const session = staffTestSession('owner', []);
    renderShell(session, '/staff');
    expect(screen.getAllByText('规划中').length).toBeGreaterThanOrEqual(3);
  });

  it('renders page title in content heading', () => {
    const session = staffTestSession('owner', ['SELLER_MANAGE']);
    renderShell(session, '/staff/finance');
    expect(screen.getByRole('heading', { name: '财务' })).toBeInTheDocument();
  });
});

describe('StaffShell mobile drawer', () => {
  it('has mobile menu button', () => {
    const session = staffTestSession('owner', []);
    renderShell(session, '/staff');
    expect(screen.getByLabelText('打开导航菜单')).toBeInTheDocument();
  });

  it('opens drawer when menu button clicked', () => {
    const session = staffTestSession('owner', ['STAFF_MANAGE']);
    renderShell(session, '/staff');
    fireEvent.click(screen.getByLabelText('打开导航菜单'));
    expect(screen.getByRole('dialog', { name: '员工导航菜单' })).toBeInTheDocument();
  });

  it('closes drawer when close button clicked', () => {
    const session = staffTestSession('owner', []);
    renderShell(session, '/staff');
    fireEvent.click(screen.getByLabelText('打开导航菜单'));
    expect(screen.getByRole('dialog', { name: '员工导航菜单' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('关闭导航菜单'));
    expect(screen.queryByRole('dialog', { name: '员工导航菜单' })).not.toBeInTheDocument();
  });

  it('closes drawer on Escape key', () => {
    const session = staffTestSession('owner', []);
    renderShell(session, '/staff');
    fireEvent.click(screen.getByLabelText('打开导航菜单'));
    const drawer = screen.getByRole('dialog', { name: '员工导航菜单' });
    expect(drawer).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '员工导航菜单' })).not.toBeInTheDocument();
  });

  it('restores focus to menu button after drawer closes', () => {
    const session = staffTestSession('owner', []);
    renderShell(session, '/staff');
    const menuBtn = screen.getByLabelText('打开导航菜单');
    menuBtn.focus();
    fireEvent.click(menuBtn);
    fireEvent.click(screen.getByLabelText('关闭导航菜单'));
    expect(menuBtn).toHaveFocus();
  });

  it('closes drawer when navigating', () => {
    const session = staffTestSession('owner', ['SELLER_MANAGE']);
    renderShell(session, '/staff');
    fireEvent.click(screen.getByLabelText('打开导航菜单'));
    const drawer = screen.getByRole('dialog', { name: '员工导航菜单' });
    const financeLink = within(drawer).getByText('财务');
    fireEvent.click(financeLink);
    expect(screen.queryByRole('dialog', { name: '员工导航菜单' })).not.toBeInTheDocument();
  });
});

describe('StaffShell old business routes still accessible', () => {
  it('renders shell at /staff/products', () => {
    const session = staffTestSession('owner', []);
    renderShell(session, '/staff/products');
    expect(screen.getByRole('heading', { name: '产品与预约' })).toBeInTheDocument();
  });

  it('renders shell at /staff/refunds', () => {
    const session = staffTestSession('owner', []);
    renderShell(session, '/staff/refunds');
    expect(screen.getByRole('heading', { name: '买家返款' })).toBeInTheDocument();
  });
});
