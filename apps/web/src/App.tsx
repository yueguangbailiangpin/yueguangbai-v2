import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { queryClient } from './api/query-client';
import { startOperation } from './api/idempotency';
import { staffLogoutAllResponseSchema, staffLogoutResponseSchema } from './auth/staff/staff-logout-schemas';
import { apiRequest } from './api/transport';
import { isFrontendApiError } from './api/errors';
import { clearStaffTransport } from './auth/customer-transport-invalidation';
import { useStaffSession } from './auth/session';
import { CustomerLoginPage } from './auth/customer/CustomerLoginPage';
import { CustomerChangePasswordPage } from './auth/customer/CustomerChangePasswordPage';
import { CustomerSessionBoundary } from './auth/customer/CustomerSessionBoundary';
import { safeReturnPath } from './routes/return-path';
import { runtimeConfig } from './config/runtime-config';
import { Button, Card, DependencyUnavailable, Dialog, Drawer, ErrorState, LoadingState, NotFound, PageHeader, PermissionDenied, RequestIdDisplay } from './ui/primitives';

const staffStartSchema = z.object({ provider: z.literal('FEISHU'), authorization_url: z.string().url(), expires_at: z.number().int() }).strict();

export function RootEntry() {
  return <main className="identity-entry"><Card><p className="eyebrow">专属链接提示</p><h1>月光白</h1><p>请使用工作人员发送的专属链接登录。</p></Card></main>;
}

function StaffProtected({ children }: { children: ReactNode }) {
  const session = useStaffSession();
  const location = useLocation();
  if (session.status === 'LOADING') return <main className="centered"><LoadingState label="正在确认登录状态" /></main>;
  if (session.status === 'DEPENDENCY_ERROR') return <main className="centered"><DependencyUnavailable /></main>;
  if (session.status === 'UNAUTHENTICATED') return <Navigate to={`/staff/login?return_to=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function StaffLogin() {
  const navigate = useNavigate(); const location = useLocation(); const [message, setMessage] = useState<string | null>(null);
  async function start(): Promise<void> {
    const returnTo = safeReturnPath(new URLSearchParams(location.search).get('return_to'), 'staff');
    try {
      const result = (await apiRequest({ path: '/api/staff-auth/login/start', method: 'POST', schema: staffStartSchema, body: { return_to: returnTo } })).data;
      const url = new URL(result.authorization_url);
      if (url.protocol !== 'https:' || url.origin !== runtimeConfig().staffProviderOrigin) throw new Error('unsafe_provider_url');
      window.location.assign(url.toString());
    } catch { setMessage('暂时无法开始员工登录，请稍后重试。'); }
  }
  return <main className="login-page"><Card><h1>员工登录</h1><p>将跳转到受信任的身份提供方完成验证。</p>{message && <p className="inline-error" role="alert">{message}</p>}<Button onClick={() => { void start(); }}>继续登录</Button><Button className="secondary" onClick={() => navigate('/')}>返回入口</Button></Card></main>;
}


function StaffAccountActions() {
  const client = useQueryClient(); const navigate = useNavigate(); const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null); const [requestId, setRequestId] = useState<string | null>(null); const operation = useRef<ReturnType<typeof startOperation<{}>> | null>(null);
  async function finishLogout(path: '/api/staff-auth/logout' | '/api/staff-auth/logout-all', all: boolean): Promise<void> { setBusy(true); setMessage(null); try { const current = all ? (operation.current ?? (operation.current = startOperation({}))) : null; const response = await apiRequest({ path, method: 'POST', schema: all ? staffLogoutAllResponseSchema : staffLogoutResponseSchema, ...(all ? { body: {}, headers: { 'Idempotency-Key': current?.key ?? '' } } : {}) }); setRequestId(response.requestId); await clearStaffTransport(client); operation.current = null; navigate('/staff/login', { replace: true }); } catch (error: unknown) { if (isFrontendApiError(error)) { setRequestId(error.requestId); if (error.httpStatus === 401) { await clearStaffTransport(client); operation.current = null; navigate('/staff/login', { replace: true }); return; } if (error.code === 'IDEMPOTENCY_CONFLICT') operation.current = null; setMessage(error.code === 'IDEMPOTENCY_CONFLICT' ? '该操作发生冲突，请结束后重新发起。' : error.code === 'REQUEST_IN_PROGRESS' ? '操作正在处理中，请勿重复提交。' : '退出未完成，请由您决定是否重试。'); } else setMessage('退出未完成，请由您决定是否重试。'); } finally { setBusy(false); } }
  const cancel = (): void => { if (!busy) { operation.current = null; setConfirming(false); setMessage(null); } };
  return <section className="staff-account-actions" aria-label="账户操作"><Button className="secondary" disabled={busy} onClick={() => { void finishLogout('/api/staff-auth/logout', false); }}>退出登录</Button><Button className="danger" disabled={busy} onClick={() => setConfirming(true)}>退出所有设备</Button>{message && <p className="inline-error" role="alert">{message}</p>}<RequestIdDisplay requestId={requestId} /><Dialog open={confirming} title="退出所有设备" description="这会使其他设备上的员工会话失效。" busy={busy} onClose={cancel}><div className="entry-actions"><Button className="secondary" disabled={busy} onClick={cancel}>取消</Button><Button className="danger" disabled={busy} onClick={() => { void finishLogout('/api/staff-auth/logout-all', true); }}>{busy ? '正在退出' : '确认退出所有设备'}</Button></div></Dialog></section>;
}

const buyerItems = [['/', '首页'], ['/tasks', '任务'], ['/order-materials', '订单资料'], ['/reviews', '评论'], ['/me', '我的']] as const;
function BuyerShell() { const location = useLocation(); return <main className="buyer-shell"><PageHeader title="月光白"><p>买家服务基础</p></PageHeader><section className="placeholder"><h2>{buyerItems.find(([path]) => location.pathname === `/buyer${path}`)?.[1] ?? '买家'}</h2><p>该功能将在买家业务模块开放。</p></section><nav className="bottom-nav" aria-label="买家导航">{buyerItems.map(([path, label]) => <NavLink key={path} to={`/buyer${path}`} end={path === '/'}>{label}</NavLink>)}</nav></main>; }

const sellerItems = ['概览', '商品', '需求', '订单', '评论', '结算', '设置'] as const;
function SellerShell() { const [drawer, setDrawer] = useState(false); return <main className="work-shell seller-shell"><aside className="sidebar"><strong>月光白</strong><nav aria-label="卖家导航">{sellerItems.map((item) => <a href="#foundation" key={item}>{item}</a>)}</nav></aside><section className="work-content"><header className="context"><span>组织与店铺</span><small>基础上下文将在业务模块开放</small></header><PageHeader title="卖家工作台"><Button onClick={() => setDrawer(true)}>查看详情结构</Button></PageHeader><section id="foundation" className="foundation-grid"><Card><h2>内容区域</h2><p>该功能将在卖家业务模块开放。</p></Card><Card><h2>筛选与表格</h2><div className="table-wrap"><table><caption>基础数据容器</caption><thead><tr><th>状态</th><th>说明</th></tr></thead><tbody><tr><td>基础</td><td>尚无业务数据</td></tr></tbody></table></div></Card></section></section><Drawer open={drawer} title="详情结构" onClose={() => setDrawer(false)}><p>关闭后会回到原有筛选、分页与滚动位置。</p></Drawer></main>; }

function StaffShell() { const [drawer, setDrawer] = useState(false); return <main className="staff-shell"><PageHeader title="员工工作台"><Button onClick={() => setDrawer(true)}>打开操作区</Button></PageHeader><section className="staff-panes"><section aria-labelledby="queue"><h2 id="queue">待处理队列</h2><p>队列结构将在员工业务模块开放。</p></section><section aria-labelledby="detail"><h2 id="detail">详情</h2><p>客户可见内容与内部内容将在正式流程中区分。</p><div className="internal-note">内部内容区（示例）</div></section><section aria-labelledby="actions"><h2 id="actions">操作区</h2><StaffAccountActions /><div className="sensitive-action">财务敏感操作（示例）</div></section></section><Drawer open={drawer} title="操作区" onClose={() => setDrawer(false)}><p>小屏幕使用顺序操作区，不执行真实业务命令。</p></Drawer></main>; }

function DomainNotFound() { return <main className="centered"><NotFound /></main>; }
function AppRoutes() { return <Routes><Route path="/" element={<RootEntry />} /><Route path="/buyer/login" element={<CustomerLoginPage target="buyer" />} /><Route path="/seller/login" element={<CustomerLoginPage target="seller" />} /><Route path="/buyer/change-password" element={<CustomerChangePasswordPage target="buyer" />} /><Route path="/seller/change-password" element={<CustomerChangePasswordPage target="seller" />} /><Route path="/staff/login" element={<StaffLogin />} /><Route path="/staff/auth/callback" element={<StaffProtected><StaffShell /></StaffProtected>} /><Route path="/buyer/*" element={<CustomerSessionBoundary target="buyer"><Routes><Route index element={<BuyerShell />} /><Route path="tasks" element={<BuyerShell />} /><Route path="order-materials" element={<BuyerShell />} /><Route path="reviews" element={<BuyerShell />} /><Route path="me" element={<BuyerShell />} /><Route path="*" element={<DomainNotFound />} /></Routes></CustomerSessionBoundary>} /><Route path="/seller/*" element={<CustomerSessionBoundary target="seller"><Routes><Route index element={<SellerShell />} /><Route path="products" element={<SellerShell />} /><Route path="demands" element={<SellerShell />} /><Route path="orders" element={<SellerShell />} /><Route path="reviews" element={<SellerShell />} /><Route path="settlements" element={<SellerShell />} /><Route path="settings" element={<SellerShell />} /><Route path="*" element={<DomainNotFound />} /></Routes></CustomerSessionBoundary>} /><Route path="/staff/*" element={<StaffProtected><Routes><Route index element={<StaffShell />} /><Route path="queue" element={<StaffShell />} /><Route path="work/:workItemId" element={<StaffShell />} /><Route path="*" element={<DomainNotFound />} /></Routes></StaffProtected>} /><Route path="/forbidden" element={<PermissionDenied />} /><Route path="/dependency-error" element={<ErrorState title="服务暂时不可用" requestId="local-request" />} /><Route path="*" element={<DomainNotFound />} /></Routes>; }

export function App() { return <QueryClientProvider client={queryClient}><BrowserRouter><AppRoutes /></BrowserRouter></QueryClientProvider>; }
