import { Navigate, useLocation } from 'react-router';
import { StaffShell } from './StaffShell';
import { StaffRouteProvider } from '../routes/IdentityRouteSlots';
import { RouteChunkBoundary } from '../routes/RouteChunkBoundary';
import { StaffTaskQueuePage } from './StaffTaskQueuePage';

const loadStaffAdminRoutes = () => import('./StaffAdminRouteModule');
const loadStaffSchedulingRoutes = () => import('./StaffSchedulingRouteModule');
const loadStaffAccessManagementRoutes = () => import('./StaffAccessManagementRouteModule');
const loadStaffCustomerIntakeRoutes = () => import('./StaffCustomerIntakeRouteModule');
const loadStaffFinanceRoutes = () => import('./StaffFinanceRouteModule');
const loadStaffOrdersRoutes = () => import('./StaffOrdersRouteModule');
const loadStaffRefundsRoutes = () => import('./StaffRefundsRouteModule');
const loadStaffWorkItemRoutes = () => import('./StaffWorkItemRouteModule');

export { StaffShell };

export default function StaffPortal(): React.JSX.Element {
  return (
    <StaffRouteProvider page={StaffRoutePage}>
      <StaffShell />
    </StaffRouteProvider>
  );
}

export function StaffRoutePage(): React.JSX.Element {
  const { pathname, search } = useLocation();
  if (
    pathname.startsWith('/staff/buyer-customers') ||
    pathname.startsWith('/staff/seller-customers')
  )
    return <RouteChunkBoundary load={loadStaffCustomerIntakeRoutes} />;
  if (pathname.startsWith('/staff/admin-business-dashboard'))
    return <RouteChunkBoundary load={loadStaffAdminRoutes} />;
  if (pathname.startsWith('/staff/access-management'))
    return <RouteChunkBoundary load={loadStaffAccessManagementRoutes} />;
  if (
    pathname.startsWith('/staff/products') ||
    /^\/staff\/demands\/[^/]+\/reservations$/u.test(pathname)
  )
    return <RouteChunkBoundary load={loadStaffSchedulingRoutes} />;
  if (pathname.startsWith('/staff/finance'))
    return <RouteChunkBoundary load={loadStaffFinanceRoutes} />;
  if (pathname === '/staff/orders' || /^\/staff\/orders\/[^/]+$/u.test(pathname))
    return <RouteChunkBoundary load={loadStaffOrdersRoutes} />;
  if (pathname.startsWith('/staff/refunds'))
    return <RouteChunkBoundary load={loadStaffRefundsRoutes} />;
  // The pre-batch rate center kept both legacy paths reachable without
  // redirects; the finance workspace now owns the page and the legacy paths
  // (including preflight deep links) forward with their query intact.
  if (
    pathname.startsWith('/staff/rate-center') ||
    pathname.startsWith('/staff/seller-principal-rate-policies')
  )
    return <Navigate to={`/staff/finance${search}`} replace />;
  // D-056 §4.5：独立订单完整性工具页退役，订单操作并入统一订单详情；
  // 旧书签重定向到工作台。
  if (pathname.startsWith('/staff/operations'))
    return <Navigate to="/staff" replace />;
  if (pathname.startsWith('/staff/work/'))
    return <RouteChunkBoundary load={loadStaffWorkItemRoutes} />;
  return <StaffTaskQueuePage />;
}
