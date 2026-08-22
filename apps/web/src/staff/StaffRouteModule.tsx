import { Navigate, useLocation } from 'react-router';
import { StaffShell } from './StaffShell';
import { StaffRouteProvider } from '../routes/IdentityRouteSlots';
import { RouteChunkBoundary } from '../routes/RouteChunkBoundary';
import { StaffTaskQueuePage } from './StaffTaskQueuePage';
import { WorkItemPage } from './work-panels/WorkItemPage';
import { StaffOperatingIntegrityTools } from './StaffOperatingIntegrityTools';
import { AcquisitionCoreWorkbench } from './acquisition/AcquisitionCoreWorkbench';
import {
  BuyerCustomersWorkspace,
  SellerCustomersWorkspace,
} from './acquisition/CustomerIntakeWorkspace';
import { SellerPrincipalRatePolicyWorkspace } from './pricing/SellerPrincipalRatePolicyWorkspace';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';

const loadStaffAdminRoutes = () => import('./StaffAdminRouteModule');
const loadStaffSchedulingRoutes = () => import('./StaffSchedulingRouteModule');
const loadStaffAccessManagementRoutes = () => import('./StaffAccessManagementRouteModule');

export { StaffShell };

export default function StaffPortal(): React.JSX.Element {
  return (
    <StaffRouteProvider page={StaffRoutePage}>
      <StaffShell />
    </StaffRouteProvider>
  );
}

export function StaffRoutePage(): React.JSX.Element {
  const { pathname } = useLocation();
  const session = useCurrentStaffSession();
  if (pathname === '/staff' && session.role.code === 'acquisition')
    return <Navigate to="/staff/acquisition" replace />;
  if (pathname.startsWith('/staff/acquisition')) return <AcquisitionCoreWorkbench />;
  if (pathname.startsWith('/staff/buyer-customers')) return <BuyerCustomersWorkspace />;
  if (pathname.startsWith('/staff/seller-customers')) return <SellerCustomersWorkspace />;
  if (pathname.startsWith('/staff/admin-business-dashboard'))
    return <RouteChunkBoundary load={loadStaffAdminRoutes} />;
  if (pathname.startsWith('/staff/access-management'))
    return <RouteChunkBoundary load={loadStaffAccessManagementRoutes} />;
  if (
    pathname.startsWith('/staff/products') ||
    /^\/staff\/demands\/[^/]+\/reservations$/u.test(pathname)
  )
    return <RouteChunkBoundary load={loadStaffSchedulingRoutes} />;
  if (
    pathname.startsWith('/staff/rate-center') ||
    pathname.startsWith('/staff/seller-principal-rate-policies')
  )
    return <SellerPrincipalRatePolicyWorkspace />;
  if (pathname.startsWith('/staff/operations')) return <StaffOperatingIntegrityTools />;
  if (pathname.startsWith('/staff/work/')) return <WorkItemPage />;
  return <StaffTaskQueuePage />;
}
