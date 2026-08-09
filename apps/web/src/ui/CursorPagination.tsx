import { isFrontendApiError } from '../api/errors';
import { Alert, Button, RequestIdDisplay } from './primitives';

export function CursorPagination(props: Readonly<{
  hasMore: boolean;
  isLoadingMore: boolean;
  laterError: unknown;
  onLoadMore: () => void;
  onRetry: () => void;
  loadLabel?: string;
  loadingLabel?: string;
  retryLabel?: string;
  errorMessage?: string;
}>): React.JSX.Element | null {
  if (props.laterError) return <div className="cursor-page-recovery">
    <Alert tone="warning">{props.errorMessage ?? '后一页暂时无法读取，已加载内容会继续保留。'}</Alert>
    <RequestIdDisplay requestId={isFrontendApiError(props.laterError)
      ? props.laterError.requestId
      : null} />
    <Button type="button" className="secondary" onClick={props.onRetry}>
      {props.retryLabel ?? '重试这一页'}
    </Button>
  </div>;
  if (!props.hasMore && !props.isLoadingMore) return null;
  return <Button
    type="button"
    className="secondary cursor-more-link"
    loading={props.isLoadingMore}
    loadingLabel={props.loadingLabel ?? '正在加载更多'}
    onClick={props.onLoadMore}
  >{props.loadLabel ?? '加载更多'}</Button>;
}
