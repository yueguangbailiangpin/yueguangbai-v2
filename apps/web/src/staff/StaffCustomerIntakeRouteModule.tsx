import { useLocation } from 'react-router';
import {
  BuyerCustomersWorkspace,
  SellerCustomersWorkspace,
} from './acquisition/CustomerIntakeWorkspace';

export default function StaffCustomerIntakeRouteModule(): React.JSX.Element {
  const { pathname } = useLocation();
  return pathname.startsWith('/staff/buyer-customers')
    ? <BuyerCustomersWorkspace />
    : <SellerCustomersWorkspace />;
}
