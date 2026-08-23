import { Navigate, useLocation } from 'react-router';
import { StaffShell } from './StaffShell';
import { StaffRouteProvider } from '../routes/IdentityRouteSlots';
import { RouteChunkBoundary } from '../routes/RouteChunkBoundary';
import { StaffTaskQueuePage } from './StaffTaskQueuePage';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';

const loadStaffAdminRoutes = () => import('./StaffAdminRouteModule');
const loadStaffSchedulingRoutes = () => import('./StaffSchedulingRouteModule');
const loadStaffAccessManagementRoutes = () => import('./StaffAccessManagementRouteModule');
const loadStaffAcquisitionRoutes = () => import('./StaffAcquisitionRouteModule');
const loadStaffCustomerIntakeRoutes = () => import('./StaffCustomerIntakeRouteModule');
const loadStaffFinanceRoutes = () => import('./StaffFinanceRouteModule');
const loadStaffOrdersRoutes = () => import('./StaffOrdersRouteModule');
const loadStaffWorkItemRoutes = () => import('./StaffWorkItemRouteModule');
const loadStaffOperationsRoutes = () => import('./StaffOperationsRouteModule');

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
  const session = useCurrentStaffSession();
  if (pathname === '/staff' && session.role.code === 'acquisition')
    return <Navigate to="/staff/acquisition" replace />;
  if (pathname.startsWith('/staff/acquisition'))
    return <RouteChunkBoundary load={loadStaffAcquisitionRoutes} />;
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
  if (/^\/staff\/orders\/[^/]+$/u.test(pathname))
    return <RouteChunkBoundary load={loadStaffOrdersRoutes} />;
  // The pre-batch rate center kept both legacy paths reachable without
  // redirects; the finance workspace now owns the page and the legacy paths
  // (including preflight deep links) forward with their query intact.
  if (
    pathname.startsWith('/staff/rate-center') ||
    pathname.startsWith('/staff/seller-principal-rate-policies')
  )
    return <Navigate to={`/staff/finance${search}`} replace />;
  if (pathname.startsWith('/staff/operations'))
    return <RouteChunkBoundary load={loadStaffOperationsRoutes} />;
  if (pathname.startsWith('/staff/work/'))
    return <RouteChunkBoundary load={loadStaffWorkItemRoutes} />;
  return <StaffTaskQueuePage />;
}
