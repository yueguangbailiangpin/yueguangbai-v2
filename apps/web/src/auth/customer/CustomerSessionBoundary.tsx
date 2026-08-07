import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Button, DependencyUnavailable, LoadingState, RequestIdDisplay } from '../../ui/primitives';
import { customerAuthApi, type CustomerAuthApiAdapter, type CustomerTarget } from './customer-auth-api';
import { useCustomerSessionController } from './customer-session-controller';

export function CustomerSessionBoundary({
  target,
  adapter = customerAuthApi,
  children,
}: {
  target: CustomerTarget;
  adapter?: CustomerAuthApiAdapter;
  children: ReactNode;
}) {
  const session = useCustomerSessionController(target, adapter);
  const location = useLocation();
  if (session.status === 'LOADING') {
    return <main className="centered"><LoadingState label="正在确认登录状态" /></main>;
  }
  if (session.status === 'DEPENDENCY_ERROR' && session.cleanupFailed) {
    return (
      <main className="centered">
        <section className="state" role="alert">
          <h2>会话清理失败，请重试或刷新</h2>
          <p>为保护账号，当前页面不会显示客户业务内容。</p>
          <RequestIdDisplay requestId={session.requestId} />
          <Button type="button" onClick={session.retry}>重新清理</Button>
        </section>
      </main>
    );
  }
  if (session.status === 'DEPENDENCY_ERROR') {
    return <main className="centered"><DependencyUnavailable requestId={session.requestId} /></main>;
  }
  if (session.status === 'UNAUTHENTICATED') {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/${target}/login?return_to=${returnTo}`} replace />;
  }
  if (session.value.password_change_required) {
    return <Navigate to={`/${target}/change-password`} replace />;
  }
  return <>{children}</>;
}
