import { isFrontendApiError } from '../../api/errors';
import { Alert, Button, RequestIdDisplay } from '../../ui/primitives';

export function BuyerPagination(props: Readonly<{
  hasMore: boolean;
  isLoadingMore: boolean;
  laterError: unknown;
  onLoadMore: () => void;
  onRetry: () => void;
}>): React.JSX.Element | null {
  if (props.laterError) return <div className="buyer-page-recovery">
    <Alert tone="warning">后一页暂时无法读取，已加载内容会继续保留。</Alert>
    <RequestIdDisplay requestId={isFrontendApiError(props.laterError) ? props.laterError.requestId : null} />
    <Button className="secondary" onClick={props.onRetry}>重试这一页</Button>
  </div>;
  if (!props.hasMore && !props.isLoadingMore) return null;
  return <Button className="secondary buyer-more-link" loading={props.isLoadingMore}
    loadingLabel="正在加载更多" onClick={props.onLoadMore}>加载更多</Button>;
}
