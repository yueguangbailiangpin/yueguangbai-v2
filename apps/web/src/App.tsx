import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  CircleUserRound,
} from 'lucide-react';
import { useRef, useState } from 'react';
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';
import { queryClient } from './api/query-client';
import { CustomerChangePasswordPage } from './auth/customer/CustomerChangePasswordPage';
import { CustomerLoginPage } from './auth/customer/CustomerLoginPage';
import { CustomerPasswordResetPage } from './auth/customer/CustomerPasswordResetPage';
import { CustomerPasswordRouteBoundary } from './auth/customer/CustomerPasswordRouteBoundary';
import { CustomerSessionBoundary } from './auth/customer/CustomerSessionBoundary';
import { StaffSessionBoundary, useCurrentStaffSession } from './auth/staff/StaffSessionBoundary';
import { StaffAuthController } from './auth/staff/staff-auth-controller';
import { StaffWorkbench } from './staff/StaffWorkbench';
import { safeReturnPath } from './routes/return-path';
import { BuyerDashboardPage } from './buyer/dashboard/BuyerDashboardPage';
import { BuyerDemandDetailPage } from './buyer/demands/BuyerDemandDetailPage';
import { BuyerDemandsPage } from './buyer/demands/BuyerDemandsPage';
import { BuyerFormalOrderDetailPage } from './buyer/formal-orders/BuyerFormalOrderDetailPage';
import { BuyerFormalOrdersPage } from './buyer/formal-orders/BuyerFormalOrdersPage';
import { BuyerInstructionPage } from './buyer/instructions/BuyerInstructionPage';
import { BuyerMePage } from './buyer/me/BuyerMePage';
import { BuyerOrderEvidenceDetailPage } from './buyer/order-evidence/BuyerOrderEvidenceDetailPage';
import { BuyerOrderEvidenceFormPage } from './buyer/order-evidence/BuyerOrderEvidenceFormPage';
import { BuyerOrderMaterialsPage } from './buyer/order-evidence/BuyerOrderMaterialsPage';
import { BuyerRefundDetailPage } from './buyer/refunds/BuyerRefundDetailPage';
import { BuyerRefundsPage } from './buyer/refunds/BuyerRefundsPage';
import { BuyerRegistrationPage } from './buyer/registration/BuyerRegistrationPage';
import { BuyerReservationDetailPage } from './buyer/reservations/BuyerReservationDetailPage';
import { BuyerReservationsPage } from './buyer/reservations/BuyerReservationsPage';
import { BuyerReviewDetailPage } from './buyer/reviews/BuyerReviewDetailPage';
import { BuyerReviewFormPage } from './buyer/reviews/BuyerReviewFormPage';
import { BuyerReviewsPage } from './buyer/reviews/BuyerReviewsPage';
import { BuyerLayout } from './buyer/routes/BuyerLayout';
import { SellerLayout } from './seller/routes/SellerLayout';
import {
  SellerDashboardPage,
  SellerDemandsPage,
  SellerOrdersPage,
  SellerProductApplicationDetailPage,
  SellerProductsPage,
  SellerReviewsPage,
  SellerSettingsPage,
  SellerSettlementsPage,
} from './seller/pages/SellerPages';
import { SellerDemandFormPage, SellerProductApplicationFormPage } from './seller/pages/SellerSubmissionPages';
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
  MetricCard,
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
      <h1 id="brand-title">月光白</h1>
      <p>请使用工作人员发送的专属链接登录。</p>
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
        <p>通过受信任的员工身份验证进入内部工作区。</p></div>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <div className="entry-actions">
        <Button onClick={() => { void start(); }}>使用受信任身份继续</Button>
        <Button className="secondary" onClick={() => navigate('/')}>返回</Button>
      </div>
      <p className="security-note">员工身份与买家、卖家账号严格分离；本地验收不连接外部身份提供方。</p>
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

const sellerNavigation = [
  { id: 'overview', label: '概览', href: '/seller', end: true },
  { id: 'products', label: '商品', href: '/seller/products' },
  { id: 'demands', label: '需求', href: '/seller/demands' },
  { id: 'orders', label: '订单', href: '/seller/orders' },
  { id: 'reviews', label: '评论', href: '/seller/reviews' },
  { id: 'settlements', label: '结算', href: '/seller/settlements' },
  { id: 'settings', label: '设置', href: '/seller/settings' },
] as const;

export function SellerShell(): React.JSX.Element {
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
        title="业务进度"
      ><Button onClick={() => setDrawer(true)}>查看详情结构</Button></PageHeader>
      <section id="foundation" className="seller-workspace">
        <section className="seller-metrics" aria-labelledby="seller-metrics-title">
          <h2 id="seller-metrics-title" className="visually-hidden">业务指标摘要</h2>
          {['订单', '评论', '结算'].map((label) => <MetricCard
            key={label}
            label={label}
            value="—"
            detail="业务模块开放后显示"
          />)}
        </section>
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

function StaffShell(): React.JSX.Element {
  const session = useCurrentStaffSession();
  return <IdentityShell identity="staff" className="staff-shell">
    <header className="staff-context"><strong>月光白</strong>
      <span>{session.display_name} · {session.role.display_name}</span></header>
    <PageHeader
      eyebrow="内部操作"
      title="员工工作台"
      description="队列、详情与操作保持清晰的阅读和处理顺序。"
    />
    <StaffWorkbench />
    <footer className="staff-account-footer"><StaffAccountActions /></footer>
  </IdentityShell>;
}

function DomainNotFound(): React.JSX.Element {
  return <main className="centered"><NotFound /></main>;
}

function AppRoutes(): React.JSX.Element {
  return <Routes>
    <Route path="/" element={<RootEntry />} />
    <Route path="/buyer/login" element={<CustomerLoginPage target="buyer" />} />
    <Route path="/buyer/register" element={<BuyerRegistrationPage />} />
    <Route path="/customer/reset-password" element={<CustomerPasswordResetPage />} />
    <Route path="/seller/login" element={<CustomerLoginPage target="seller" />} />
    <Route path="/buyer/change-password" element={<CustomerPasswordRouteBoundary target="buyer"><CustomerChangePasswordPage target="buyer" /></CustomerPasswordRouteBoundary>} />
    <Route path="/seller/change-password" element={<CustomerPasswordRouteBoundary target="seller"><CustomerChangePasswordPage target="seller" /></CustomerPasswordRouteBoundary>} />
    <Route path="/staff/login" element={<StaffLogin />} />
    <Route path="/staff/auth/callback" element={<StaffSessionBoundary><StaffShell /></StaffSessionBoundary>} />
    <Route path="/buyer/*" element={<CustomerSessionBoundary target="buyer"><BuyerLayout /></CustomerSessionBoundary>}>
      <Route index element={<BuyerDashboardPage />} />
      <Route path="products" element={<BuyerDashboardPage />} />
      <Route path="tasks" element={<BuyerDashboardPage />} />
      <Route path="demands" element={<BuyerDemandsPage />} />
      <Route path="demands/:demandId" element={<BuyerDemandDetailPage />} />
      <Route path="reservations" element={<BuyerReservationsPage />} />
      <Route path="reservations/:reservationId" element={<BuyerReservationDetailPage />} />
      <Route path="reservations/:reservationId/instruction" element={<BuyerInstructionPage />} />
      <Route path="order-materials" element={<BuyerOrderMaterialsPage />} />
      <Route path="order-materials/new" element={<BuyerOrderEvidenceFormPage />} />
      <Route path="order-materials/:submissionId" element={<BuyerOrderEvidenceDetailPage />} />
      <Route path="orders" element={<BuyerFormalOrdersPage />} />
      <Route path="orders/:formalOrderId" element={<BuyerFormalOrderDetailPage />} />
      <Route path="reviews" element={<BuyerReviewsPage />} />
      <Route path="reviews/new" element={<BuyerReviewFormPage />} />
      <Route path="reviews/:reviewCaseId" element={<BuyerReviewDetailPage />} />
      <Route path="refunds" element={<BuyerRefundsPage />} />
      <Route path="refunds/:refundId" element={<BuyerRefundDetailPage />} />
      <Route path="me" element={<BuyerMePage />} />
      <Route path="*" element={<DomainNotFound />} />
    </Route>
    <Route path="/seller/*" element={<CustomerSessionBoundary target="seller"><Routes>
      <Route element={<SellerLayout />}>
      <Route index element={<SellerDashboardPage />} />
      <Route path="products" element={<SellerProductsPage />} />
      <Route path="products/new" element={<SellerProductApplicationFormPage />} />
      <Route path="products/:applicationId" element={<SellerProductApplicationDetailPage />} />
      <Route path="demands" element={<SellerDemandsPage />} />
      <Route path="demands/new" element={<SellerDemandFormPage />} />
      <Route path="orders" element={<SellerOrdersPage />} />
      <Route path="reviews" element={<SellerReviewsPage />} />
      <Route path="settlements" element={<SellerSettlementsPage />} />
      <Route path="settings" element={<SellerSettingsPage />} />
      </Route>
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
