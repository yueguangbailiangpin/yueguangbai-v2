import { Alert, Button, RequestIdDisplay } from '../../ui/primitives';
import type { BuyerMutationSnapshot } from '../mutations/BuyerMutationController';

export function BuyerMutationRecovery(props: Readonly<{
  mutation: Pick<BuyerMutationSnapshot, 'recovery' | 'requestId'> & Readonly<{ retrySame: () => void }>;
  deterministicMessage?: string;
  onRefresh?: () => void;
}>): React.JSX.Element | null {
  if (props.mutation.recovery === 'NONE') return null;
  if (props.mutation.recovery === 'RETRY_SAME_OPERATION') return <div className="buyer-page-recovery">
    <Alert tone="warning">结果暂时无法确认。重试会使用完全相同的操作标识和内容。</Alert>
    <RequestIdDisplay requestId={props.mutation.requestId} />
    <Button className="secondary" onClick={props.mutation.retrySame}>重新尝试同一操作</Button>
  </div>;
  return <div className="buyer-page-recovery">
    <Alert tone="danger">{props.deterministicMessage ?? '页面事实可能已经变化，请刷新事实后重新提交。'}</Alert>
    <RequestIdDisplay requestId={props.mutation.requestId} />
    {props.onRefresh ? <Button className="secondary" onClick={props.onRefresh}>刷新事实</Button> : null}
  </div>;
}
