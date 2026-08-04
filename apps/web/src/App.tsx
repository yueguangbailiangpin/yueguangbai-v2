import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  CircleUserRound,
  ClipboardList,
  FolderOpen,
  Home,
  MessageSquareText,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useRef, useState } from 'react';
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { queryClient } from './api/query-client';
import { CustomerChangePasswordPage } from './auth/customer/CustomerChangePasswordPage';
import { CustomerLoginPage } from './auth/customer/CustomerLoginPage';
import { CustomerPasswordRouteBoundary } from './auth/customer/CustomerPasswordRouteBoundary';
import { CustomerSessionBoundary } from './auth/customer/CustomerSessionBoundary';
import { StaffSessionBoundary } from './auth/staff/StaffSessionBoundary';
import { StaffAuthController } from './auth/staff/staff-auth-controller';
import { safeReturnPath } from './routes/return-path';
import {
  Alert,
  AppShell,
  BottomNavigation,
  Button,
  Card,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  IdentityShell,
  NotFound,
  PageHeader,
  PermissionDenied,
  RequestIdDisplay,
  SearchInput,
  Select,
  Sidebar,
  StatusBadge,
} from './ui/primitives';

export function RootEntry(): React.JSX.Element {
  return <main className="identity-entry">
    <section className="dedicated-entry" aria-labelledby="brand-title">
      <div className="brand-mark" aria-hidden="true">月</div>
      <p className="eyebrow">专属访问</p>
      <h1 id="brand-title">月光白</h1>
      <p>请使用工作人员发送的专属链接登录。</p>
      <div className="entry-trust-note">
        <ShieldCheck aria-hidden="true" />
        <span>链接将自动确认您的访问身份</span>
      </div>
    </section>
  </main>;
}

function StaffLogin(): React.JSX.Element {
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<StaffAuthController | null>(null);
  controller.current ??= new StaffAuthController(client);

  async function start(): Promise<void> {
    const returnTo = safeReturnPath(
      new URLSearchParams(location.search).get('return_to'),
      'staff',
    );
    try {
      window.location.assign(await controller.current!.startLogin(returnTo));
    } catch {
      setMessage('暂时无法开始员工登录，请稍后重试。');
    }
  }

  return <main className="login-page identity-staff">
    <Card className="login-card">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">月</span>
        <strong>月光白</strong></div>
      <div className="login-heading"><p className="eyebrow">员工工作区</p>
        <h1>员工登录</h1>
        <p>通过受信任的飞书身份验证进入内部工作区。</p></div>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <div className="entry-actions">
        <Button onClick={() => { void start(); }}>使用飞书继续</Button>
        <Button className="secondary" onClick={() => navigate('/')}>返回</Button>
      </div>
      <p className="security-note">本地验收使用模拟身份提供方，不连接真实飞书。</p>
    </Card>
  </main>;
}

function StaffAccountActions(): React.JSX.Element {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const controller = useRef<StaffAuthController | null>(null);
  controller.current ??= new StaffAuthController(client);

  async function finishLogout(all: boolean): Promise<void> {
    setBusy(true);
    setMessage(null);
    const result = all
      ? await controller.current!.logoutAll()
      : await controller.current!.logout();
    setRequestId(result.requestId);
    if (result.kind === 'LOGGED_OUT') {
      navigate('/staff/login', { replace: true });
    } else {
      setMessage(result.kind === 'IDEMPOTENCY_CONFLICT'
        ? '该操作发生冲突，请结束后重新发起。'
        : result.kind === 'REQUEST_IN_PROGRESS'
          || result.kind === 'ALREADY_SUBMITTING'
          ? '操作正在处理中，请勿重复提交。'
          : '退出未完成，请由您决定是否重试。');
    }
    setBusy(false);
  }

  const cancel = (): void => {
    if (!busy) {
      controller.current!.cancelLogoutAll();
      setConfirming(false);
      setMessage(null);
    }
  };

  return <section className="staff-account-actions" aria-label="账户操作">
    <Button className="secondary" disabled={busy} onClick={() => {
      void finishLogout(false);
    }}>退出登录</Button>
    <Button className="danger" disabled={busy} onClick={() => setConfirming(true)}>
      退出所有设备
    </Button>
    {message ? <p className="inline-error" role="alert">{message}</p> : null}
    <RequestIdDisplay requestId={requestId} />
    <Dialog
      open={confirming}
      title="退出所有设备"
      description="这会使其他设备上的员工会话失效。"
      busy={busy}
      onClose={cancel}
    ><div className="entry-actions">
        <Button className="secondary" disabled={busy} onClick={cancel}>取消</Button>
        <Button className="danger" loading={busy} loadingLabel="正在退出" onClick={() => {
          void finishLogout(true);
        }}>确认退出所有设备</Button>
      </div></Dialog>
  </section>;
}

const buyerItems = [
  ['/', '首页', Home],
  ['/tasks', '任务', ClipboardList],
  ['/order-materials', '订单资料', FolderOpen],
  ['/reviews', '评论', MessageSquareText],
  ['/me', '我的', UserRound],
] as const;

function BuyerShell(): React.JSX.Element {
  const location = useLocation();
  const current = buyerItems.find(
    ([path]) => location.pathname === `/buyer${path}`,
  ) ?? buyerItems[0];
  return <IdentityShell identity="buyer" className="buyer-shell">
    <header className="buyer-brand-bar"><strong>月光白</strong>
      <span>买家服务</span></header>
    <main className="buyer-main">
      <PageHeader
        eyebrow="买家工作区"
        title={current[1]}
        description="清晰查看当前可用的服务入口。"
      />
      <section className="buyer-content" aria-label={`${current[1]}内容`}>
        <EmptyState
          title={`${current[1]}尚未开放`}
          description="该功能将在买家业务模块开放"
        />
      </section>
    </main>
    <BottomNavigation label="买家导航">{buyerItems.map(([path, label, Icon]) =>
      <NavLink key={path} to={`/buyer${path}`} end={path === '/'}>
        <Icon aria-hidden="true" /><span>{label}</span>
      </NavLink>)}</BottomNavigation>
  </IdentityShell>;
}

const sellerNavigation = [
  { id: 'overview', label: '概览', href: '/seller', current: true },
  { id: 'products', label: '商品', href: '/seller/products' },
  { id: 'demands', label: '需求', href: '/seller/demands' },
  { id: 'orders', label: '订单', href: '/seller/orders' },
  { id: 'reviews', label: '评论', href: '/seller/reviews' },
  { id: 'settlements', label: '结算', href: '/seller/settlements' },
  { id: 'settings', label: '设置', href: '/seller/settings' },
] as const;

function SellerShell(): React.JSX.Element {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  return <IdentityShell identity="seller" className="work-shell seller-shell">
    <Sidebar
      label="卖家导航"
      items={sellerNavigation}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
    />
    <main className="work-content">
      <header className="context" aria-label="组织和店铺上下文">
        <span><CircleUserRound aria-hidden="true" />组织与店铺</span>
        <small>业务上下文将在卖家业务模块开放</small>
      </header>
      <PageHeader
        eyebrow="卖家工作区"
        title="卖家工作台"
        description="集中处理商品、需求、订单与结算入口。"
      ><Button onClick={() => setDrawer(true)}>查看详情结构</Button></PageHeader>
      <section id="foundation" className="seller-workspace">
        <div className="filter-bar" role="search" aria-label="列表筛选">
          <SearchInput label="搜索当前列表" placeholder="搜索（业务模块开放后可用）" />
          <label htmlFor="seller-status">状态</label>
          <Select id="seller-status" defaultValue="all">
            <option value="all">全部状态</option>
            <option value="pending">待处理</option>
          </Select>
        </div>
        <Card className="seller-list-card">
          <div className="section-heading"><div><p className="eyebrow">列表结构</p>
            <h2>工作列表</h2></div><StatusBadge tone="neutral">尚无业务数据</StatusBadge></div>
          <DataTable caption="卖家工作列表基础容器" className="desktop-table">
            <thead><tr><th scope="col">项目</th><th scope="col">状态</th><th scope="col">更新时间</th><th scope="col">操作</th></tr></thead>
            <tbody><tr><td colSpan={4}><EmptyState
              title="暂无列表内容"
              description="该功能将在卖家业务模块开放"
            /></td></tr></tbody>
          </DataTable>
          <div className="mobile-list"><EmptyState
            title="暂无列表内容"
            description="该功能将在卖家业务模块开放"
          /></div>
        </Card>
      </section>
    </main>
    <Drawer
      open={drawer}
      title="详情结构"
      description="列表上下文会在关闭详情后保留。"
      onClose={() => setDrawer(false)}
    ><EmptyState title="暂无详情" description="该功能将在卖家业务模块开放" /></Drawer>
  </IdentityShell>;
}

function StaffActionContent(): React.JSX.Element {
  return <><section className="action-group" aria-labelledby="ordinary-actions">
    <h3 id="ordinary-actions">普通操作</h3>
    <p>业务操作将在员工业务模块开放。</p>
  </section>
  <section className="action-group sensitive-action" aria-labelledby="financial-actions">
    <h3 id="financial-actions">财务敏感操作</h3>
    <p>仅在具备独立权限并完成后端校验后开放。</p>
  </section>
  <StaffAccountActions /></>;
}

function StaffShell(): React.JSX.Element {
  const [drawer, setDrawer] = useState(false);
  return <IdentityShell identity="staff" className="staff-shell">
    <header className="staff-context"><strong>月光白</strong>
      <span>员工工作区</span></header>
    <PageHeader
      eyebrow="内部操作"
      title="员工工作台"
      description="队列、详情与操作保持清晰的阅读和处理顺序。"
    ><Button className="narrow-only" onClick={() => setDrawer(true)}>
        打开操作区
      </Button></PageHeader>
    <main className="staff-panes">
      <section className="staff-queue" aria-labelledby="queue">
        <div className="pane-heading"><h2 id="queue">待处理队列</h2>
          <StatusBadge tone="neutral">空</StatusBadge></div>
        <SearchInput label="搜索待处理队列" placeholder="搜索队列" />
        <EmptyState title="队列为空" description="该功能将在员工业务模块开放" />
      </section>
      <section className="staff-detail" aria-labelledby="detail">
        <div className="pane-heading"><h2 id="detail">详情</h2>
          <StatusBadge tone="processing">等待选择</StatusBadge></div>
        <section className="customer-visible" aria-labelledby="customer-visible-title">
          <h3 id="customer-visible-title">客户可见内容</h3>
          <p>仅展示允许客户查看的信息结构。</p>
        </section>
        <section className="internal-note" aria-labelledby="internal-title">
          <h3 id="internal-title">内部内容</h3>
          <p>内部记录与客户可见内容保持结构分离。</p>
        </section>
      </section>
      <aside className="staff-actions wide-only" aria-labelledby="actions">
        <h2 id="actions">操作区</h2><StaffActionContent />
      </aside>
    </main>
    <Drawer
      open={drawer}
      title="操作区"
      description="窄屏按队列、详情、操作的顺序完成工作。"
      onClose={() => setDrawer(false)}
    ><StaffActionContent /></Drawer>
  </IdentityShell>;
}

function DomainNotFound(): React.JSX.Element {
  return <main className="centered"><NotFound /></main>;
}

function AppRoutes(): React.JSX.Element {
  return <Routes>
    <Route path="/" element={<RootEntry />} />
    <Route path="/buyer/login" element={<CustomerLoginPage target="buyer" />} />
    <Route path="/seller/login" element={<CustomerLoginPage target="seller" />} />
    <Route path="/buyer/change-password" element={<CustomerPasswordRouteBoundary target="buyer"><CustomerChangePasswordPage target="buyer" /></CustomerPasswordRouteBoundary>} />
    <Route path="/seller/change-password" element={<CustomerPasswordRouteBoundary target="seller"><CustomerChangePasswordPage target="seller" /></CustomerPasswordRouteBoundary>} />
    <Route path="/staff/login" element={<StaffLogin />} />
    <Route path="/staff/auth/callback" element={<StaffSessionBoundary><StaffShell /></StaffSessionBoundary>} />
    <Route path="/buyer/*" element={<CustomerSessionBoundary target="buyer"><Routes>
      <Route index element={<BuyerShell />} />
      <Route path="tasks" element={<BuyerShell />} />
      <Route path="order-materials" element={<BuyerShell />} />
      <Route path="reviews" element={<BuyerShell />} />
      <Route path="me" element={<BuyerShell />} />
      <Route path="*" element={<DomainNotFound />} />
    </Routes></CustomerSessionBoundary>} />
    <Route path="/seller/*" element={<CustomerSessionBoundary target="seller"><Routes>
      <Route index element={<SellerShell />} />
      <Route path="products" element={<SellerShell />} />
      <Route path="demands" element={<SellerShell />} />
      <Route path="orders" element={<SellerShell />} />
      <Route path="reviews" element={<SellerShell />} />
      <Route path="settlements" element={<SellerShell />} />
      <Route path="settings" element={<SellerShell />} />
      <Route path="*" element={<DomainNotFound />} />
    </Routes></CustomerSessionBoundary>} />
    <Route path="/staff/*" element={<StaffSessionBoundary><Routes>
      <Route index element={<StaffShell />} />
      <Route path="queue" element={<StaffShell />} />
      <Route path="work/:workItemId" element={<StaffShell />} />
      <Route path="*" element={<DomainNotFound />} />
    </Routes></StaffSessionBoundary>} />
    <Route path="/forbidden" element={<main className="centered"><PermissionDenied requestId="local-permission-request" /></main>} />
    <Route path="/dependency-error" element={<main className="centered"><ErrorState title="服务暂时不可用" requestId="local-request" /></main>} />
    <Route path="*" element={<DomainNotFound />} />
  </Routes>;
}

export function App(): React.JSX.Element {
  return <QueryClientProvider client={queryClient}>
    <BrowserRouter><AppShell><AppRoutes /></AppShell></BrowserRouter>
  </QueryClientProvider>;
}
