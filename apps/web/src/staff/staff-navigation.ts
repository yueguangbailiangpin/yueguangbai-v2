import type { LucideIcon } from 'lucide-react';
import {
  BriefcaseBusiness,
  UsersRound,
  PackageSearch,
  ClipboardList,
  MessageSquareText,
  CircleDollarSign,
  Landmark,
  Wallet,
  Archive,
  UserCog,
  Settings,
  Store,
  UserRound,
  Wrench,
  ChartNoAxesCombined,
} from 'lucide-react';
import type { StaffSession } from '../auth/staff/staff-auth-api';

export type StaffRoleCode = StaffSession['role']['code'];

/** 导航项可见性判定 */
export type StaffNavVisibility = (session: StaffSession) => boolean;

const isOwner: StaffNavVisibility = (s) => s.role.code === 'owner';
const isPreSales: StaffNavVisibility = (s) => s.role.code === 'pre_sales';
const isSellerOps: StaffNavVisibility = (s) => s.role.code === 'seller_ops';
const isBuyerRefund: StaffNavVisibility = (s) => s.role.code === 'buyer_refund';

const mayProducts: StaffNavVisibility = (s) =>
  isOwner(s) || isPreSales(s) || isSellerOps(s);

const mayOperations: StaffNavVisibility = (s) =>
  isOwner(s) || isSellerOps(s) || isPreSales(s) || isBuyerRefund(s);

const mayFinance: StaffNavVisibility = (s) =>
  isOwner(s) || (isSellerOps(s) && s.permissions.includes('SELLER_MANAGE'));

const mayRefunds: StaffNavVisibility = (s) => isOwner(s) || isBuyerRefund(s);

const mayBuyerCustomers: StaffNavVisibility = (s) => isOwner(s) || isPreSales(s);
const maySellerCustomers: StaffNavVisibility = (s) => isOwner(s) || isSellerOps(s);

const mayAccessManagement: StaffNavVisibility = (s) =>
  isOwner(s) && s.permissions.includes('STAFF_MANAGE');

const mayDashboard: StaffNavVisibility = (s) =>
  isOwner(s) && s.permissions.includes('FINANCIAL_VIEW');


/** 二级导航项 */
export interface StaffNavChild {
  id: string;
  label: string;
  icon?: LucideIcon;
  path: string;
  visible: StaffNavVisibility;
  /** 标记为规划中（无真实页面，不创建假链接） */
  upcoming?: boolean;
}

/** 一级导航项 */
export interface StaffNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** 直接路径（无子项时） */
  path?: string;
  /** 二级子项 */
  children?: readonly StaffNavChild[];
  /** 整组可见性（任一子项可见则显示组） */
  visible?: StaffNavVisibility;
  /** 标记为规划中 */
  upcoming?: boolean;
}

/**
 * 员工端一级导航（11 项，阶段 7A-1 信息架构）。
 * 不存在真实页面的功能标记为 upcoming，不创建假页面。
 */
export const STAFF_NAV_ITEMS: readonly StaffNavItem[] = [
  {
    id: 'workbench',
    label: '工作台',
    icon: BriefcaseBusiness,
    path: '/staff',
    // D-056: the acquisition workspace is retired.
  },
  {
    id: 'customers',
    label: '客户',
    icon: UsersRound,
    children: [
      {
        id: 'buyer-customers',
        label: '买家',
        icon: UserRound,
        path: '/staff/buyer-customers',
        visible: mayBuyerCustomers,
      },
      {
        id: 'seller-customers',
        label: '卖家',
        icon: Store,
        path: '/staff/seller-customers',
        visible: maySellerCustomers,
      },
    ],
  },
  {
    id: 'products',
    label: '产品与预约',
    icon: PackageSearch,
    path: '/staff/products',
    visible: mayProducts,
  },
  {
    id: 'orders',
    label: '订单',
    icon: ClipboardList,
    upcoming: true,
    // 订单详情 /staff/orders/:orderId 存在，但无列表页；
    // 通过全局搜索和工作台进入，本阶段不创建假列表。
  },
  {
    id: 'reviews-evidence',
    label: '评论与凭证',
    icon: MessageSquareText,
    upcoming: true,
    // 评论审核通过工作台 work item 进入，无独立列表页。
  },
  {
    id: 'buyer-refunds',
    label: '买家返款',
    icon: CircleDollarSign,
    path: '/staff/refunds',
    visible: mayRefunds,
  },
  {
    id: 'seller-settlements',
    label: '卖家结算',
    icon: Wallet,
    upcoming: true,
    // 卖家结算通过 /staff/finance 中的卖家组织维度查看，无独立列表页。
  },
  {
    id: 'finance',
    label: '财务',
    icon: Landmark,
    path: '/staff/finance',
    visible: mayFinance,
  },
  {
    id: 'archive',
    label: '文件归档',
    icon: Archive,
    upcoming: true,
    // 归档操作通过运营工具和订单详情触发，无独立前端页面。
  },
  {
    id: 'access-management',
    label: '员工与权限',
    icon: UserCog,
    path: '/staff/access-management',
    visible: mayAccessManagement,
  },
  {
    id: 'system',
    label: '系统设置',
    icon: Settings,
    children: [
      {
        id: 'admin-dashboard',
        label: '经营看板',
        icon: ChartNoAxesCombined,
        path: '/staff/admin-business-dashboard',
        visible: mayDashboard,
      },
      {
        id: 'operations',
        label: '运行完整性工具',
        icon: Wrench,
        path: '/staff/operations',
        visible: mayOperations,
      },
    ],
  },
];

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
  if (pathname === '/staff' || pathname === '/staff/queue') return '工作台';
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
