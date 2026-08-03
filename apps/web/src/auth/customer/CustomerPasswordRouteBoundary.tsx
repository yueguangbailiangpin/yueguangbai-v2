import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, DependencyUnavailable, LoadingState, RequestIdDisplay } from '../../ui/primitives';
import { customerAuthApi, type CustomerAuthApiAdapter, type CustomerTarget } from './customer-auth-api';
import { useCustomerPasswordRouteController } from './customer-password-route-controller';

export function CustomerPasswordRouteBoundary({
  target,
  adapter = customerAuthApi,
  children,
}: {
  target: CustomerTarget;
  adapter?: CustomerAuthApiAdapter;
  children: ReactNode;
}) {
  const route = useCustomerPasswordRouteController(target, adapter);

  if (route.status === 'LOADING' || route.status === 'MISMATCH_CLEANING') {
    return <main className="centered"><LoadingState label="正在确认登录状态" /></main>;
  }
  if (route.status === 'UNAUTHENTICATED') {
    return <Navigate to={`/${target}/login`} replace />;
  }
  if (route.status === 'MISMATCH_CLEANUP_FAILED') {
    return (
      <main className="centered">
        <section className="state" role="alert">
          <h2>会话清理失败，请重试或刷新</h2>
          <p>为保护账号，当前页面不会显示修改密码表单。</p>
          <RequestIdDisplay requestId={route.requestId} />
          <Button type="button" onClick={route.retry}>重新清理</Button>
        </section>
      </main>
    );
  }
  if (route.status === 'DEPENDENCY_ERROR') {
    return (
      <main className="centered">
        <div>
          <DependencyUnavailable />
          <RequestIdDisplay requestId={route.requestId} />
          <Button type="button" onClick={route.retry}>重试</Button>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
