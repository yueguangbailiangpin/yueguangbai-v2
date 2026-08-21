// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import type { StaffAuthApiAdapter, StaffSession } from '../../auth/staff/staff-auth-api';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { ProductSchedulingWorkspace } from './ProductSchedulingWorkspace';

afterEach(cleanup);

describe('产品预约排期工作区', () => {
  it('labels the reset-cursor action as returning to the first page', async () => {
    server.use(http.get(apiUrl('/api/staff/catalog/products'), () => HttpResponse.json({ data: { page: {
      items: [{ product_id: 'product-1', seller_organization_id: 'seller-1', store_id: 'store-1',
        store_name: '测试店铺', marketplace_code: 'US', asin: 'B000TEST', status: 'ACTIVE',
        aggregate_version: 1, current_version_no: 1, product_name: '测试产品',
        cadence: { order_interval_days: 7, orders_per_run: 1 }, updated_at: 1 }],
      next_cursor: 'cursor-2', data_as_of: 1,
    } }, meta: { request_id: 'products' } })));
    renderWorkspace(owner(), '/staff/products?cursor=cursor-1');
    expect(await screen.findByRole('button', { name: '返回第一页' })).toBeEnabled();
  });

  it('shows scoped identity and requires preview before schedule confirmation', async () => {
    let confirmBody: Record<string, unknown>|null = null;
    server.use(
      http.get(apiUrl('/api/staff/demand-batches/demand-1/reservation-schedule'), () =>
        HttpResponse.json({ data: { page: schedulePage() }, meta: { request_id: 'page' } })),
      http.post(apiUrl('/api/staff/demand-batches/demand-1/schedule/preview'), () =>
        HttpResponse.json({ data: { preview: preview() }, meta: { request_id: 'preview' } })),
      http.post(apiUrl('/api/staff/demand-batches/demand-1/schedule/confirm'), async ({ request }) => {
        confirmBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ data: { schedule_confirmation: {
          demand_batch_id: 'demand-1', demand_version: 5,
          schedule: schedule(), replayed: false,
        } }, meta: { request_id: 'confirm' } });
      }),
    );
    const user = userEvent.setup();
    renderWorkspace(owner(), '/staff/demands/demand-1/reservations');
    expect(await screen.findByRole('table', { name: '预约排名与预计下单日期' })).toBeVisible();
    expect(screen.getByText('买家一')).toBeVisible();
    expect(screen.queryByText('买家二')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认新增排期版本' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('修改原因'), '调整活动节奏');
    await user.click(screen.getByRole('button', { name: '服务端预览影响' }));
    expect(await screen.findByText(/其中 2 人的预计日期会变化/u)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '确认新增排期版本' }));
    await waitFor(() => expect(confirmBody).not.toBeNull());
    expect(confirmBody).toMatchObject({
      expected_version: 4, first_order_date: '2026-08-10',
      order_interval_days: 1, orders_per_run: 2,
      reason: '调整活动节奏', preview_hash: 'a'.repeat(64),
    });
    expect(await screen.findByText(/排期新版本已确认/u)).toBeVisible();
  });

  it('does not request or expose schedule controls to buyer_refund', async () => {
    let requested = false;
    server.use(http.get(apiUrl('/api/staff/demand-batches/demand-1/reservation-schedule'), () => {
      requested = true;
      return HttpResponse.json({});
    }));
    renderWorkspace(buyerRefund(), '/staff/demands/demand-1/reservations');
    expect(await screen.findByText('当前角色无权查看产品排期')).toBeVisible();
    expect(screen.queryByLabelText('修改原因')).not.toBeInTheDocument();
    expect(requested).toBe(false);
  });

  it('shows product cadence controls only to owner or seller_ops with both permissions', async () => {
    server.use(http.get(apiUrl('/api/staff/catalog/products/product-1'), () =>
      HttpResponse.json({ data: { product: productDetail() }, meta: { request_id: 'product' } })));
    const cases = [
      { value: staffSession('buyer_refund', ['PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH']), visible: false },
      { value: staffSession('pre_sales', ['PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH']), visible: false },
      { value: staffSession('seller_ops', ['PRODUCT_VIEW', 'PRODUCT_REVIEW']), visible: false },
      { value: staffSession('seller_ops', ['PRODUCT_VIEW', 'DEMAND_PUBLISH']), visible: false },
      { value: staffSession('seller_ops', ['PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH']), visible: true },
    ];
    for (const testCase of cases) {
      renderWorkspace(testCase.value, '/staff/products/product-1');
      expect(await screen.findByText('当前产品版本')).toBeVisible();
      if (testCase.visible) expect(screen.getByRole('heading', { name: '新增版本' })).toBeVisible();
      else expect(screen.queryByRole('heading', { name: '新增版本' })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('retries product version creation from the main submit with the exact original body and key', async () => {
    const calls: Array<{ body: unknown; key: string|null }> = [];
    server.use(
      http.get(apiUrl('/api/staff/catalog/products/product-1'), () =>
        HttpResponse.json({ data: { product: productDetail() }, meta: { request_id: 'product' } })),
      http.post(apiUrl('/api/staff/catalog/products/product-1/versions'), async ({ request }) => {
        calls.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
        if (calls.length === 1) return HttpResponse.error();
        return HttpResponse.json({ data: { product_version: productVersionResult(calls.length) },
          meta: { request_id: `product-version-${calls.length}` } });
      }),
    );
    const user = userEvent.setup();
    renderWorkspace(owner(), '/staff/products/product-1');
    await screen.findByRole('heading', { name: '新增版本' });
    await user.click(screen.getByRole('button', { name: '保存为新版本' }));
    expect(await screen.findByRole('button', { name: '重试' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '保存为新版本' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual(calls[0]);
    expect(await screen.findByText(/新产品版本已保存/u)).toBeVisible();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存为新版本' }));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]!.key).not.toBe(calls[0]!.key);
  });

  it('uses a new product version key only after an actual form change', async () => {
    const calls: Array<{
      body: { version: { product_name: string } } & Record<string, unknown>;
      key: string|null;
    }> = [];
    server.use(
      http.get(apiUrl('/api/staff/catalog/products/product-1'), () =>
        HttpResponse.json({ data: { product: productDetail() }, meta: { request_id: 'product' } })),
      http.post(apiUrl('/api/staff/catalog/products/product-1/versions'), async ({ request }) => {
        calls.push({ body: await request.json() as {
          version: { product_name: string };
        } & Record<string, unknown>,
          key: request.headers.get('Idempotency-Key') });
        if (calls.length === 1) return HttpResponse.error();
        return HttpResponse.json({ data: { product_version: productVersionResult(calls.length) },
          meta: { request_id: 'product-version-changed' } });
      }),
    );
    const user = userEvent.setup();
    renderWorkspace(owner(), '/staff/products/product-1');
    const productName = await screen.findByLabelText('产品名称');
    await user.click(screen.getByRole('button', { name: '保存为新版本' }));
    expect(await screen.findByRole('button', { name: '重试' })).toBeVisible();
    await user.clear(productName); await user.type(productName, '修改后的产品');
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存为新版本' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.key).not.toBe(calls[0]!.key);
    expect(calls[0]!.body.version.product_name).toBe('测试产品');
    expect(calls[1]!.body.version.product_name).toBe('修改后的产品');
  });

  it('routes Enter and the dedicated retry through the same retained product request', async () => {
    const calls: Array<{ body: unknown; key: string|null }> = [];
    server.use(
      http.get(apiUrl('/api/staff/catalog/products/product-1'), () =>
        HttpResponse.json({ data: { product: productDetail() }, meta: { request_id: 'product' } })),
      http.post(apiUrl('/api/staff/catalog/products/product-1/versions'), async ({ request }) => {
        calls.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
        if (calls.length < 3) return HttpResponse.error();
        return HttpResponse.json({ data: { product_version: productVersionResult(calls.length) },
          meta: { request_id: 'product-version-enter-retry' } });
      }),
    );
    const user = userEvent.setup();
    renderWorkspace(owner(), '/staff/products/product-1');
    const productName = await screen.findByLabelText('产品名称');
    await user.click(screen.getByRole('button', { name: '保存为新版本' }));
    expect(await screen.findByRole('button', { name: '重试' })).toBeVisible();
    productName.focus(); await user.keyboard('{Enter}');
    await waitFor(() => expect(calls).toHaveLength(2));
    const retry = screen.getByRole('button', { name: '重试' });
    await waitFor(() => expect(retry).toBeEnabled());
    await user.click(retry);
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);
    expect(await screen.findByText(/新产品版本已保存/u)).toBeVisible();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('shows the bound main image with a protected view entry', async () => {
    server.use(http.get(apiUrl('/api/staff/catalog/products/product-1'), () =>
      HttpResponse.json({
        data: { product: productDetail({
          file_object_id: 'product-image-1', file_version: 2,
          client_file_name: 'main.webp', bound_at: 1_786_161_600_000,
        }) },
        meta: { request_id: 'product' },
      })));
    renderWorkspace(owner(), '/staff/products/product-1');
    expect(await screen.findByRole('heading', { name: /当前版本主图/u })).toBeVisible();
    expect(screen.getByText('main.webp')).toBeVisible();
    expect(screen.getByRole('button', { name: '查看主图' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '选择主图' })).not.toBeInTheDocument();
    expect(screen.getByText(/不可改写/u)).toBeVisible();
  });

  it('uploads and binds a main image for the unbound current version', async () => {
    const calls: Array<{ body: unknown; key: string | null }> = [];
    let bound = false;
    server.use(
      http.get(apiUrl('/api/staff/catalog/products/product-1'), () =>
        HttpResponse.json({
          data: { product: productDetail(bound ? {
            file_object_id: 'product-image-1', file_version: 2,
            client_file_name: 'main.png', bound_at: 1_786_161_600_001,
          } : null) },
          meta: { request_id: 'product' },
        })),
      http.post(apiUrl('/api/staff/file-uploads/product-images/intents'), () =>
        HttpResponse.json({
          data: {
            upload_intent_id: 'product-image-intent-1',
            purpose: 'PRODUCT_IMAGE', visibility: 'SELLER_VISIBLE',
            status: 'ISSUED', version: 1, expires_at: 1_900_000_000_000,
            uploads: [{
              file_object_id: 'product-image-1', slot_no: 1,
              upload_token: 'x'.repeat(40), upload_token_available: true,
              expires_at: 1_900_000_000_000,
            }],
            replayed: false,
          },
          meta: { request_id: 'image-intent' },
        })),
      http.put(apiUrl('/api/staff/file-uploads/product-image-1/content'), () =>
        HttpResponse.json({
          data: {
            file_object_id: 'product-image-1',
            upload_intent_id: 'product-image-intent-1', status: 'UPLOADED',
            detected_mime: 'image/png', byte_size: 5, sha256: 'a'.repeat(64),
            version: 2, replayed: false,
          },
          meta: { request_id: 'image-content' },
        })),
      http.post(apiUrl('/api/staff/file-upload-intents/product-image-intent-1/complete'), () =>
        HttpResponse.json({
          data: {
            upload_intent_id: 'product-image-intent-1', status: 'VERIFIED',
            version: 2,
            files: [{
              file_object_id: 'product-image-1', purpose: 'PRODUCT_IMAGE',
              visibility: 'SELLER_VISIBLE', detected_mime: 'image/png',
              byte_size: 5, sha256: 'a'.repeat(64), version: 3,
            }],
            replayed: false,
          },
          meta: { request_id: 'image-complete' },
        })),
      http.post(apiUrl('/api/staff/catalog/product-versions/version-2/main-image'), async ({ request }) => {
        calls.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
        bound = true;
        return HttpResponse.json({
          data: { main_image: {
            product_id: 'product-1', product_version_id: 'version-2',
            product_version_no: 2, file_entity_link_id: 'link-1',
            file_object_id: 'product-image-1', seller_organization_id: 'seller-1',
            store_id: 'store-1', authorization_mode: 'EXPLICIT_AUDIENCES',
            replayed: false,
          } },
          meta: { request_id: 'main-image-linked' },
        }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWorkspace(owner(), '/staff/products/product-1');
    expect(await screen.findByText(/尚未绑定主图/u)).toBeVisible();
    await user.upload(await screen.findByLabelText('产品主图'),
      new File(['image'], 'main.png', { type: 'image/png' }));
    expect(await screen.findByText('上传状态：VERIFIED')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '绑定为主图' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({
      file_object_id: 'product-image-1',
      expected_file_version: 3,
    });
    expect(calls[0]!.key).toMatch(/\S/u);
    expect(await screen.findByRole('button', { name: '查看主图' })).toBeVisible();
    expect(screen.getByText(/已绑定主图/u)).toBeVisible();
  });

  it('retries schedule confirmation from the main button with the exact original body and key', async () => {
    const calls: Array<{ body: unknown; key: string|null }> = [];
    server.use(
      http.get(apiUrl('/api/staff/demand-batches/demand-1/reservation-schedule'), () =>
        HttpResponse.json({ data: { page: schedulePage() }, meta: { request_id: 'page' } })),
      http.post(apiUrl('/api/staff/demand-batches/demand-1/schedule/preview'), () =>
        HttpResponse.json({ data: { preview: preview() }, meta: { request_id: 'preview' } })),
      http.post(apiUrl('/api/staff/demand-batches/demand-1/schedule/confirm'), async ({ request }) => {
        calls.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
        if (calls.length === 1) return HttpResponse.error();
        return HttpResponse.json({ data: { schedule_confirmation: scheduleConfirmation() },
          meta: { request_id: 'confirm-retry' } });
      }),
    );
    const user = userEvent.setup();
    renderWorkspace(owner(), '/staff/demands/demand-1/reservations');
    await screen.findByRole('table', { name: '预约排名与预计下单日期' });
    await user.type(screen.getByLabelText('修改原因'), '网络重试排期');
    await user.click(screen.getByRole('button', { name: '服务端预览影响' }));
    await user.click(await screen.findByRole('button', { name: '确认新增排期版本' }));
    expect(await screen.findByRole('button', { name: '重试原请求' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '确认新增排期版本' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual(calls[0]);
    expect(await screen.findByText(/排期新版本已确认/u)).toBeVisible();
    expect(screen.queryByRole('button', { name: '重试原请求' })).not.toBeInTheDocument();
  });

  it('drops an ambiguous old confirmation when inputs are changed and previewed again', async () => {
    let previews = 0;
    const calls: Array<{ body: Record<string, unknown>; key: string|null }> = [];
    server.use(
      http.get(apiUrl('/api/staff/demand-batches/demand-1/reservation-schedule'), () =>
        HttpResponse.json({ data: { page: schedulePage() }, meta: { request_id: 'page' } })),
      http.post(apiUrl('/api/staff/demand-batches/demand-1/schedule/preview'), () => {
        previews += 1;
        return HttpResponse.json({ data: { preview: {
          ...preview(), preview_hash: (previews === 1 ? 'a' : 'd').repeat(64),
        } }, meta: { request_id: `preview-${previews}` } });
      }),
      http.post(apiUrl('/api/staff/demand-batches/demand-1/schedule/confirm'), async ({ request }) => {
        calls.push({ body: await request.json() as Record<string, unknown>,
          key: request.headers.get('Idempotency-Key') });
        if (calls.length === 1) return HttpResponse.error();
        return HttpResponse.json({ data: { schedule_confirmation: scheduleConfirmation() },
          meta: { request_id: 'confirm-new-preview' } });
      }),
    );
    const user = userEvent.setup();
    renderWorkspace(owner(), '/staff/demands/demand-1/reservations');
    await screen.findByRole('table', { name: '预约排名与预计下单日期' });
    const reason = screen.getByLabelText('修改原因');
    await user.type(reason, '原排期');
    await user.click(screen.getByRole('button', { name: '服务端预览影响' }));
    await user.click(await screen.findByRole('button', { name: '确认新增排期版本' }));
    expect(await screen.findByRole('button', { name: '重试原请求' })).toBeVisible();
    await user.clear(reason); await user.type(reason, '新排期');
    expect(screen.queryByRole('button', { name: '重试原请求' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认新增排期版本' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '服务端预览影响' }));
    await user.click(await screen.findByRole('button', { name: '确认新增排期版本' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.key).not.toBe(calls[0]!.key);
    expect(calls[0]!.body['preview_hash']).toBe('a'.repeat(64));
    expect(calls[1]!.body['preview_hash']).toBe('d'.repeat(64));
  });
});

function renderWorkspace(value: StaffSession, route: string): void {
  renderWithMsw(<StaffSessionBoundary adapter={adapter(value)}><Routes>
    <Route path="/staff/products" element={<ProductSchedulingWorkspace />} />
    <Route path="/staff/demands/:demandId/reservations"
      element={<ProductSchedulingWorkspace />} />
    <Route path="/staff/products/:productId"
      element={<ProductSchedulingWorkspace />} />
  </Routes></StaffSessionBoundary>, { route });
}

function productDetail(mainImage: {
  file_object_id: string;
  file_version: number;
  client_file_name: string;
  bound_at: number;
} | null = null) {
  return {
    product_id: 'product-1', seller_organization_id: 'seller-1', store_id: 'store-1',
    store_name: '测试店铺', marketplace_code: 'JP', asin: 'B0TEST0001',
    status: 'ACTIVE', aggregate_version: 2, current_version_no: 2,
    product_name: '测试产品', cadence: { order_interval_days: 2, orders_per_run: 5 },
    updated_at: 1_786_161_600_000,
    versions: [{
      product_version_id: 'version-2', version_no: 2, product_name: '测试产品',
      search_keywords: ['测试'], ordering_guide_expected_amount_jpy: 1980,
      color_spec_mode: 'MAIN_IMAGE_VARIANT', default_buyer_self_pay_bps: 0,
      product_url: null, buyer_visible_notes: null, internal_notes: null,
      cadence: { order_interval_days: 2, orders_per_run: 5 }, main_image: mainImage,
      created_at: 1_786_161_600_000,
    }],
    demands: [], timezone: 'Asia/Shanghai', data_as_of: 1_786_161_600_000,
  };
}

function productVersionResult(versionNo: number) {
  return {
    product_id: 'product-1', product_version_id: `version-${versionNo}`,
    version_no: versionNo, aggregate_version: versionNo,
    product_version: {
      productName: '测试产品', searchKeywords: ['测试'],
      orderingGuideExpectedAmountJpy: 1980, colorSpecMode: 'MAIN_IMAGE_VARIANT',
      defaultBuyerSelfPayBps: 0, productUrl: null, buyerVisibleNotes: null,
      internalNotes: null, orderIntervalDays: 2, ordersPerRun: 5,
    }, replayed: false,
  };
}

function scheduleConfirmation() {
  return { demand_batch_id: 'demand-1', demand_version: 5,
    schedule: { ...schedule(), demand_version: 5 }, replayed: false };
}

function schedulePage() {
  return {
    demand: { demand_batch_id: 'demand-1', product_id: 'product-1',
      product_name: '测试产品', target_quantity: 20, effective_reservation_count: 2,
      order_deadline: 1_786_838_400_000, demand_version: 4, schedule: schedule() },
    items: [
      { reservation_id: 'reservation-1', status: 'APPROVED', submitted_at: 1000,
        rank: 1, planned_order_date: '2026-08-10', buyer_reference: 'B0001',
        buyer_customer_id: 'buyer-1', buyer_display_name: '买家一',
        actual_order_status: null, actual_order_date: null },
      { reservation_id: 'reservation-2', status: 'PENDING_REVIEW', submitted_at: 1001,
        rank: 2, planned_order_date: '2026-08-10', buyer_reference: 'B0002',
        buyer_customer_id: null, buyer_display_name: null,
        actual_order_status: null, actual_order_date: null },
    ],
    next_cursor: null, timezone: 'Asia/Shanghai',
    sorting: 'submitted_at ASC, id ASC', data_as_of: 1_786_161_600_000,
  };
}

function schedule() {
  return { schedule_version_id: 'schedule-1', version_no: 1, demand_version: 4,
    first_order_date: '2026-08-10', order_interval_days: 1, orders_per_run: 2,
    theoretical_last_order_date: '2026-08-19', affected_reservation_count: 0,
    preview_hash: 'b'.repeat(64), change_reason: '需求发布',
    changed_by_staff_id: 'owner-1', created_at: 1_786_161_600_000 };
}

function preview() {
  return { demand_batch_id: 'demand-1', expected_version: 4,
    current_schedule_version: 1, first_order_date: '2026-08-10',
    order_interval_days: 1, orders_per_run: 2,
    theoretical_last_order_date: '2026-08-19', order_deadline_date: '2026-08-20',
    effective_reservation_count: 2, affected_reservation_count: 2,
    before_first_order_date: '2026-08-09',
    before_theoretical_last_order_date: '2026-08-18',
    preview_hash: 'a'.repeat(64), timezone: 'Asia/Shanghai',
    data_as_of: 1_786_161_600_000 };
}

function adapter(value: StaffSession): StaffAuthApiAdapter {
  return { bootstrap: async () => ({ data: { session: value, access_email: 'staff@example.com' }, requestId: 'bootstrap' }),
    readSession: async () => ({ data: { session: value }, requestId: 'session' }),
    logout: async () => ({ data: { logged_out: true, all_devices_logged_out: false }, requestId: 'logout' }),
    logoutAll: async () => ({ data: { logged_out: true, all_devices_logged_out: true, session_version: 2 }, requestId: 'logout-all' }) };
}

function owner(): StaffSession {
  return staffSession('owner', ['PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_PUBLISH']);
}
function buyerRefund(): StaffSession { return staffSession('buyer_refund', []); }
function staffSession(
  role: 'owner'|'seller_ops'|'pre_sales'|'buyer_refund',
  permissions: StaffSession['permissions'],
): StaffSession {
  const staffRole = role === 'owner' ? { code: 'owner', display_name: '总管理员' } as const
    : role === 'seller_ops' ? { code: 'seller_ops', display_name: '卖家对接' } as const
      : role === 'pre_sales' ? { code: 'pre_sales', display_name: '售前' } as const
        : { code: 'buyer_refund', display_name: '买家返款' } as const;
  return { staff_id: 'staff-1', display_name: '测试员工',
    role: staffRole, permissions,
    data_scope: { type: role === 'owner' ? 'GLOBAL' : 'ASSIGNED_BUYERS',
      marketplaceCodes: role === 'owner' ? [] : ['AMAZON_JP'],
      buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [] },
    authorization_version: 1, session_version: 1, expires_at: Date.now() + 100_000 };
}
