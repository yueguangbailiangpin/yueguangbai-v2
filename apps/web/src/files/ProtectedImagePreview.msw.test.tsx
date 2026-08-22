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
import { GenericBuyerFileReadIntentAdapter } from './file-read-providers';
import { ProtectedImagePreview } from './ProtectedImagePreview';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ProtectedImagePreview', () => {
  it('loads a protected thumbnail, opens a lightbox, and revokes temporary URLs', async () => {
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
          'Cache-Control': 'private, no-store',
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
    expect(revoke).toHaveBeenCalledWith('blob:image-1');
    expect(await screen.findByRole('img', { name: '商品主图' })).toHaveAttribute('src', 'blob:image-2');
    rendered.unmount();
    expect(revoke).toHaveBeenLastCalledWith('blob:image-2');
  });
});
