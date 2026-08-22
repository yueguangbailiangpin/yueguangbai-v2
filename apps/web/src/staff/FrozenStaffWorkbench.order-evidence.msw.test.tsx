// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../test/msw/lifecycle';
import { StaffSessionBoundary } from '../auth/staff/StaffSessionBoundary';
import { apiUrl } from '../test/msw/handlers';
import { renderWithMsw } from '../test/msw/render';
import { server } from '../test/msw/server';
import { FrozenStaffWorkbench } from './FrozenStaffWorkbench';
import { staffTestAdapter, staffTestSession, staffTestWorkItem } from './test-fixtures';

afterEach(cleanup);

const orderEvidence = {
  submission_id: 'evidence-1',
  reservation_id: 'reservation-1',
  marketplace: 'JP' as const,
  status: 'PENDING_VERIFICATION' as const,
  version: 1,
  evidence_version_no: 1,
  amazon_order_number_raw: '250-7817503-1235036',
  amazon_order_number_normalized: '250-7817503-1235036',
  amazon_order_date: '2026-08-22',
  final_paid_jpy: '2999',
  buyer_note: null,
  public_change_reason: null,
  submitted_at: 1_787_000_000_000,
  updated_at: 1_787_000_000_000,
  verified_at: null,
  withdrawn_at: null,
  buyer_customer_id: 'buyer-1',
  internal_review_note: null,
  verified_by_staff_id: null,
  duplicate_signal_count: 0,
  reference_order_amount_jpy: '2999',
  price_difference_jpy: '0',
  price_mismatch: false,
  screenshot: {
    file_object_id: 'screenshot-1',
    file_version: 1,
    purpose: 'ORDER_EVIDENCE' as const,
    visibility: 'BUYER_VISIBLE' as const,
  },
  buyer: { buyer_customer_id: 'buyer-1', buyer_customer_no: null },
  instruction: {
    instruction_id: 'instruction-1',
    instruction_version_id: 'instruction-version-1',
    buyer_self_pay_bps: 0,
    buyer_self_pay_jpy: '0',
    buyer_refundable_principal_jpy: '2999',
  },
  reservation: {
    reservation_id: 'reservation-1',
    status: 'ORDER_EVIDENCE_SUBMITTED',
    version: 4,
  },
  version_history: [{
    evidence_version_id: 'evidence-version-1',
    version_no: 1,
    final_paid_jpy: '2999',
    submitted_at: 1_787_000_000_000,
  }],
  workflow: {
    work_item_id: 'work-1',
    assigned_staff_id: 'staff-1',
    assigned_team_id: null,
    fixed_assignment_id: 'assignment-1',
  },
};

const approval = {
  formal_order_id: 'formal-order-1',
  order_evidence_submission_id: 'evidence-1',
  status: 'CONFIRMED' as const,
  version: 1,
  reference_order_amount_jpy: '2999',
  final_paid_jpy: '2999',
  price_difference_jpy: '0',
  price_mismatch_acknowledged: false,
  confirmed_at: 1_787_000_100_000,
  replayed: false,
};

describe('Staff order evidence review closure', () => {
  it('closes a successfully approved work item without re-reading completed facts', async () => {
    let completed = false;
    let detailReads = 0;
    let queueReads = 0;
    let requestBody: unknown;
    let idempotencyKey: string | null = null;
    installOrderHandlers({
      queue: () => {
        queueReads += 1;
        return completed ? [] : [staffTestWorkItem];
      },
      detail: () => {
        detailReads += 1;
        return orderEvidence;
      },
      mutate: async (request) => {
        requestBody = await request.json();
        idempotencyKey = request.headers.get('Idempotency-Key');
        completed = true;
        return HttpResponse.json({
          data: approval,
          meta: { request_id: 'order-approved' },
        });
      },
    });
    const user = userEvent.setup();
    renderWorkbench();
    expect(await screen.findByText('订单资料')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '通过' }));

    expect(await screen.findByText('请选择工作项')).toBeVisible();
    await waitFor(() => expect(queueReads).toBeGreaterThanOrEqual(2));
    expect(detailReads).toBe(1);
    expect(requestBody).toEqual({ expected_version: 1 });
    expect(idempotencyKey).toMatch(/\S/u);
  });

  it('shows the safe prerequisite code, actionable hint and request id', async () => {
    installOrderHandlers({
      mutate: async () => HttpResponse.json(
        {
          error: {
            code: 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND',
            message: 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND',
            details: null,
          },
          meta: { request_id: 'order-missing-rate' },
        },
        { status: 404 },
      ),
    });
    const user = userEvent.setup();
    renderWorkbench();
    expect(await screen.findByText('订单资料')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '通过' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('缺少订单日期对应的买家日汇率');
    expect(alert).toHaveTextContent('错误码：BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND');
    expect(screen.getByText(/order-missing-rate/u)).toBeVisible();
    expect(screen.getByRole('button', { name: '刷新订单事实' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '重试原请求' })).not.toBeInTheDocument();
  });

  it('retries an ambiguous approval with the identical body and idempotency key', async () => {
    let completed = false;
    let attempts = 0;
    const keys: string[] = [];
    const bodies: unknown[] = [];
    installOrderHandlers({
      queue: () => completed ? [] : [staffTestWorkItem],
      mutate: async (request) => {
        attempts += 1;
        keys.push(request.headers.get('Idempotency-Key') ?? '');
        bodies.push(await request.json());
        if (attempts === 1) return HttpResponse.error();
        completed = true;
        return HttpResponse.json({
          data: { ...approval, replayed: true },
          meta: { request_id: 'order-approved-replay' },
        });
      },
    });
    const user = userEvent.setup();
    renderWorkbench();
    expect(await screen.findByText('订单资料')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '通过' }));
    await user.click(await screen.findByRole('button', { name: '重试原请求' }));

    expect(await screen.findByText('请选择工作项')).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(bodies).toEqual([{ expected_version: 1 }, { expected_version: 1 }]);
  });

  it('closes a successful request-changes decision because its work item is complete', async () => {
    let completed = false;
    let path = '';
    let requestBody: unknown;
    installOrderHandlers({
      queue: () => completed ? [] : [staffTestWorkItem],
      mutate: async (request) => {
        path = new URL(request.url).pathname;
        requestBody = await request.json();
        completed = true;
        return HttpResponse.json({
          data: {
            submission_id: 'evidence-1',
            reservation_id: 'reservation-1',
            buyer_customer_id: 'buyer-1',
            marketplace: 'JP',
            status: 'CHANGES_REQUESTED',
            version: 2,
            current_evidence_version_no: 1,
            current_evidence_version_id: 'evidence-version-1',
            replayed: false,
            public_change_reason: '订单截图不完整',
          },
          meta: { request_id: 'order-changes-requested' },
        });
      },
    });
    const user = userEvent.setup();
    renderWorkbench();
    expect(await screen.findByText('订单资料')).toBeVisible();
    await user.type(screen.getByLabelText('要求修改原因'), '订单截图不完整');
    await user.click(screen.getByRole('button', { name: '要求修改' }));

    expect(await screen.findByText('请选择工作项')).toBeVisible();
    expect(path).toBe('/api/staff/order-evidence/evidence-1/request-changes');
    expect(requestBody).toEqual({
      expected_version: 1,
      public_reason: '订单截图不完整',
    });
  });
});

function renderWorkbench() {
  return renderWithMsw(
    <StaffSessionBoundary
      adapter={staffTestAdapter(staffTestSession('owner', ['ORDER_VIEW', 'ORDER_CONFIRM']))}
    >
      <FrozenStaffWorkbench />
    </StaffSessionBoundary>,
    { route: '/staff?work_item=work-1' },
  );
}

function installOrderHandlers(options: {
  queue?: () => typeof staffTestWorkItem[];
  detail?: () => typeof orderEvidence;
  mutate: (request: Request) => Promise<Response>;
}): void {
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({
      data: {
        work_items: options.queue?.() ?? [staffTestWorkItem],
        next_cursor: null,
      },
      meta: { request_id: 'order-queue' },
    })),
    http.get(apiUrl('/api/staff/order-evidence/evidence-1'), () => HttpResponse.json({
      data: { order_evidence: options.detail?.() ?? orderEvidence },
      meta: { request_id: 'order-detail' },
    })),
    http.post(apiUrl('/api/staff/order-evidence/evidence-1/approve'), ({ request }) =>
      options.mutate(request)),
    http.post(apiUrl('/api/staff/order-evidence/evidence-1/request-changes'), ({ request }) =>
      options.mutate(request)),
  );
}
