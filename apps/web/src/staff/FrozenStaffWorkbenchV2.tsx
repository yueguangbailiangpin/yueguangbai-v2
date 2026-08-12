import { FrozenStaffWorkbench } from './FrozenStaffWorkbench';
import { StaffOperatingIntegrityTools } from './StaffOperatingIntegrityTools';
import { StaffWorkflowClosurePanel } from './StaffWorkflowClosurePanel';

export function FrozenStaffWorkbenchV2():React.JSX.Element{
  return <><FrozenStaffWorkbench/><StaffWorkflowClosurePanel/><StaffOperatingIntegrityTools/></>;
}