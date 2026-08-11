import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { CustomerAuthApiAdapter, CustomerSession, CustomerTarget } from '../auth/customer/customer-auth-api';
import type { StaffAuthApiAdapter, StaffSession } from '../auth/staff/staff-auth-api';
import { Select } from '../ui/primitives';

export const SELLER_REVIEW_ROLES = ['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER'] as const;
export const STAFF_REVIEW_ROLES = ['owner', 'acquisition', 'pre_sales', 'seller_ops', 'buyer_refund'] as const;
export type SellerReviewRole = typeof SELLER_REVIEW_ROLES[number];
export type StaffReviewRole = typeof STAFF_REVIEW_ROLES[number];

let sellerRole: SellerReviewRole = 'OWNER';
let staffRole: StaffReviewRole = 'owner';

export function isReviewRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname === '/review' || window.location.pathname.startsWith('/review/');
}

export function currentSellerReviewRole(): SellerReviewRole { return sellerRole; }
export function currentStaffReviewRole(): StaffReviewRole { return staffRole; }

const staffRoleDisplay = {
  owner: '总管理员', acquisition: '获客', pre_sales: '售前', seller_ops: '卖家对接', buyer_refund: '买家返款',
} as const;

function customerSession(target: CustomerTarget): CustomerSession {
  return {
    account_id: `review-${target}-account`, identity_subject_id: 'review-customer-multi-persona',
    account_type: target === 'buyer' ? 'BUYER' : 'SELLER_MEMBER',
    available_personas: ['BUYER', 'SELLER_MEMBER'], session_version: 1,
    password_change_required: false, issued_at: 1_786_368_000_000, expires_at: 4_102_444_800_000,
  };
}

export function reviewCustomerAuthApi(target: CustomerTarget): CustomerAuthApiAdapter {
  const result = () => Promise.resolve({ data: { session: customerSession(target) }, requestId: `review-${target}-session` });
  return Object.freeze({
    login: () => result(), readSession: () => result(), changePassword: () => result(),
    logout: () => Promise.resolve({ data: { logged_out: true as const, all_devices_logged_out: false as const }, requestId: 'review-customer-logout' }),
  });
}

export function reviewStaffSession(): StaffSession {
  const owner = staffRole === 'owner';
  const permissions = owner
    ? ['FINANCIAL_VIEW', 'FINANCIAL_CORRECT', 'STAFF_MANAGE', 'SELLER_MANAGE', 'PRODUCT_VIEW', 'WORK_QUEUE_VIEW']
    : staffRole === 'seller_ops'
      ? ['SELLER_MANAGE', 'PRODUCT_VIEW', 'WORK_QUEUE_VIEW']
      : staffRole === 'pre_sales'
        ? ['PRODUCT_VIEW', 'WORK_QUEUE_VIEW']
        : staffRole === 'buyer_refund' ? ['WORK_QUEUE_VIEW', 'BUYER_REFUND_PROCESS'] : ['ACQUISITION_MANAGE'];
  return {
    staff_id: `review-staff-${staffRole}`, display_name: `Demo ${staffRoleDisplay[staffRole]}`,
    role: { code: staffRole, display_name: staffRoleDisplay[staffRole] } as StaffSession['role'],
    permissions,
    data_scope: owner
      ? { type: 'GLOBAL', marketplaceCodes: [], buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [] }
      : { type: 'MARKETPLACE', marketplaceCodes: ['AMAZON_JP'], buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [] },
    authorization_version: STAFF_REVIEW_ROLES.indexOf(staffRole) + 1, session_version: 1, expires_at: 4_102_444_800_000,
  };
}

export const reviewStaffAuthApi: StaffAuthApiAdapter = Object.freeze({
  readSession: () => Promise.resolve({ data: { session: reviewStaffSession() }, requestId: 'review-staff-session' }),
  bootstrap: () => Promise.resolve({ data: { session: reviewStaffSession(), access_email: 'review@example.invalid' }, requestId: 'review-staff-bootstrap' }),
  logout: () => Promise.resolve({ data: { logged_out: true as const, all_devices_logged_out: false as const }, requestId: 'review-staff-logout' }),
  logoutAll: () => Promise.resolve({ data: { logged_out: true as const, all_devices_logged_out: true as const, session_version: 2 }, requestId: 'review-staff-logout-all' }),
});

type ReviewRuntimeValue = Readonly<{
  revision: number;
  sellerRole: SellerReviewRole;
  staffRole: StaffReviewRole;
  chooseSellerRole: (role: SellerReviewRole) => void;
  chooseStaffRole: (role: StaffReviewRole) => void;
}>;
const ReviewRuntimeContext = createContext<ReviewRuntimeValue | null>(null);

export function useReviewRuntime(): ReviewRuntimeValue {
  const value = useContext(ReviewRuntimeContext);
  if (!value) throw new Error('review_runtime_context_unavailable');
  return value;
}

export function ReviewRuntimeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const client = useQueryClient();
  const [revision, setRevision] = useState(0);
  const [selectedSellerRole, setSelectedSellerRole] = useState<SellerReviewRole>(sellerRole);
  const [selectedStaffRole, setSelectedStaffRole] = useState<StaffReviewRole>(staffRole);
  const value = useMemo<ReviewRuntimeValue>(() => ({
    revision, sellerRole: selectedSellerRole, staffRole: selectedStaffRole,
    chooseSellerRole: (role) => {
      sellerRole = role; setSelectedSellerRole(role); client.clear(); setRevision((current) => current + 1);
    },
    chooseStaffRole: (role) => {
      staffRole = role; setSelectedStaffRole(role); client.clear(); setRevision((current) => current + 1);
    },
  }), [client, revision, selectedSellerRole, selectedStaffRole]);
  return <ReviewRuntimeContext.Provider value={value}>{children}</ReviewRuntimeContext.Provider>;
}

export function ReviewChrome({ children }: { children: ReactNode }): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const runtime = useReviewRuntime();
  const seller = location.pathname.startsWith('/seller');
  const staff = location.pathname.startsWith('/staff');
  return <div className="review-runtime">
    <header className="review-mode-bar">
      <Link to="/" className="review-mode-label">前端评审 · Demo 数据</Link>
      {seller ? <label>卖家角色<Select aria-label="卖家评审角色" value={runtime.sellerRole} onChange={(event) => runtime.chooseSellerRole(event.target.value as SellerReviewRole)}>{SELLER_REVIEW_ROLES.map((role) => <option key={role}>{role}</option>)}</Select></label> : null}
      {staff ? <label>评审角色<Select aria-label="员工评审角色" value={runtime.staffRole} onChange={(event) => { runtime.chooseStaffRole(event.target.value as StaffReviewRole); void navigate('/staff'); }}>{STAFF_REVIEW_ROLES.map((role) => <option key={role}>{role}</option>)}</Select></label> : null}
    </header>
    <div key={`${runtime.revision}:${seller ? 'seller' : staff ? 'staff' : 'buyer'}`}>{children}</div>
  </div>;
}

export function reviewBuildSha(): string {
  const value = import.meta.env['VITE_REVIEW_BUILD_SHA'];
  return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value) ? value : 'LOCAL';
}
