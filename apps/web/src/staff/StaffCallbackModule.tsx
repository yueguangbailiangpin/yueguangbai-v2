import { StaffShell } from './StaffShell';
import { StaffRoutePage } from './StaffRouteModule';

export default function StaffCallbackModule(): React.JSX.Element {
  return <StaffShell><StaffRoutePage /></StaffShell>;
}
