import { useLocation } from 'react-router';
import { StaffAccountsWorkspace } from './access-management/StaffAccountsWorkspace';
import { ServiceChannelsPage } from './access-management/ServiceChannelsPage';

export default function StaffAccessManagementRoutes(): React.JSX.Element {
  const { pathname } = useLocation();
  // Stage 7.5 batch 2: Owner-only company public service channel settings.
  if (pathname.startsWith('/staff/service-channels')) return <ServiceChannelsPage />;
  return <StaffAccountsWorkspace />;
}
