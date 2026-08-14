// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../test/msw/lifecycle';
import { StaffSessionBoundary } from '../auth/staff/StaffSessionBoundary';
import { queryKeys } from '../api/query-client';
import { apiUrl } from '../test/msw/handlers';
import { renderWithMsw } from '../test/msw/render';
import { server } from '../test/msw/server';
import { FrozenStaffWorkbench } from './FrozenStaffWorkbench';
import { staffWorkbenchKeys } from './queries/keys';
import { staffTestAdapter, staffTestSession, staffTestWorkItem } from './test-fixtures';

afterEach(cleanup);

const demandWorkItem = {
  ...staffTestWorkItem,
  work_item_id: 'work-demand', work_type: 'DEMAND_REVIEW' as const,
  source_entity_type: 'DEMAND_BATCH', source_entity_id: 'demand-1',
};

const demandReviewContext = {
  demand_batch_id: 'demand-1', demand_version: 3, status: 'SUBMITTED',
  seller_organization_id: 'seller-1', store_id: 'store-1',
  product_id: 'product-1', product_version_no: 2, product_name: '月光产品',
  task_type: 'IMAGE', target_quantity: 20,
  reservation_deadline: 1_787_000_000_000, order_deadline: 1_788_000_000_000,
  cadence: { order_interval_days: 2, orders_per_run: 5 }, can_publish: true,
  timezone: 'Asia/Shanghai', data_as_of: 1_787_000_000_000,
};

const refundWorkItem = {
  ...staffTestWorkItem,
  work_item_id: 'work-refund', work_type: 'BUYER_REFUND_PROCESSING' as const,
  source_entity_type: 'BUYER_REFUND_OBLIGATION', source_entity_id: 'refund-1',
  duty_code: 'BUYER_REFUND_OWNER' as const,
};

const buyerRefund = {
  obligation_id: 'refund-1', buyer_customer_id: 'buyer-1', formal_order_id: 'order-1',
  due_amount_cny_fen: '10000', gross_paid_cny_fen: '5000', reversed_cny_fen: '0',
  net_paid_cny_fen: '5000', outstanding_amount_cny_fen: '5000', overpaid_amount_cny_fen: '0',
  status: 'PARTIALLY_PAID' as const, version: 2, created_at: 1_787_000_000_000,
  updated_at: 1_787_000_000_000, buyer: { buyer_customer_id: 'buyer-1', buyer_customer_no: 'B-1' },
  order: { formal_order_id: 'order-1', marketplace: 'JP' as const,
    amazon_order_number_normalized: '503-5555555-6666666', product_id: 'product-1', asin: 'B000000001' },
  workflow: { work_item_id: 'work-refund', assigned_staff_id: 'staff-1', assigned_team_id: null,
    fixed_assignment_id: 'assignment-1' }, source_review_event_id: 'review-event-1', review_case_id: 'review-1',
  payments: [{ payment_entry_id: 'payment-1', amount_cny_fen: '5000', paid_at: 1_787_000_000_000,
    china_business_date: '2026-08-12', payment_channel: 'WECHAT' as const, public_note: null,
    internal_note: null, proofs: [] }], reversals: [],
};

describe('canonical Frozen Staff workbench', () => {
  it('keeps the scoped queue usable when the selected detail is concealed', async () => {
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({ data: { work_items: [staffTestWorkItem], next_cursor: null }, meta: { request_id: 'queue-request' } })),
      http.get(apiUrl('/api/staff/order-evidence/evidence-1'), () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'not found', details: null }, meta: { request_id: 'detail-hidden' } }, { status: 404 })),
    );
    const user = userEvent.setup();
    renderWorkbench('/staff?status=OPEN');
    expect(await screen.findByRole('button', { name: /订单资料核对/u })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /订单资料核对/u }));
    expect(await screen.findByText('资源不存在或无权访问')).toBeVisible();
    expect(screen.getByText(/detail-hidden/u)).toBeVisible();
    expect(screen.getByRole('button', { name: /订单资料核对/u })).toBeVisible();
  });

  it('does not infer a total when an opaque next cursor exists', async () => {
    server.use(http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({ data: { work_items: [staffTestWorkItem], next_cursor: 'opaque-next' }, meta: { request_id: 'queue-request' } })));
    renderWorkbench('/staff');
    expect(await screen.findByRole('button', { name: /订单资料核对/u })).toBeVisible();
    expect(screen.queryByText(/共 1|总计 1/u)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled();
  });

  it.each([
    ['returns 403', () => HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'forbidden', details: null }, meta: { request_id: 'queue-forbidden' } }, { status: 403 })],
    ['returns an invalid envelope', () => HttpResponse.json({ data: { work_items: 'not-an-array', next_cursor: null }, meta: { request_id: 'queue-invalid-envelope' } })],
  ])('removes a cached selected detail when the current queue %s', async (_case, failedQueue) => {
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({ data: { work_items: [demandWorkItem], next_cursor: null }, meta: { request_id: 'queue-initial' } })),
      http.get(apiUrl('/api/staff/demand-batches/demand-1/review-context'), () => HttpResponse.json({ data: { review_context: demandReviewContext }, meta: { request_id: 'demand-context' } })),
    );
    const { client }=renderWorkbench('/staff?work_item=work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    server.use(http.get(apiUrl('/api/staff/me/work-items'), failedQueue));

    await client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });

    expect(await screen.findByRole('alert')).toHaveTextContent('当前面板加载失败');
    expect(screen.getByText('请选择工作项')).toBeVisible();
    expect(screen.queryByText('需求发布事实')).not.toBeInTheDocument();
  });

  it('publishes a demand with its authoritative version, first date and idempotency key', async () => {
    let body: unknown;
    let key: string | null = null;
    installDemandHandlers(async (request) => {
      body = await request.json(); key = request.headers.get('Idempotency-Key');
      return HttpResponse.json({ data: { demand_review: {
        demand_batch_id: 'demand-1', status: 'PUBLISHED', version: 4, review_reason: null, replayed: false,
        schedule: { schedule_version_id: 'schedule-1', version_no: 1, demand_version: 4, first_order_date: '2026-08-11', theoretical_last_order_date: '2026-08-17', order_interval_days: 2, orders_per_run: 5, affected_reservation_count: 0, preview_hash: 'a'.repeat(64), change_reason: '首次发布需求', changed_by_staff_id: 'staff-1', created_at: 1_787_000_000_000 },
      } }, meta: { request_id: 'demand-published' } });
    });
    const user = userEvent.setup();
    renderWorkbench('/staff?work_item=work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    expect(screen.getByText('月光产品 · v2')).toBeVisible();
    expect(screen.getByText('每 2 天 / 5 单')).toBeVisible();
    await user.type(screen.getByLabelText('首个下单日期'), '2026-08-11');
    await user.click(screen.getByRole('button', { name: '通过并发布' }));
    await waitFor(() => expect(body).toEqual({ expected_version: 3, decision: 'PUBLISH', first_order_date: '2026-08-11' }));
    expect(key).toMatch(/\S/u);
  });

  it('retains the selected demand context after its authoritative mutation removes it from the filtered queue', async () => {
    let queueReads=0;let published=false;
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), () => {
        queueReads+=1;
        return HttpResponse.json({ data: { work_items: published?[]:[demandWorkItem], next_cursor: null }, meta: { request_id: `queue-${queueReads}` } });
      }),
      http.get(apiUrl('/api/staff/demand-batches/demand-1/review-context'), () => HttpResponse.json({ data: { review_context: demandReviewContext }, meta: { request_id: 'demand-context' } })),
      http.post(apiUrl('/api/staff/demand-batches/demand-1/review'), () => {
        published=true;
        return HttpResponse.json({ data: { demand_review: { demand_batch_id: 'demand-1', status: 'PUBLISHED', version: 4, review_reason: null, replayed: false, schedule: null } }, meta: { request_id: 'demand-published' } });
      }),
    );
    const user=userEvent.setup();
    renderWorkbench('/staff?work_item=work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    await user.type(screen.getByLabelText('首个下单日期'), '2026-08-11');
    await user.click(screen.getByRole('button', { name: '通过并发布' }));
    await waitFor(()=>expect(queueReads).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText('需求审核结果')).toBeVisible();
    expect(screen.getByText('PUBLISHED')).toBeVisible();
    expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
    expect(screen.queryByText('请选择工作项')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('状态'), 'COMPLETED');
    expect(await screen.findByText('请选择工作项')).toBeVisible();
  });

  it('clears retained selection and refetches the same queue when the trusted Staff authorization changes', async () => {
    let queueReads=0;let published=false;
    const initialSession=staffTestSession('owner', ['SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD', 'FINANCIAL_CORRECT']);
    let currentSession=initialSession;
    const adapter={...staffTestAdapter(initialSession),readSession:async()=>({data:{session:currentSession},requestId:`session-v${currentSession.authorization_version}`})};
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), () => {
        queueReads+=1;
        return HttpResponse.json({ data: { work_items: published?[]:[demandWorkItem], next_cursor: null }, meta: { request_id: `queue-${queueReads}` } });
      }),
      http.get(apiUrl('/api/staff/demand-batches/demand-1/review-context'), () => HttpResponse.json({ data: { review_context: demandReviewContext }, meta: { request_id: 'demand-context' } })),
      http.post(apiUrl('/api/staff/demand-batches/demand-1/review'), () => {
        published=true;
        return HttpResponse.json({ data: { demand_review: { demand_batch_id: 'demand-1', status: 'PUBLISHED', version: 4, review_reason: null, replayed: false, schedule: null } }, meta: { request_id: 'demand-published' } });
      }),
    );
    const user=userEvent.setup();
    const {client}=renderWorkbench('/staff?work_item=work-demand',adapter);
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    await user.type(screen.getByLabelText('首个下单日期'), '2026-08-11');
    await user.click(screen.getByRole('button', { name: '通过并发布' }));
    await waitFor(()=>expect(queueReads).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText('需求审核结果')).toBeVisible();

    currentSession={...initialSession,authorization_version:2};
    await client.invalidateQueries({queryKey:queryKeys.staff.session});

    expect(await screen.findByText('请选择工作项')).toBeVisible();
    await waitFor(()=>expect(queueReads).toBeGreaterThanOrEqual(3));
    expect(screen.queryByText('需求审核结果')).not.toBeInTheDocument();
  });

  it('rejects a demand through the dedicated review action', async () => {
    let body: unknown;
    installDemandHandlers(async (request) => {
      body = await request.json();
      return HttpResponse.json({ data: { demand_review: { demand_batch_id: 'demand-1', status: 'REJECTED', version: 4, review_reason: '资料需要补充', schedule: null, replayed: false } }, meta: { request_id: 'demand-rejected' } });
    });
    const user = userEvent.setup();
    renderWorkbench('/staff?work_item=work-demand');
    await screen.findByText('需求发布事实');
    await user.type(screen.getByLabelText('拒绝原因'), '资料需要补充');
    await user.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => expect(body).toEqual({ expected_version: 3, decision: 'REJECT', rejection_reason: '资料需要补充' }));
  });

  it('lets a base demand reviewer reject while hiding publication', async () => {
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({ data: { work_items: [demandWorkItem], next_cursor: null }, meta: { request_id: 'queue-demand' } })),
      http.get(apiUrl('/api/staff/demand-batches/demand-1/review-context'), () => HttpResponse.json({ data: { review_context: { ...demandReviewContext, can_publish: false } }, meta: { request_id: 'demand-context-base' } })),
    );
    renderWorkbench('/staff?work_item=work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    expect(screen.queryByLabelText('首个下单日期')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeVisible();
  });

  it('keeps refund confirmation disabled while a financial request is pending', async () => {
    let requestCount=0;let finish:()=>void=()=>{};
    const gate=new Promise<void>((resolve)=>{finish=resolve;});
    installRefundHandlers(async()=>{requestCount+=1;await gate;return refundConflict();});
    const user=userEvent.setup();
    renderWorkbench('/staff?work_item=work-refund');

    await user.click(await screen.findByRole('button',{name:'冲正'}));
    await user.click(screen.getByRole('button',{name:'确认'}));
    expect(await screen.findByRole('button',{name:'处理中…'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'取消'})).toBeDisabled();
    screen.getByRole('button',{name:'处理中…'}).click();
    expect(requestCount).toBe(1);
    finish();
    expect(await screen.findByText('返款操作未完成。系统不会自动创建第二笔付款，请按错误类型重试原请求或刷新返款事实。')).toBeVisible();
  });

  it('shows the request id and a server-fact refresh after a rejected refund mutation', async () => {
    installRefundHandlers(async()=>refundConflict());
    const user=userEvent.setup();
    renderWorkbench('/staff?work_item=work-refund');

    await user.click(await screen.findByRole('button',{name:'冲正'}));
    await user.click(screen.getByRole('button',{name:'确认'}));
    expect(await screen.findByText(/refund-version-conflict/u)).toBeVisible();
    expect(screen.getByRole('button',{name:'刷新返款事实'})).toBeVisible();
  });
});

function renderWorkbench(route: string, adapter = staffTestAdapter(staffTestSession('owner', ['SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD', 'FINANCIAL_CORRECT']))) {
  return renderWithMsw(<StaffSessionBoundary adapter={adapter}><FrozenStaffWorkbench /></StaffSessionBoundary>, { route });
}

function installDemandHandlers(
  mutation: (request: Request) => Promise<Response>,
): void {
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({ data: { work_items: [demandWorkItem], next_cursor: null }, meta: { request_id: 'queue-demand' } })),
    http.get(apiUrl('/api/staff/demand-batches/demand-1/review-context'), () => HttpResponse.json({ data: { review_context: demandReviewContext }, meta: { request_id: 'demand-context' } })),
    http.post(apiUrl('/api/staff/demand-batches/demand-1/review'), ({ request }) => mutation(request)),
  );
}

function installRefundHandlers(mutation:()=>Promise<Response>):void{
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'),()=>HttpResponse.json({data:{work_items:[refundWorkItem],next_cursor:null},meta:{request_id:'queue-refund'}})),
    http.get(apiUrl('/api/staff/buyer-refunds/refund-1'),()=>HttpResponse.json({data:{buyer_refund:buyerRefund},meta:{request_id:'refund-detail'}})),
    http.post(apiUrl('/api/staff/buyer-refunds/refund-1/payments/payment-1/reversals'),()=>mutation()),
  );
}

function refundConflict():Response{return HttpResponse.json({error:{code:'VERSION_CONFLICT',message:'version conflict',details:null},meta:{request_id:'refund-version-conflict'}},{status:409});}
