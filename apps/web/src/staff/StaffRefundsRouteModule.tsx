import { useLocation } from 'react-router';
import { StaffRefundDetailPage } from './refunds/StaffRefundDetailPage';
import { StaffRefundsPage } from './refunds/StaffRefundsPage';

export default function StaffRefundsRoute(): React.JSX.Element {
  const { pathname } = useLocation();
  return /^\/staff\/refunds\/[^/]+$/u.test(pathname) ? (
    <StaffRefundDetailPage />
  ) : (
    <StaffRefundsPage />
  );
}
