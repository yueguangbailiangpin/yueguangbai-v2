import type { StaffSession } from '../auth/staff/staff-auth-api';
import type { MoonwhiteIconName } from './shared/MoonwhiteIcon';

export type StaffRoleCode = StaffSession['role']['code'];

/** 导航项可见性判定（以后端 session 权威值为准，前端不得放宽） */
export type StaffNavVisibility = (session: StaffSession) => boolean;

const isOwner: StaffNavVisibility = (s) => s.role.code === 'owner';
const isPreSales: StaffNavVisibility = (s) => s.role.code === 'pre_sales';
const isSellerOps: StaffNavVisibility = (s) => s.role.code === 'seller_ops';
const isBuyerRefund: StaffNavVisibility = (s) => s.role.code === 'buyer_refund';

const mayProducts: StaffNavVisibility = (s) => isOwner(s) || isPreSales(s) || isSellerOps(s);

const mayFinance: StaffNavVisibility = (s) =>
  isOwner(s) || (isSellerOps(s) && s.permissions.includes('SELLER_MANAGE'));

const mayRefunds: StaffNavVisibility = (s) => isOwner(s) || isBuyerRefund(s);

const mayBuyerCustomers: StaffNavVisibility = (s) => isOwner(s) || isPreSales(s);
const maySellerCustomers: StaffNavVisibility = (s) => isOwner(s) || isSellerOps(s);

const mayAccessManagement: StaffNavVisibility = (s) =>
  isOwner(s) && s.permissions.includes('STAFF_MANAGE');

const mayDashboard: StaffNavVisibility = (s) =>
  isOwner(s) && s.permissions.includes('FINANCIAL_VIEW');

/**
 * 导航分组标签（Atlassian 式信息架构，7F-1 收口）。
 * 只有真实页面的能力才出现在导航里。
 */
export interface StaffNavSection {
  id: string;
  label: string;
}

/** 二级导航项 */
export interface StaffNavChild {
  id: string;
  label: string;
  icon?: MoonwhiteIconName;
  path: string;
  visible: StaffNavVisibility;
}

/** 一级导航项 */
export interface StaffNavItem {
  id: string;
  label: string;
  icon: MoonwhiteIconName;
  section?: string;
  /** 直接路径（无子项时） */
  path?: string;
  /** 二级子项 */
  children?: readonly StaffNavChild[];
  /** 整组可见性（任一子项可见则显示组） */
  visible?: StaffNavVisibility;
}

/**
 * 员工端导航（7F-1 信息架构收口）。
 * 已退役的“规划中”入口（评论与凭证/卖家结算/文件归档）不再出现：
 * 评论与凭证从订单详情或工作项进入；卖家结算并入财务工作区；
 * 文件归档从订单详情与运营工具触发；客服渠道在系统设置内。
 */
export const STAFF_NAV_ITEMS: readonly StaffNavItem[] = [
  {
    id: 'workbench',
    label: '工作台',
    icon: 'dashboard',
    path: '/staff',
    section: 'work',
  },
  {
    id: 'buyer-customers',
    label: '买家客户',
    icon: 'groups',
    path: '/staff/buyer-customers',
    visible: mayBuyerCustomers,
    section: 'business',
  },
  {
    id: 'seller-customers',
    label: '卖家客户',
    icon: 'storefront',
    path: '/staff/seller-customers',
    visible: maySellerCustomers,
    section: 'business',
  },
  {
    id: 'products',
    label: '产品与预约',
    icon: 'event_available',
    path: '/staff/products',
    visible: mayProducts,
    section: 'business',
  },
  {
    id: 'orders',
    label: '订单',
    icon: 'receipt_long',
    path: '/staff/orders',
    section: 'business',
  },
  {
    id: 'buyer-refunds',
    label: '买家返款',
    icon: 'currency_exchange',
    path: '/staff/refunds',
    visible: mayRefunds,
    section: 'business',
  },
  {
    id: 'finance',
    label: '财务',
    icon: 'account_balance',
    path: '/staff/finance',
    visible: mayFinance,
    section: 'finance',
  },
  {
    id: 'access-management',
    label: '员工与权限',
    icon: 'manage_accounts',
    path: '/staff/access-management',
    visible: mayAccessManagement,
    section: 'admin',
  },
  {
    id: 'system',
    label: '系统设置',
    icon: 'settings',
    children: [
      {
        id: 'admin-dashboard',
        label: '经营看板',
        icon: 'monitoring',
        path: '/staff/admin-business-dashboard',
        visible: mayDashboard,
      },
      {
        id: 'service-channels',
        label: '客服渠道',
        icon: 'support_agent',
        path: '/staff/service-channels',
        visible: mayAccessManagement,
      },
    ],
    section: 'admin',
  },
];

const SECTION_LABELS: Record<string, string> = {
  work: '日常工作',
  business: '业务',
  finance: '财务',
  admin: '管理',
};

export function staffNavSectionLabel(section: string | undefined): string | null {
  return section ? (SECTION_LABELS[section] ?? null) : null;
}

/** 过滤当前角色可见的导航项 */
export function getVisibleNavItems(session: StaffSession): StaffNavItem[] {
  return STAFF_NAV_ITEMS.filter((item) => {
    if (item.visible && !item.visible(session)) return false;
    if (item.children) {
      return item.children.some((child) => child.visible(session));
    }
    return true;
  });
}

/** 获取当前路径对应的面包屑 */
export function getBreadcrumbForPath(
  pathname: string,
  session: StaffSession,
): Array<{ label: string; href?: string }> {
  const crumbs: Array<{ label: string; href?: string }> = [{ label: '工作台', href: '/staff' }];

  if (/^\/staff\/orders(\/|$)/u.test(pathname)) {
    if (pathname !== '/staff/orders') crumbs.push({ label: '订单', href: '/staff/orders' });
    return crumbs;
  }

  for (const item of getVisibleNavItems(session)) {
    if (item.path && pathname.startsWith(item.path) && item.path !== '/staff') {
      crumbs.push({ label: item.label });
      return crumbs;
    }
    if (item.children) {
      for (const child of item.children) {
        if (!child.visible(session)) continue;
        if (pathname.startsWith(child.path)) {
          crumbs.push({ label: item.label });
          crumbs.push({ label: child.label });
          return crumbs;
        }
      }
    }
  }

  // 工作台子路径
  if (pathname.startsWith('/staff/work/')) {
    crumbs.push({ label: '工作项' });
  }
  return crumbs;
}

/** 获取当前路径对应的页面标题 */
export function getPageTitleForPath(pathname: string, session: StaffSession): string {
  if (/^\/staff\/orders\/[^/]+$/u.test(pathname)) return '订单详情';
  if (/^\/staff\/orders/u.test(pathname)) return '订单';
  for (const item of getVisibleNavItems(session)) {
    if (item.path && pathname.startsWith(item.path) && item.path !== '/staff') {
      return item.label;
    }
    if (item.children) {
      for (const child of item.children) {
        if (!child.visible(session)) continue;
        if (pathname.startsWith(child.path)) return child.label;
      }
    }
  }
  if (pathname.startsWith('/staff/work/')) return '工作项';
  return '工作台';
}

/** Marketplace scope 显示文本 */
export function formatMarketplaceScope(session: StaffSession): string {
  if (session.data_scope.type === 'GLOBAL') return '全部站点';
  const labels: Record<string, string> = {
    AMAZON_JP: '亚马逊日本',
    AMAZON_US: '亚马逊美国',
    COUPANG_KR: 'Coupang 韩国',
  };
  const codes = session.data_scope.marketplaceCodes;
  if (!codes || codes.length === 0) return '未配置站点';
  return codes.map((c) => labels[c] ?? c).join(' · ');
}
