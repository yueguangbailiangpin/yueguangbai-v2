import { useLocation } from 'react-router';
import { StaffShell } from './StaffShell';
import { StaffRouteProvider } from '../routes/IdentityRouteSlots';
import { RouteChunkBoundary } from '../routes/RouteChunkBoundary';
import { StaffWorkbench } from './StaffWorkbench';
import { AcquisitionWorkbench } from './acquisition/AcquisitionWorkbench';

const loadStaffAdminRoutes = () => import('./StaffAdminRouteModule');
const loadStaffSchedulingRoutes = () => import('./StaffSchedulingRouteModule');

export { StaffShell };

export default function StaffPortal(): React.JSX.Element {
  return <StaffRouteProvider page={StaffRoutePage}><StaffShell /></StaffRouteProvider>;
}

export function StaffRoutePage(): React.JSX.Element {
  const { pathname } = useLocation();
  if (pathname.startsWith('/staff/acquisition')) return <AcquisitionWorkbench />;
  if (pathname.startsWith('/staff/admin-business-dashboard')) return <RouteChunkBoundary load={loadStaffAdminRoutes} />;
  if (pathname.startsWith('/staff/products') || /^\/staff\/demands\/[^/]+\/reservations$/u.test(pathname)) return <RouteChunkBoundary load={loadStaffSchedulingRoutes} />;
  return <StaffWorkbench />;
}
