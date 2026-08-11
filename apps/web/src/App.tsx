import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { queryClient, reviewQueryClient } from './api/query-client';
import { CustomerChangePasswordPage } from './auth/customer/CustomerChangePasswordPage';
import { CustomerLoginPage } from './auth/customer/CustomerLoginPage';
import { CustomerPasswordResetPage } from './auth/customer/CustomerPasswordResetPage';
import { CustomerPasswordRouteBoundary } from './auth/customer/CustomerPasswordRouteBoundary';
import { CustomerSessionBoundary } from './auth/customer/CustomerSessionBoundary';
import { clearStaffTransport } from './auth/customer-transport-invalidation';
import { StaffSessionBoundary } from './auth/staff/StaffSessionBoundary';
import { staffAuthApi } from './auth/staff/staff-auth-api';
import { BuyerRegistrationPage } from './buyer/registration/BuyerRegistrationPage';
import { SellerRegistrationPage } from './seller/registration/SellerRegistrationPage';
import { SellerMemberRegistrationPage } from './seller/registration/SellerMemberRegistrationPage';
import { safeReturnPath } from './routes/return-path';
import { RouteChunkBoundary } from './routes/RouteChunkBoundary';
import { BuyerRouteSlot, SellerRouteSlot, StaffRouteSlot } from './routes/IdentityRouteSlots';
import { ReviewHome } from './review/ReviewHome';
import {
  isReviewRuntime, ReviewChrome, ReviewRuntimeProvider,
  reviewCustomerAuthApi, reviewStaffAuthApi,
} from './review/runtime';
import { Alert, AppShell, Button, Card, ErrorState, NotFound, PermissionDenied } from './ui/primitives';

let buyerLayout: Promise<typeof import('./buyer/routes/BuyerRouteModule')> | undefined;
let sellerLayout: Promise<typeof import('./seller/routes/SellerRouteModule')> | undefined;
let staffShell: Promise<typeof import('./staff/StaffRouteModule')> | undefined;
const loadBuyerLayout = () => buyerLayout ??= import('./buyer/routes/BuyerRouteModule');
const loadSellerLayout = () => sellerLayout ??= import('./seller/routes/SellerRouteModule');
const loadStaffShell = () => staffShell ??= import('./staff/StaffRouteModule');
const reviewBuyerAuthApi = reviewCustomerAuthApi('buyer');
const reviewSellerAuthApi = reviewCustomerAuthApi('seller');

export function RootEntry(): React.JSX.Element {
  return <main className="identity-entry"><section className="dedicated-entry" aria-labelledby="brand-title"><h1 id="brand-title">月光白</h1><p>请使用工作人员发送的专属链接登录。</p></section></main>;
}
function StaffLogin(): React.JSX.Element {
  const client=useQueryClient(),navigate=useNavigate(),location=useLocation();const [message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false);
  async function enter(){const returnTo=safeReturnPath(new URLSearchParams(location.search).get('return_to'),'staff');setBusy(true);setMessage(null);try{await staffAuthApi.bootstrap();await clearStaffTransport(client);navigate(returnTo,{replace:true});}catch{setMessage('无法建立员工会话。请确认该邮箱已通过 Cloudflare Access，且已在月光白员工管理中启用。');}finally{setBusy(false);}}
  return <main className="login-page identity-staff"><Card className="login-card staff-login-card"><div className="login-brand"><span className="brand-mark" aria-hidden="true">月</span><strong>月光白</strong></div><div className="login-heading"><p className="eyebrow">内部员工入口</p><h1>员工登录</h1><p>员工身份由 Cloudflare Access 邮箱验证码保护；月光白再校验岗位、负责站点和账号状态。</p></div>{message?<Alert tone="danger">{message}</Alert>:<Alert tone="info">如果这是首次访问，Cloudflare 会先要求你用已授权邮箱完成一次性验证码验证。</Alert>}<div className="entry-actions"><Button loading={busy} onClick={()=>{void enter();}}>进入员工后台</Button><Button className="secondary" onClick={()=>navigate('/')}>返回</Button></div><p className="security-note">Cloudflare 只证明邮箱身份；员工角色和数据范围始终由月光白控制。</p></Card></main>;
}
function DomainNotFound(){return <main className="centered"><NotFound /></main>;}

export function AppRoutes(): React.JSX.Element {
  return <Routes>
    <Route path="/" element={<RootEntry />} />
    <Route path="/buyer/login" element={<CustomerLoginPage target="buyer" />} />
    <Route path="/buyer/register" element={<BuyerRegistrationPage />} />
    <Route path="/customer/reset-password" element={<CustomerPasswordResetPage />} />
    <Route path="/seller/login" element={<CustomerLoginPage target="seller" />} />
    <Route path="/seller/register" element={<SellerRegistrationPage />} />
    <Route path="/seller/member-register" element={<SellerMemberRegistrationPage />} />
    <Route path="/buyer/change-password" element={<CustomerPasswordRouteBoundary target="buyer"><CustomerChangePasswordPage target="buyer" /></CustomerPasswordRouteBoundary>} />
    <Route path="/seller/change-password" element={<CustomerPasswordRouteBoundary target="seller"><CustomerChangePasswordPage target="seller" /></CustomerPasswordRouteBoundary>} />
    <Route path="/staff/login" element={<StaffLogin />} />
    <Route path="/buyer/*" element={<CustomerSessionBoundary target="buyer"><RouteChunkBoundary load={loadBuyerLayout} /></CustomerSessionBoundary>}>
      <Route index element={<BuyerRouteSlot />} /><Route path="products" element={<BuyerRouteSlot />} /><Route path="tasks" element={<BuyerRouteSlot />} /><Route path="demands" element={<BuyerRouteSlot />} /><Route path="demands/:demandId" element={<BuyerRouteSlot />} /><Route path="reservations" element={<BuyerRouteSlot />} /><Route path="reservations/:reservationId" element={<BuyerRouteSlot />} /><Route path="reservations/:reservationId/instruction" element={<BuyerRouteSlot />} /><Route path="order-materials" element={<BuyerRouteSlot />} /><Route path="order-materials/new" element={<BuyerRouteSlot />} /><Route path="order-materials/:submissionId" element={<BuyerRouteSlot />} /><Route path="orders" element={<BuyerRouteSlot />} /><Route path="orders/:formalOrderId" element={<BuyerRouteSlot />} /><Route path="reviews" element={<BuyerRouteSlot />} /><Route path="reviews/new" element={<BuyerRouteSlot />} /><Route path="reviews/:reviewCaseId" element={<BuyerRouteSlot />} /><Route path="refunds" element={<BuyerRouteSlot />} /><Route path="refunds/:refundId" element={<BuyerRouteSlot />} /><Route path="me" element={<BuyerRouteSlot />} /><Route path="*" element={<DomainNotFound />} />
    </Route>
    <Route path="/seller/*" element={<CustomerSessionBoundary target="seller"><RouteChunkBoundary load={loadSellerLayout} /></CustomerSessionBoundary>}>
      <Route index element={<SellerRouteSlot />} /><Route path="products" element={<SellerRouteSlot />} /><Route path="products/new" element={<SellerRouteSlot />} /><Route path="products/:applicationId" element={<SellerRouteSlot />} /><Route path="demands" element={<SellerRouteSlot />} /><Route path="demands/new" element={<SellerRouteSlot />} /><Route path="orders" element={<SellerRouteSlot />} /><Route path="reviews" element={<SellerRouteSlot />} /><Route path="settlements" element={<SellerRouteSlot />} /><Route path="settings" element={<SellerRouteSlot />} /><Route path="*" element={<DomainNotFound />} />
    </Route>
    <Route path="/staff/*" element={<StaffSessionBoundary><RouteChunkBoundary load={loadStaffShell} /></StaffSessionBoundary>}>
      <Route index element={<StaffRouteSlot />} /><Route path="queue" element={<StaffRouteSlot />} /><Route path="work/:workItemId" element={<StaffRouteSlot />} /><Route path="acquisition" element={<StaffRouteSlot />} /><Route path="buyer-customers" element={<StaffRouteSlot />} /><Route path="seller-customers" element={<StaffRouteSlot />} /><Route path="admin-business-dashboard" element={<StaffRouteSlot />} /><Route path="access-management" element={<StaffRouteSlot />} /><Route path="seller-principal-rate-policies" element={<StaffRouteSlot />} /><Route path="products" element={<StaffRouteSlot />} /><Route path="products/:productId" element={<StaffRouteSlot />} /><Route path="demands/:demandId/reservations" element={<StaffRouteSlot />} /><Route path="*" element={<DomainNotFound />} />
    </Route>
    <Route path="/forbidden" element={<main className="centered"><PermissionDenied requestId="local-permission-request" /></main>} />
    <Route path="/dependency-error" element={<main className="centered"><ErrorState title="服务暂时不可用" requestId="local-request" /></main>} />
    <Route path="*" element={<DomainNotFound />} />
  </Routes>;
}

export function ReviewRoutes(): React.JSX.Element {
  return <Routes>
    <Route path="/" element={<ReviewHome />} />
    <Route path="/buyer/*" element={<CustomerSessionBoundary target="buyer" adapter={reviewBuyerAuthApi}><RouteChunkBoundary load={loadBuyerLayout} /></CustomerSessionBoundary>}>
      <Route index element={<BuyerRouteSlot />} /><Route path="products" element={<BuyerRouteSlot />} /><Route path="tasks" element={<BuyerRouteSlot />} /><Route path="demands" element={<BuyerRouteSlot />} /><Route path="demands/:demandId" element={<BuyerRouteSlot />} /><Route path="reservations" element={<BuyerRouteSlot />} /><Route path="reservations/:reservationId" element={<BuyerRouteSlot />} /><Route path="reservations/:reservationId/instruction" element={<BuyerRouteSlot />} /><Route path="order-materials" element={<BuyerRouteSlot />} /><Route path="order-materials/new" element={<BuyerRouteSlot />} /><Route path="order-materials/:submissionId" element={<BuyerRouteSlot />} /><Route path="orders" element={<BuyerRouteSlot />} /><Route path="orders/:formalOrderId" element={<BuyerRouteSlot />} /><Route path="reviews" element={<BuyerRouteSlot />} /><Route path="reviews/new" element={<BuyerRouteSlot />} /><Route path="reviews/:reviewCaseId" element={<BuyerRouteSlot />} /><Route path="refunds" element={<BuyerRouteSlot />} /><Route path="refunds/:refundId" element={<BuyerRouteSlot />} /><Route path="me" element={<BuyerRouteSlot />} /><Route path="*" element={<DomainNotFound />} />
    </Route>
    <Route path="/seller/*" element={<CustomerSessionBoundary target="seller" adapter={reviewSellerAuthApi}><RouteChunkBoundary load={loadSellerLayout} /></CustomerSessionBoundary>}>
      <Route index element={<SellerRouteSlot />} /><Route path="products" element={<SellerRouteSlot />} /><Route path="products/new" element={<SellerRouteSlot />} /><Route path="products/:applicationId" element={<SellerRouteSlot />} /><Route path="demands" element={<SellerRouteSlot />} /><Route path="demands/new" element={<SellerRouteSlot />} /><Route path="orders" element={<SellerRouteSlot />} /><Route path="reviews" element={<SellerRouteSlot />} /><Route path="settlements" element={<SellerRouteSlot />} /><Route path="settings" element={<SellerRouteSlot />} /><Route path="*" element={<DomainNotFound />} />
    </Route>
    <Route path="/staff/*" element={<StaffSessionBoundary adapter={reviewStaffAuthApi}><RouteChunkBoundary load={loadStaffShell} /></StaffSessionBoundary>}>
      <Route index element={<StaffRouteSlot />} /><Route path="queue" element={<StaffRouteSlot />} /><Route path="work/:workItemId" element={<StaffRouteSlot />} /><Route path="acquisition" element={<StaffRouteSlot />} /><Route path="buyer-customers" element={<StaffRouteSlot />} /><Route path="seller-customers" element={<StaffRouteSlot />} /><Route path="admin-business-dashboard" element={<StaffRouteSlot />} /><Route path="access-management" element={<StaffRouteSlot />} /><Route path="seller-principal-rate-policies" element={<StaffRouteSlot />} /><Route path="products" element={<StaffRouteSlot />} /><Route path="products/:productId" element={<StaffRouteSlot />} /><Route path="demands/:demandId/reservations" element={<StaffRouteSlot />} /><Route path="*" element={<DomainNotFound />} />
    </Route>
    <Route path="*" element={<DomainNotFound />} />
  </Routes>;
}

export function App(): React.JSX.Element {
  if (isReviewRuntime()) {
    return <QueryClientProvider client={reviewQueryClient}><BrowserRouter basename="/review"><ReviewRuntimeProvider><AppShell><ReviewChrome><ReviewRoutes /></ReviewChrome></AppShell></ReviewRuntimeProvider></BrowserRouter></QueryClientProvider>;
  }
  return <QueryClientProvider client={queryClient}><BrowserRouter><AppShell><AppRoutes /></AppShell></BrowserRouter></QueryClientProvider>;
}
