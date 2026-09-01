// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../test/msw/lifecycle';
import { apiUrl } from '../test/msw/handlers';
import { createMswQueryClient } from '../test/msw/render';
import { server } from '../test/msw/server';
import { ProtectedImage } from '../buyer/shared/ProtectedImage';
import { GenericBuyerFileReadIntentAdapter } from './file-read-providers';
import { ProtectedImagePreview } from './ProtectedImagePreview';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ProtectedImagePreview', () => {
  it('loads a protected thumbnail, opens a lightbox, and keeps cached URLs alive across remounts', async () => {
    let sequence = 0;
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => `blob:image-${++sequence}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    server.use(
      http.post(apiUrl('/api/buyer-portal/files/:fileId/read-intents'), ({ params }) => HttpResponse.json({
        data: {
          read_intent_id: `intent-${params['fileId']}`,
          file_object_id: params['fileId'],
          access_token: 'image-token'.padEnd(40, 'x'),
          access_token_available: true,
          expires_at: 99,
          replayed: false,
        },
        meta: { request_id: 'image-request' },
      })),
      http.get(apiUrl('/api/buyer-portal/file-read-intents/:id/content'), () => new Response(
        Uint8Array.of(1, 2),
        { headers: {
          'Content-Type': 'image/png',
          'Content-Length': '2',
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        } },
      )),
    );
    const make = (id: string) => new GenericBuyerFileReadIntentAdapter({
      file_object_id: id,
      file_version: 1,
      purpose: 'ORDER_EVIDENCE',
      visibility: 'BUYER_VISIBLE',
    });
    const client = createMswQueryClient();
    const rendered = render(<QueryClientProvider client={client}>
      <ProtectedImagePreview provider={make('file-1')} alt="商品主图" fallback={<span>暂无图片</span>} />
    </QueryClientProvider>);

    const thumbnail = await screen.findByRole('img', { name: '商品主图' });
    expect(thumbnail).toHaveAttribute('src', 'blob:image-1');
    await userEvent.click(screen.getByRole('button', { name: '查看大图：商品主图' }));
    expect(screen.getByRole('dialog', { name: '商品主图' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: '商品主图' })).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: '关闭大图' }));

    rendered.rerender(<QueryClientProvider client={client}>
      <ProtectedImagePreview provider={make('file-2')} alt="商品主图" fallback={<span>暂无图片</span>} />
    </QueryClientProvider>);
    expect(await screen.findByRole('img', { name: '商品主图' })).toHaveAttribute('src', 'blob:image-2');
    rendered.unmount();
    // 带版本引用的 provider 图片进入会话缓存：URL 归缓存所有，
    // 组件卸载/切换不回收（重挂载零网络），仅在缓存淘汰/清空时回收。
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('ProtectedImagePreview image performance', () => {
  const reference = (id: string) => ({
    file_object_id: id,
    file_version: 1,
    purpose: 'ORDER_EVIDENCE' as const,
    visibility: 'BUYER_VISIBLE' as const,
  });

  function installBatchHandlers(options: {
    singleIntentCalls: string[];
    batchBodies: { requests: { file_object_id: string }[] }[];
    contentCalls: string[];
  }) {
    server.use(
      http.post(apiUrl('/api/buyer-portal/files/:fileId/read-intents'), ({ params }) => {
        options.singleIntentCalls.push(String(params['fileId']));
        return HttpResponse.json({
          data: {
            read_intent_id: `single-intent-${params['fileId']}`,
            file_object_id: String(params['fileId']),
            access_token: 'image-token'.padEnd(40, 'x'),
            access_token_available: true,
            expires_at: 99,
            replayed: false,
          },
          meta: { request_id: 'image-single' },
        });
      }),
      http.post(apiUrl('/api/buyer-portal/file-read-intents/batch'), async ({ request }) => {
        const body = await request.json() as { requests: { file_object_id: string }[] };
        options.batchBodies.push(body);
        return HttpResponse.json({
          data: {
            intents: body.requests.map((item) => ({
              read_intent_id: `batch-intent-${item.file_object_id}`,
              file_object_id: item.file_object_id,
              access_token: `token-${item.file_object_id}`.padEnd(40, 'x'),
              access_token_available: true,
              expires_at: 99,
              replayed: false,
            })),
          },
          meta: { request_id: 'image-batch' },
        });
      }),
      http.get(apiUrl('/api/buyer-portal/file-read-intents/:id/content'), ({ params }) => {
        options.contentCalls.push(String(params['id']));
        return new Response(Uint8Array.of(1, 2), {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': '2',
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }),
    );
  }

  it('batches read intents for images mounted in the same commit', async () => {
    const singleIntentCalls: string[] = [];
    const batchBodies: { requests: { file_object_id: string }[] }[] = [];
    const contentCalls: string[] = [];
    installBatchHandlers({ singleIntentCalls, batchBodies, contentCalls });
    const client = createMswQueryClient();
    render(<QueryClientProvider client={client}>
      <ProtectedImagePreview
        identity="buyer" reference={reference('file-a')}
        alt="图一" fallback={<span>暂无图片</span>} />
      <ProtectedImagePreview
        identity="buyer" reference={reference('file-b')}
        alt="图二" fallback={<span>暂无图片</span>} />
    </QueryClientProvider>);

    expect(await screen.findByRole('img', { name: '图一' })).toBeVisible();
    expect(await screen.findByRole('img', { name: '图二' })).toBeVisible();

    expect(batchBodies).toHaveLength(1);
    expect(batchBodies[0]!.requests.map((item) => item.file_object_id))
      .toEqual(['file-a', 'file-b']);
    expect(singleIntentCalls).toEqual([]);
    expect(contentCalls).toHaveLength(2);
  });

  it('serves a remounted image from the session cache without refetching', async () => {
    const singleIntentCalls: string[] = [];
    const batchBodies: { requests: { file_object_id: string }[] }[] = [];
    const contentCalls: string[] = [];
    installBatchHandlers({ singleIntentCalls, batchBodies, contentCalls });
    const client = createMswQueryClient();
    const first = render(<QueryClientProvider client={client}>
      <ProtectedImagePreview
        identity="buyer" reference={reference('file-c')}
        alt="缓存图" fallback={<span>暂无图片</span>} />
    </QueryClientProvider>);
    expect(await screen.findByRole('img', { name: '缓存图' })).toBeVisible();
    first.unmount();

    render(<QueryClientProvider client={client}>
      <ProtectedImagePreview
        identity="buyer" reference={reference('file-c')}
        alt="缓存图" fallback={<span>暂无图片</span>} />
    </QueryClientProvider>);
    expect(await screen.findByRole('img', { name: '缓存图' })).toBeVisible();

    // 第一次挂载走单文件端点；重挂载命中会话缓存，零网络请求。
    expect(singleIntentCalls).toEqual(['file-c']);
    expect(batchBodies).toEqual([]);
    expect(contentCalls).toHaveLength(1);
  });
});

describe('ProtectedImagePreview provider session cache', () => {
  it('serves a remounted provider-backed buyer image from the session cache without refetching', async () => {
    const intentCalls: string[] = [];
    const contentCalls: string[] = [];
    const reference = {
      file_object_id: 'file-provider-1',
      file_version: 2,
      purpose: 'PRODUCT_IMAGE' as const,
      visibility: 'BUYER_VISIBLE' as const,
    };
    server.use(
      http.post(apiUrl('/api/buyer-portal/files/file-provider-1/read-intents'), () => {
        intentCalls.push('create');
        return HttpResponse.json({
          data: {
            read_intent_id: 'provider-intent-1',
            file_object_id: 'file-provider-1',
            access_token: 'provider-token'.padEnd(40, 'x'),
            access_token_available: true,
            expires_at: 99,
            replayed: false,
          },
          meta: { request_id: 'provider-read' },
        });
      }),
      http.get(apiUrl('/api/buyer-portal/file-read-intents/provider-intent-1/content'), () => {
        contentCalls.push('content');
        return new Response(Uint8Array.of(7, 8), {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': '2',
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }),
    );
    const client = createMswQueryClient();
    const first = render(<QueryClientProvider client={client}>
      <ProtectedImage
        reference={reference}
        alt="产品主图"
        fallback={<span>暂无图片</span>} />
    </QueryClientProvider>);
    expect(await screen.findByRole('img', { name: '产品主图' })).toBeVisible();
    first.unmount();

    render(<QueryClientProvider client={client}>
      <ProtectedImage
        reference={reference}
        alt="产品主图"
        fallback={<span>暂无图片</span>} />
    </QueryClientProvider>);
    expect(await screen.findByRole('img', { name: '产品主图' })).toBeVisible();

    expect(intentCalls).toEqual(['create']);
    expect(contentCalls).toEqual(['content']);
  });
});
