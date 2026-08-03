import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { queryClient, queryKeys } from './api/query-client';
import { apiRequest } from './api/transport';
import { isFrontendApiError } from './api/errors';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP, clearStaffTransport } from './auth/customer-transport-invalidation';
import { customerSessionSchema, staffSessionSchema, type Identity, useIdentitySession } from './auth/session';
import { safeReturnPath } from './routes/return-path';
import { runtimeConfig } from './config/runtime-config';
import { Button, Card, DependencyUnavailable, Drawer, ErrorState, LoadingState, NotFound, PageHeader, PermissionDenied, TextInput } from './ui/primitives';

type CustomerTarget = 'buyer' | 'seller';
const loginSchema = z.object({ login_identifier: z.string().min(1), password: z.string().min(1) });
const staffStartSchema = z.object({ provider: z.literal('FEISHU'), authorization_url: z.string().url(), expires_at: z.number().int() }).strict();
const logoutSchema = z.object({ logged_out: z.literal(true), all_devices_logged_out: z.boolean() }).strict();

export function RootEntry() {
  return <main className="identity-entry"><Card><p className="eyebrow">专属链接提示</p><h1>月光白</h1><p>请使用工作人员发送的专属链接登录。</p></Card></main>;
}

function Protected({ identity, children }: { identity: Identity; children: ReactNode }) {
  const session = useIdentitySession(identity);
  const location = useLocation();
  if (session.status === 'LOADING' || session.status === 'UNKNOWN') return <main className="centered"><LoadingState label="正在确认登录状态" /></main>;
  if (session.status === 'DEPENDENCY_ERROR') return <main className="centered"><DependencyUnavailable /></main>;
  if (session.status === 'UNAUTHENTICATED') return <Navigate to={`/${identity}/login?return_to=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function CustomerLogin({ target }: { target: CustomerTarget }) {
  const navigate = useNavigate(); const location = useLocation(); const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const returnTo = safeReturnPath(new URLSearchParams(location.search).get('return_to'), target);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    const data = new FormData(event.currentTarget); const payload = loginSchema.safeParse({ login_identifier: data.get('login_identifier'), password: data.get('password') });
    if (!payload.success) { setMessage('请输入登录标识和密码。'); return; }
    setBusy(true);
    try {
      const result = (await apiRequest({ path: '/api/customer-auth/login', method: 'POST', schema: z.object({ session: customerSessionSchema }).strict(), body: payload.data })).data;
      await CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client);
      const expected = target === 'buyer' ? 'BUYER' : 'SELLER_MEMBER';
      if (result.session.account_type !== expected) { try { await apiRequest({ path: '/api/customer-auth/logout', method: 'POST', schema: logoutSchema }); } catch {} setMessage('该账号不适用于此登录入口，请确认账号或联系工作人员。'); return; }
      client.setQueryData(queryKeys[target].session, result.session); navigate(returnTo, { replace: true });
    } catch (error: unknown) { setMessage(isFrontendApiError(error) && error.code === 'PASSWORD_CHANGE_REQUIRED' ? '需要先修改密码。' : '登录未完成，请检查信息后重试。'); }
    finally { setBusy(false); }
  }
  const label = target === 'buyer' ? '买家登录' : '卖家登录';
  return <main className="login-page"><Card><h1>{label}</h1><p>使用您的账户凭据继续。</p><form onSubmit={submit}><label>登录标识<TextInput name="login_identifier" autoComplete="username" required /></label><label>密码<TextInput name="password" type="password" autoComplete="current-password" required /></label>{message && <p className="inline-error" role="alert">{message}</p>}<Button type="submit" disabled={busy}>{busy ? '正在登录' : '登录'}</Button></form></Card></main>;
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

const buyerItems = [['/', '首页'], ['/tasks', '任务'], ['/order-materials', '订单资料'], ['/reviews', '评论'], ['/me', '我的']] as const;
function BuyerShell() { const location = useLocation(); return <main className="buyer-shell"><PageHeader title="月光白"><p>买家服务基础</p></PageHeader><section className="placeholder"><h2>{buyerItems.find(([path]) => location.pathname === `/buyer${path}`)?.[1] ?? '买家'}</h2><p>该功能将在买家业务模块开放。</p></section><nav className="bottom-nav" aria-label="买家导航">{buyerItems.map(([path, label]) => <NavLink key={path} to={`/buyer${path}`} end={path === '/'}>{label}</NavLink>)}</nav></main>; }

const sellerItems = ['概览', '商品', '需求', '订单', '评论', '结算', '设置'] as const;
function SellerShell() { const [drawer, setDrawer] = useState(false); return <main className="work-shell seller-shell"><aside className="sidebar"><strong>月光白</strong><nav aria-label="卖家导航">{sellerItems.map((item) => <a href="#foundation" key={item}>{item}</a>)}</nav></aside><section className="work-content"><header className="context"><span>组织与店铺</span><small>基础上下文将在业务模块开放</small></header><PageHeader title="卖家工作台"><Button onClick={() => setDrawer(true)}>查看详情结构</Button></PageHeader><section id="foundation" className="foundation-grid"><Card><h2>内容区域</h2><p>该功能将在卖家业务模块开放。</p></Card><Card><h2>筛选与表格</h2><div className="table-wrap"><table><caption>基础数据容器</caption><thead><tr><th>状态</th><th>说明</th></tr></thead><tbody><tr><td>基础</td><td>尚无业务数据</td></tr></tbody></table></div></Card></section></section><Drawer open={drawer} title="详情结构" onClose={() => setDrawer(false)}><p>关闭后会回到原有筛选、分页与滚动位置。</p></Drawer></main>; }

function StaffShell() { const [drawer, setDrawer] = useState(false); return <main className="staff-shell"><PageHeader title="员工工作台"><Button onClick={() => setDrawer(true)}>打开操作区</Button></PageHeader><section className="staff-panes"><section aria-labelledby="queue"><h2 id="queue">待处理队列</h2><p>队列结构将在员工业务模块开放。</p></section><section aria-labelledby="detail"><h2 id="detail">详情</h2><p>客户可见内容与内部内容将在正式流程中区分。</p><div className="internal-note">内部内容区（示例）</div></section><section aria-labelledby="actions"><h2 id="actions">操作区</h2><p>普通操作</p><div className="sensitive-action">财务敏感操作（示例）</div></section></section><Drawer open={drawer} title="操作区" onClose={() => setDrawer(false)}><p>小屏幕使用顺序操作区，不执行真实业务命令。</p></Drawer></main>; }

function DomainNotFound() { return <main className="centered"><NotFound /></main>; }
function AppRoutes() { return <Routes><Route path="/" element={<RootEntry />} /><Route path="/buyer/login" element={<CustomerLogin target="buyer" />} /><Route path="/seller/login" element={<CustomerLogin target="seller" />} /><Route path="/staff/login" element={<StaffLogin />} /><Route path="/staff/auth/callback" element={<Protected identity="staff"><StaffShell /></Protected>} /><Route path="/buyer/*" element={<Protected identity="buyer"><Routes><Route index element={<BuyerShell />} /><Route path="tasks" element={<BuyerShell />} /><Route path="order-materials" element={<BuyerShell />} /><Route path="reviews" element={<BuyerShell />} /><Route path="me" element={<BuyerShell />} /><Route path="*" element={<DomainNotFound />} /></Routes></Protected>} /><Route path="/seller/*" element={<Protected identity="seller"><Routes><Route index element={<SellerShell />} /><Route path="products" element={<SellerShell />} /><Route path="demands" element={<SellerShell />} /><Route path="orders" element={<SellerShell />} /><Route path="reviews" element={<SellerShell />} /><Route path="settlements" element={<SellerShell />} /><Route path="settings" element={<SellerShell />} /><Route path="*" element={<DomainNotFound />} /></Routes></Protected>} /><Route path="/staff/*" element={<Protected identity="staff"><Routes><Route index element={<StaffShell />} /><Route path="queue" element={<StaffShell />} /><Route path="work/:workItemId" element={<StaffShell />} /><Route path="*" element={<DomainNotFound />} /></Routes></Protected>} /><Route path="/forbidden" element={<PermissionDenied />} /><Route path="/dependency-error" element={<ErrorState title="服务暂时不可用" requestId="local-request" />} /><Route path="*" element={<DomainNotFound />} /></Routes>; }

export function App() { return <QueryClientProvider client={queryClient}><BrowserRouter><AppRoutes /></BrowserRouter></QueryClientProvider>; }
