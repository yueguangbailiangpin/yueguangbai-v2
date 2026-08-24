// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { FrontendApiError } from '../../api/errors';
import {
  productApplicationErrorMessage,
  SellerProductApplicationFormPage,
} from './SellerSubmissionPages';
import { SellerLayout } from '../routes/SellerLayout';

afterEach(cleanup);

describe('Seller first product application store setup', () => {
  it('explains assignment outages and product conflicts instead of reporting stale facts', () => {
    expect(productApplicationErrorMessage(new FrontendApiError(
      'DEPENDENCY_UNAVAILABLE', 503, 'request-dependency', 'DEPENDENCY',
    ))).toBe(
      '系统暂时无法分配审核任务，产品申请尚未创建，请稍后重试或联系总管理员。',
    );
    expect(productApplicationErrorMessage(new FrontendApiError(
      'PRODUCT_APPLICATION_CONFLICT', 409, 'request-conflict', 'CONFLICT',
    ))).toBe('这个产品标识已有待审核申请，请不要重复提交。');
  });

  it('lets the Seller OWNER create the first store before showing the product form', async () => {
    let created = false;
    let requestBody: unknown;
    server.use(
      http.get(apiUrl('/api/seller-portal/me'), () =>
        HttpResponse.json({ data: { me: sellerOwner() }, meta: { request_id: 'seller-me' } }),
      ),
      http.get(apiUrl('/api/seller-portal/stores'), () =>
        HttpResponse.json({
          data: {
            items: created ? [store()] : [],
            page: { limit: 100, next_cursor: null },
          },
          meta: { request_id: 'seller-stores' },
        }),
      ),
      http.post(apiUrl('/api/seller-portal/stores'), async ({ request }) => {
        requestBody = await request.json();
        created = true;
        return HttpResponse.json(
          {
            data: {
              store: {
                store_id: 'store-new',
                seller_organization_id: 'seller-org-new',
                marketplace_code: 'AMAZON_JP',
                display_name: '咖啡秤日本店',
                status: 'ACTIVE',
                version: 1,
                replayed: false,
              },
            },
            meta: { request_id: 'seller-create-store' },
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: '首次提交前先添加店铺' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: '产品标识' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '店铺名称' }), '咖啡秤日本店');
    await user.click(screen.getByRole('button', { name: '创建店铺' }));

    expect(
      await screen.findByText('店铺已创建并自动选中，可以继续提交产品申请。'),
    ).toBeVisible();
    expect(await screen.findByRole('textbox', { name: '产品标识' })).toBeVisible();
    await waitFor(() =>
      expect(document.getElementById('application-store')).toHaveValue('store-new'),
    );
    expect(requestBody).toEqual({
      marketplace_code: 'AMAZON_JP',
      store_name: '咖啡秤日本店',
    });
  });

  it('automatically selects the only available store', async () => {
    installReadHandlers([store()]);
    renderPage();

    expect(await screen.findByRole('textbox', { name: '产品标识' })).toBeVisible();
    await waitFor(() =>
      expect(document.getElementById('application-store')).toHaveValue('store-new'),
    );
  });

  it('lets a read-only Seller employee create a store without gaining product submission', async () => {
    let created = false;
    server.use(
      http.get(apiUrl('/api/seller-portal/me'), () =>
        HttpResponse.json({
          data: { me: sellerMember('VIEWER', false) },
          meta: { request_id: 'seller-viewer-me' },
        }),
      ),
      http.get(apiUrl('/api/seller-portal/stores'), () =>
        HttpResponse.json({
          data: {
            items: created ? [store()] : [],
            page: { limit: 100, next_cursor: null },
          },
          meta: { request_id: 'seller-viewer-stores' },
        }),
      ),
      http.post(apiUrl('/api/seller-portal/stores'), () => {
        created = true;
        return HttpResponse.json(
          {
            data: {
              store: {
                store_id: 'store-new',
                seller_organization_id: 'seller-org-new',
                marketplace_code: 'AMAZON_JP',
                display_name: '只读员工创建店铺',
                status: 'ACTIVE',
                version: 1,
                replayed: false,
              },
            },
            meta: { request_id: 'seller-viewer-create-store' },
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: '首次提交前先添加店铺' })).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: '店铺名称' }), '只读员工创建店铺');
    await user.click(screen.getByRole('button', { name: '创建店铺' }));

    expect(
      await screen.findByText('当前账号可以添加店铺，但没有提交产品申请的权限。'),
    ).toBeVisible();
    expect(screen.queryByRole('textbox', { name: '产品标识' })).not.toBeInTheDocument();
  });
});

function renderPage(): ReturnType<typeof renderWithMsw> {
  return renderWithMsw(
    <SellerLayout>
      <SellerProductApplicationFormPage />
    </SellerLayout>,
    { route: '/seller/products/new' },
  );
}

function installReadHandlers(stores: readonly ReturnType<typeof store>[]): void {
  server.use(
    http.get(apiUrl('/api/seller-portal/me'), () =>
      HttpResponse.json({ data: { me: sellerOwner() }, meta: { request_id: 'seller-me' } }),
    ),
    http.get(apiUrl('/api/seller-portal/stores'), () =>
      HttpResponse.json({
        data: { items: stores, page: { limit: 100, next_cursor: null } },
        meta: { request_id: 'seller-stores' },
      }),
    ),
  );
}

function sellerOwner() {
  return sellerMember('OWNER', true);
}

function sellerMember(
  role: 'OWNER' | 'OPERATIONS' | 'FINANCE' | 'VIEWER',
  canSubmitProductApplications: boolean,
) {
  return {
    account_id: 'seller-account-new',
    member: {
      id: 'seller-member-new',
      display_name: '咖啡秤',
      role,
      primary_owner: role === 'OWNER',
    },
    organization: {
      id: 'seller-org-new',
      seller_code: 'portal-000001',
      name: '咖啡秤',
      marketplace_code: 'JP' as const,
      status: 'ACTIVE' as const,
      settlement_account_name: null,
      settlement_account_identifier: null,
    },
    access: {
      read_scope: 'ORGANIZATION' as const,
      store_ids: [],
      can_submit_product_applications: canSubmitProductApplications,
      can_submit_demand_batches: true,
    },
  };
}

function store() {
  return {
    id: 'store-new',
    marketplace_code: 'JP' as const,
    display_name: '咖啡秤日本店',
    canonical_marketplace_code: 'AMAZON_JP' as const,
    transaction_currency_code: 'JPY' as const,
    transaction_currency_exponent: 0 as const,
    marketplace_status: 'ACTIVE' as const,
    adapter_status: 'AVAILABLE' as const,
    status: 'ACTIVE' as const,
    version: 1,
    created_at: 1,
    updated_at: 1,
  };
}
