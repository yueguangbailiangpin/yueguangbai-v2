import { isFrontendApiError } from '../../api/errors';
import { EmptyState, ErrorState } from '../../ui/primitives';

export function BuyerLoading({ label = '正在加载' }: { label?: string }): React.JSX.Element {
  return <div className="buyer-loading" role="status" aria-live="polite">
    <span className="buyer-loading-mark" aria-hidden="true" />{label}
  </div>;
}

export function BuyerQueryError({ error, title = '暂时无法读取内容' }: {
  error: unknown;
  title?: string;
}): React.JSX.Element {
  return <ErrorState
    title={title}
    description={safeMessage(error)}
    requestId={isFrontendApiError(error) ? error.requestId : null}
  />;
}

export function BuyerEmpty({ title, description }: {
  title: string;
  description: string;
}): React.JSX.Element {
  return <EmptyState title={title} description={description} />;
}

function safeMessage(error: unknown): string {
  if (!isFrontendApiError(error)) return '请稍后重试。';
  if (error.httpStatus === 403) return '当前账号没有查看这项内容的权限。';
  if (error.httpStatus === 404) return '内容不存在，或当前账号不能查看。';
  if (error.httpStatus === 409) return '页面事实已经变化，请刷新后重试。';
  if (error.httpStatus === 429) return '操作过于频繁，请稍后再试。';
  if (error.httpStatus === 503) return '服务暂时不可用，请稍后重试。';
  return '请稍后重试。';
}
