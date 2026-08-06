import {
  ClipboardList,
  FolderOpen,
  Home,
  MessageSquareText,
  UserRound,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { BottomNavigation, IdentityShell } from '../../ui/primitives';

export const BUYER_NAVIGATION = Object.freeze([
  { path: '/buyer', label: '首页', icon: Home, end: true },
  { path: '/buyer/tasks', label: '任务', icon: ClipboardList, end: false },
  { path: '/buyer/order-materials', label: '订单资料', icon: FolderOpen, end: false },
  { path: '/buyer/reviews', label: '评论', icon: MessageSquareText, end: false },
  { path: '/buyer/me', label: '我的', icon: UserRound, end: false },
] as const);

export function BuyerLayout(): React.JSX.Element {
  return <IdentityShell identity="buyer" className="buyer-shell buyer-business-shell">
    <header className="buyer-brand-bar"><strong>月光白</strong><span>买家服务</span></header>
    <main className="buyer-main"><Outlet /></main>
    <BottomNavigation label="买家导航">{BUYER_NAVIGATION.map((item) => {
      const Icon = item.icon;
      return <NavLink key={item.path} to={item.path} end={item.end}>
        <Icon aria-hidden="true" /><span>{item.label}</span>
      </NavLink>;
    })}</BottomNavigation>
  </IdentityShell>;
}
