import { useLocation } from 'react-router';
import { StaffOrderDetailPage } from './orders/StaffOrderDetailPage';
import { StaffOrderListPage } from './orders/StaffOrderListPage';

export default function StaffOrdersRoutes(): React.JSX.Element {
  const { pathname } = useLocation();
  // Stage 7.5 batch 1: /staff/orders is the cursor list; /staff/orders/:id
  // stays on the unified order detail.
  if (/^\/staff\/orders\/[^/]+$/u.test(pathname)) return <StaffOrderDetailPage />;
  return <StaffOrderListPage />;
}
