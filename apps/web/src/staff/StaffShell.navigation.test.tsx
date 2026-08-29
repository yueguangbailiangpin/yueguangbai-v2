// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StaffSessionContext } from '../auth/staff/StaffSessionBoundary';
import type { StaffSession } from '../auth/staff/staff-auth-api';
import { StaffShell } from './StaffShell';
import { MoonwhiteIcon } from './shared/MoonwhiteIcon';
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

function renderShell(session: StaffSession, route = '/staff'): ReturnType<typeof render> {
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
  it('has exactly 9 top-level items with no placeholder entries (7F-1)', () => {
    expect(STAFF_NAV_ITEMS).toHaveLength(9);
    expect(STAFF_NAV_ITEMS.map((i) => i.id)).toEqual([
      'workbench',
      'buyer-customers',
      'seller-customers',
      'products',
      'orders',
      'buyer-refunds',
      'finance',
      'access-management',
      'system',
    ]);
    // 7F-1 收口：不再有规划中占位入口（评论与凭证/卖家结算/文件归档已退役）。
    const retired = ['reviews-evidence', 'seller-settlements', 'archive'];
    expect(STAFF_NAV_ITEMS.some((item) => retired.includes(item.id))).toBe(false);
  });

  it('owner sees all items with required permissions', () => {
    const session = staffTestSession('owner', ['STAFF_MANAGE', 'FINANCIAL_VIEW', 'SELLER_MANAGE']);
    const items = getVisibleNavItems(session);
    const ids = items.map((i) => i.id);
    expect(ids).toContain('workbench');
    expect(ids).toContain('buyer-customers');
    expect(ids).toContain('seller-customers');
    expect(ids).toContain('products');
    expect(ids).toContain('orders');
    expect(ids).toContain('buyer-refunds');
    expect(ids).toContain('finance');
    expect(ids).toContain('access-management');
    expect(ids).toContain('system');
  });

  it('pre_sales sees workbench, buyer customers, products, but not refunds/finance/access', () => {
    const session = staffTestSession('pre_sales', []);
    const items = getVisibleNavItems(session);
    const ids = items.map((i) => i.id);
    expect(ids).toContain('workbench');
    expect(ids).toContain('buyer-customers');
    expect(ids).not.toContain('seller-customers');
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
    // Stage 7.5 batch 2 起系统设置组含经营看板 + 客服渠道两个子项；
    // 无 FINANCIAL_VIEW 时经营看板隐藏，但客服渠道（STAFF_MANAGE）仍可见，
    // 因此整组对持有 STAFF_MANAGE 的 owner 保持可见。
    const system = STAFF_NAV_ITEMS.find((i) => i.id === 'system');
    expect(system).toBeDefined();
    const dashboardChild = system!.children!.find((c) => c.id === 'admin-dashboard');
    expect(dashboardChild).toBeDefined();
    expect(dashboardChild!.visible(session)).toBe(false);
    const channelsChild = system!.children!.find((c) => c.id === 'service-channels');
    expect(channelsChild).toBeDefined();
    expect(channelsChild!.visible(session)).toBe(true);
    expect(getVisibleNavItems(session).map((i) => i.id)).toContain('system');
    // 旧“运行完整性工具”子项已随独立订单工具页退役。
    expect(system!.children).toHaveLength(2);
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
    expect(crumbs).toEqual([{ label: '工作台', href: '/staff' }, { label: '财务' }]);
  });

  it('returns breadcrumb for customer page', () => {
    const crumbs = getBreadcrumbForPath('/staff/buyer-customers', ownerSession);
    expect(crumbs).toEqual([{ label: '工作台', href: '/staff' }, { label: '买家客户' }]);
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
    expect(
      screen.getByText('月光白', { selector: '.sa-topbar__brand strong' }),
    ).toBeInTheDocument();
    // nav links by role
    const navigation = screen.getByRole('navigation', { name: '员工工作台主导航' });
    expect(within(navigation).getByRole('link', { name: '工作台' })).toBeInTheDocument();
    expect(within(navigation).getByRole('link', { name: '财务' })).toBeInTheDocument();
    expect(within(navigation).getByRole('link', { name: '员工与权限' })).toBeInTheDocument();
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
    expect(financeLink).toHaveClass('is-active');
  });

  it('uses the semantic Material Symbols Rounded adapter for every visible navigation icon', () => {
    const session = staffTestSession('owner', ['STAFF_MANAGE', 'FINANCIAL_VIEW', 'SELLER_MANAGE']);
    renderShell(session, '/staff');
    const navigation = screen.getByRole('navigation', { name: '员工工作台主导航' });
    const expectedIcons: Record<string, string> = {
      工作台: 'dashboard',
      买家客户: 'groups',
      卖家客户: 'storefront',
      产品与预约: 'event_available',
      订单: 'receipt_long',
      买家返款: 'currency_exchange',
      财务: 'account_balance',
      员工与权限: 'manage_accounts',
      经营看板: 'monitoring',
      客服渠道: 'support_agent',
    };

    for (const [label, iconClass] of Object.entries(expectedIcons)) {
      const link = within(navigation).getByRole('link', { name: label });
      const iconBox = link.querySelector('.sa-nav__icon');
      const semanticIcon = iconBox?.querySelector('.moonwhite-icon');
      expect(iconBox).toBeInTheDocument();
      const svg = iconBox?.querySelector('svg');
      const path = svg?.querySelector('path');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
      expect(svg).toHaveAttribute('width', '24');
      expect(svg).toHaveAttribute('height', '24');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('focusable', 'false');
      expect(svg).toHaveAttribute('fill', 'currentColor');
      expect(path).toHaveAttribute('fill', 'currentColor');
      expect(path).toHaveAttribute('transform', 'matrix(0.025 0 0 0.025 0 24)');
      expect(path?.getAttribute('d')).toBeTruthy();
      expect(semanticIcon).toHaveAttribute('data-icon', iconClass);
      expect(semanticIcon).toHaveAttribute('data-fill', label === '工作台' ? '1' : '0');
      expect(semanticIcon).toHaveAttribute('aria-hidden', 'true');
      expect(semanticIcon).toHaveAttribute('data-size', '24');
    }
  });

  it('selects distinct local outline and filled SVG states without ligature text', () => {
    const { container } = render(
      <div>
        <MoonwhiteIcon name="dashboard" />
        <MoonwhiteIcon name="dashboard" filled />
      </div>,
    );
    const icons = [...container.querySelectorAll<HTMLElement>('.moonwhite-icon')];
    expect(icons).toHaveLength(2);
    expect(icons[0]).toHaveAttribute('data-fill', '0');
    expect(icons[1]).toHaveAttribute('data-fill', '1');
    expect(icons[0]?.textContent).toBe('');
    expect(icons[1]?.textContent).toBe('');
    expect(icons[0]?.querySelector('svg path')?.getAttribute('d')).not.toBe(
      icons[1]?.querySelector('svg path')?.getAttribute('d'),
    );
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

  it('never renders 规划中 badges or placeholder navigation (7F-1)', () => {
    const session = staffTestSession('owner', []);
    renderShell(session, '/staff');
    expect(screen.queryByText('规划中')).not.toBeInTheDocument();
    expect(screen.queryByText('评论与凭证')).not.toBeInTheDocument();
    expect(screen.queryByText('卖家结算')).not.toBeInTheDocument();
    expect(screen.queryByText('文件归档')).not.toBeInTheDocument();
  });

  it('renders page title in content heading', () => {
    const session = staffTestSession('owner', ['SELLER_MANAGE']);
    renderShell(session, '/staff/finance');
    expect(screen.getByRole('heading', { name: '财务' })).toBeInTheDocument();
  });
});

describe('StaffShell duplicate text guards (7R-1)', () => {
  const richPermissions = [
    'STAFF_MANAGE',
    'PERMISSION_MANAGE',
    'FINANCIAL_VIEW',
    'ORDER_VIEW',
    'BUYER_VIEW',
    'SELLER_MANAGE',
  ];

  it('leaves the staff home title to the workbench greeting instead of duplicating it in Shell', () => {
    const session = staffTestSession('owner', richPermissions);
    renderShell(session, '/staff');
    expect(document.querySelector('.sp-page-head')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '工作台' })).not.toBeInTheDocument();
  });

  it('does not repeat identical display name and role text in the session context', () => {
    const session = { ...staffTestSession('owner', richPermissions), display_name: '总管理员' };
    renderShell(session, '/staff');
    const context = screen.getByLabelText('当前会话信息：总管理员（总管理员）');
    // 视觉只显示一次姓名；角色语义保留在 aria-label 中。
    expect(within(context).getAllByText('总管理员')).toHaveLength(1);
    expect(context).toHaveAttribute('aria-label', '当前会话信息：总管理员（总管理员）');
  });

  it('titles the unified order detail shell 订单详情 instead of falling back to 工作台', () => {
    const session = staffTestSession('owner', richPermissions);
    renderShell(session, '/staff/orders/order-77');
    expect(screen.getByRole('heading', { name: '订单详情' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '工作台' })).not.toBeInTheDocument();
    // 面包屑提供订单分区上下文：工作台 / 订单。
    const contentHeading = document.querySelector<HTMLElement>('.sp-page-head')!;
    expect(within(contentHeading).getByRole('link', { name: '工作台' })).toBeInTheDocument();
    expect(within(contentHeading).getByText('订单', { exact: true })).toBeInTheDocument();
    expect(getPageTitleForPath('/staff/orders/order-77', session)).toBe('订单详情');
    expect(getBreadcrumbForPath('/staff/orders/order-77', session)).toEqual([
      { label: '工作台', href: '/staff' },
      { label: '订单', href: '/staff/orders' },
    ]);
  });

  it('never falls other staff routes back to the generic 工作台 title', () => {
    const session = staffTestSession('owner', richPermissions);
    renderShell(session, '/staff/buyer-customers');
    expect(screen.getByRole('heading', { name: '买家客户' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '工作台' })).not.toBeInTheDocument();
    cleanup();
    renderShell(session, '/staff/finance');
    expect(screen.getByRole('heading', { name: '财务' })).toBeInTheDocument();
    cleanup();
    renderShell(session, '/staff/work/work-9');
    expect(screen.getByRole('heading', { name: '工作项' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '工作台' })).not.toBeInTheDocument();
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
    const drawer = screen.getByRole('dialog', { name: '员工导航菜单' });
    expect(drawer).toBeInTheDocument();
    const icon = within(drawer).getByRole('link', { name: '工作台' }).querySelector('.moonwhite-icon');
    expect(icon).toHaveAttribute('data-icon', 'dashboard');
    expect(icon).toHaveAttribute('data-fill', '1');
    expect(icon).toHaveAttribute('data-size', '24');
    expect(icon?.querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24');
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
    const financeLink = within(drawer).getByRole('link', { name: '财务' });
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
