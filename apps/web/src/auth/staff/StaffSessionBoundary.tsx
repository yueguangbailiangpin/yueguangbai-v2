import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Button, DependencyUnavailable, LoadingState, RequestIdDisplay } from '../../ui/primitives';
import { useStaffSession } from '../session';
import { staffAuthApi, type StaffAuthApiAdapter, type StaffSession } from './staff-auth-api';

const StaffSessionContext = createContext<StaffSession | null>(null);

export function useCurrentStaffSession(): StaffSession {
  const session = useContext(StaffSessionContext);
  if (!session) throw new Error('staff_session_context_unavailable');
  return session;
}

export function StaffSessionBoundary({
  adapter = staffAuthApi,
  children,
}: {
  adapter?: StaffAuthApiAdapter;
  children: ReactNode;
}) {
  const session = useStaffSession(adapter);
  const location = useLocation();
  if (session.status === 'LOADING') {
    return <main className="centered"><LoadingState label="正在确认登录状态" /></main>;
  }
  if (session.status === 'DEPENDENCY_ERROR' && session.cleanupFailed) {
    return (
      <main className="centered">
        <section className="state" role="alert">
          <h2>会话清理失败，请重试或刷新</h2>
          <p>为保护账号，当前页面不会显示员工业务内容。</p>
          <RequestIdDisplay requestId={session.requestId} />
          <Button type="button" onClick={session.retry}>重新清理</Button>
        </section>
      </main>
    );
  }
  if (session.status === 'DEPENDENCY_ERROR') {
    return (
      <main className="centered">
        <div>
          <DependencyUnavailable requestId={session.requestId} />
          <Button type="button" onClick={session.retry}>重试</Button>
        </div>
      </main>
    );
  }
  if (session.status === 'UNAUTHENTICATED') {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/staff/login?return_to=${returnTo}`} replace />;
  }
  return <StaffSessionContext.Provider value={session.value}>
    {children}
  </StaffSessionContext.Provider>;
}
