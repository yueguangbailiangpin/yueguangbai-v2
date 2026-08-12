import { isFrontendApiError } from '../../api/errors';
import { Button, RequestIdDisplay } from '../../ui/primitives';

export function StaffPanelError({
  error,
  retry,
  retryLabel = '重试',
}: {
  error: unknown;
  retry: () => void;
  retryLabel?: string;
}): React.JSX.Element {
  const requestId = isFrontendApiError(error) ? error.requestId : null;
  const hidden = isFrontendApiError(error) && error.httpStatus === 404;
  return <div role="alert" className="state">
    <h3>{hidden ? '资源不存在或无权访问' : '当前面板加载失败'}</h3>
    <p>{hidden ? '为保护客户与组织信息，系统不会透露范围外资源。' : '其他面板仍可继续使用，可重试。'}</p>
    <RequestIdDisplay requestId={requestId} />
    <Button className="secondary" onClick={retry}>{retryLabel}</Button>
  </div>;
}
