import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { queryClient } from './api/query-client';
import { CustomerLoginPage } from './auth/customer/CustomerLoginPage';
import { CustomerChangePasswordPage } from './auth/customer/CustomerChangePasswordPage';
import { CustomerPasswordRouteBoundary } from './auth/customer/CustomerPasswordRouteBoundary';
import { CustomerSessionBoundary } from './auth/customer/CustomerSessionBoundary';
import { safeReturnPath } from './routes/return-path';
import { Button, Card, DependencyUnavailable, Dialog, Drawer, ErrorState, LoadingState, NotFound, PageHeader, PermissionDenied, RequestIdDisplay } from './ui/primitives';
import { StaffAuthController } from './auth/staff/staff-auth-controller';
import { StaffSessionBoundary } from './auth/staff/StaffSessionBoundary';

export function RootEntry() {
  return <main className="identity-entry"><Card><p className="eyebrow">专属链接提示</p><h1>月光白</h1><p>请使用工作人员发送的专属链接登录。</p></Card></main>;
}

function StaffLogin() {
  const client = useQueryClient(); const navigate = useNavigate(); const location = useLocation(); const [message, setMessage] = useState<string | null>(null); const controller = useRef<StaffAuthController | null>(null); controller.current ??= new StaffAuthController(client);
  async function start(): Promise<void> {
    const returnTo = safeReturnPath(new URLSearchParams(location.search).get('return_to'), 'staff');
    try {
      window.location.assign(await controller.current!.startLogin(returnTo));
    } catch { setMessage('暂时无法开始员工登录，请稍后重试。'); }
  }
  return <main className="login-page"><Card><h1>员工登录</h1><p>将跳转到受信任的身份提供方完成验证。</p>{message && <p className="inline-error" role="alert">{message}</p>}<Button onClick={() => { void start(); }}>继续登录</Button><Button className="secondary" onClick={() => navigate('/')}>返回入口</Button></Card></main>;
}


function StaffAccountActions() {
  const client = useQueryClient(); const navigate = useNavigate(); const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null); const [requestId, setRequestId] = useState<string | null>(null); const controller = useRef<StaffAuthController | null>(null); controller.current ??= new StaffAuthController(client);
  async function finishLogout(all: boolean): Promise<void> { setBusy(true); setMessage(null); const result = all ? await controller.current!.logoutAll() : await controller.current!.logout(); setRequestId(result.requestId); if (result.kind === 'LOGGED_OUT') { navigate('/staff/login', { replace: true }); } else { setMessage(result.kind === 'IDEMPOTENCY_CONFLICT' ? '该操作发生冲突，请结束后重新发起。' : result.kind === 'REQUEST_IN_PROGRESS' || result.kind === 'ALREADY_SUBMITTING' ? '操作正在处理中，请勿重复提交。' : '退出未完成，请由您决定是否重试。'); } setBusy(false); }
  const cancel = (): void => { if (!busy) { controller.current!.cancelLogoutAll(); setConfirming(false); setMessage(null); } };
  return <section className="staff-account-actions" aria-label="账户操作"><Button className="secondary" disabled={busy} onClick={() => { void finishLogout(false); }}>退出登录</Button><Button className="danger" disabled={busy} onClick={() => setConfirming(true)}>退出所有设备</Button>{message && <p className="inline-error" role="alert">{message}</p>}<RequestIdDisplay requestId={requestId} /><Dialog open={confirming} title="退出所有设备" description="这会使其他设备上的员工会话失效。" busy={busy} onClose={cancel}><div className="entry-actions"><Button className="secondary" disabled={busy} onClick={cancel}>取消</Button><Button className="danger" disabled={busy} onClick={() => { void finishLogout(true); }}>{busy ? '正在退出' : '确认退出所有设备'}</Button></div></Dialog></section>;
}

const buyerItems = [['/', '首页'], ['/tasks', '任务'], ['/order-materials', '订单资料'], ['/reviews', '评论'], ['/me', '我的']] as const;
function BuyerShell() { const location = useLocation(); return <main className="buyer-shell"><PageHeader title="月光白"><p>买家服务基础</p></PageHeader><section className="placeholder"><h2>{buyerItems.find(([path]) => location.pathname === `/buyer${path}`)?.[1] ?? '买家'}</h2><p>该功能将在买家业务模块开放。</p></section><nav className="bottom-nav" aria-label="买家导航">{buyerItems.map(([path, label]) => <NavLink key={path} to={`/buyer${path}`} end={path === '/'}>{label}</NavLink>)}</nav></main>; }

const sellerItems = ['概览', '商品', '需求', '订单', '评论', '结算', '设置'] as const;
function SellerShell() { const [drawer, setDrawer] = useState(false); return <main className="work-shell seller-shell"><aside className="sidebar"><strong>月光白</strong><nav aria-label="卖家导航">{sellerItems.map((item) => <a href="#foundation" key={item}>{item}</a>)}</nav></aside><section className="work-content"><header className="context"><span>组织与店铺</span><small>基础上下文将在业务模块开放</small></header><PageHeader title="卖家工作台"><Button onClick={() => setDrawer(true)}>查看详情结构</Button></PageHeader><section id="foundation" className="foundation-grid"><Card><h2>内容区域</h2><p>该功能将在卖家业务模块开放。</p></Card><Card><h2>筛选与表格</h2><div className="table-wrap"><table><caption>基础数据容器</caption><thead><tr><th>状态</th><th>说明</th></tr></thead><tbody><tr><td>基础</td><td>尚无业务数据</td></tr></tbody></table></div></Card></section></section><Drawer open={drawer} title="详情结构" onClose={() => setDrawer(false)}><p>关闭后会回到原有筛选、分页与滚动位置。</p></Drawer></main>; }

function StaffShell() { const [drawer, setDrawer] = useState(false); return <main className="staff-shell"><PageHeader title="员工工作台"><Button onClick={() => setDrawer(true)}>打开操作区</Button></PageHeader><section className="staff-panes"><section aria-labelledby="queue"><h2 id="queue">待处理队列</h2><p>队列结构将在员工业务模块开放。</p></section><section aria-labelledby="detail"><h2 id="detail">详情</h2><p>客户可见内容与内部内容将在正式流程中区分。</p><div className="internal-note">内部内容区（示例）</div></section><section aria-labelledby="actions"><h2 id="actions">操作区</h2><StaffAccountActions /><div className="sensitive-action">财务敏感操作（示例）</div></section></section><Drawer open={drawer} title="操作区" onClose={() => setDrawer(false)}><p>小屏幕使用顺序操作区，不执行真实业务命令。</p></Drawer></main>; }

function DomainNotFound() { return <main className="centered"><NotFound /></main>; }
function AppRoutes() { return <Routes><Route path="/" element={<RootEntry />} /><Route path="/buyer/login" element={<CustomerLoginPage target="buyer" />} /><Route path="/seller/login" element={<CustomerLoginPage target="seller" />} /><Route path="/buyer/change-password" element={<CustomerPasswordRouteBoundary target="buyer"><CustomerChangePasswordPage target="buyer" /></CustomerPasswordRouteBoundary>} /><Route path="/seller/change-password" element={<CustomerPasswordRouteBoundary target="seller"><CustomerChangePasswordPage target="seller" /></CustomerPasswordRouteBoundary>} /><Route path="/staff/login" element={<StaffLogin />} /><Route path="/staff/auth/callback" element={<StaffSessionBoundary><StaffShell /></StaffSessionBoundary>} /><Route path="/buyer/*" element={<CustomerSessionBoundary target="buyer"><Routes><Route index element={<BuyerShell />} /><Route path="tasks" element={<BuyerShell />} /><Route path="order-materials" element={<BuyerShell />} /><Route path="reviews" element={<BuyerShell />} /><Route path="me" element={<BuyerShell />} /><Route path="*" element={<DomainNotFound />} /></Routes></CustomerSessionBoundary>} /><Route path="/seller/*" element={<CustomerSessionBoundary target="seller"><Routes><Route index element={<SellerShell />} /><Route path="products" element={<SellerShell />} /><Route path="demands" element={<SellerShell />} /><Route path="orders" element={<SellerShell />} /><Route path="reviews" element={<SellerShell />} /><Route path="settlements" element={<SellerShell />} /><Route path="settings" element={<SellerShell />} /><Route path="*" element={<DomainNotFound />} /></Routes></CustomerSessionBoundary>} /><Route path="/staff/*" element={<StaffSessionBoundary><Routes><Route index element={<StaffShell />} /><Route path="queue" element={<StaffShell />} /><Route path="work/:workItemId" element={<StaffShell />} /><Route path="*" element={<DomainNotFound />} /></Routes></StaffSessionBoundary>} /><Route path="/forbidden" element={<PermissionDenied />} /><Route path="/dependency-error" element={<ErrorState title="服务暂时不可用" requestId="local-request" />} /><Route path="*" element={<DomainNotFound />} /></Routes>; }

export function App() { return <QueryClientProvider client={queryClient}><BrowserRouter><AppRoutes /></BrowserRouter></QueryClientProvider>; }
