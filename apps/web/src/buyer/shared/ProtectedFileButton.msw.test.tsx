// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenericBuyerFileReadIntentAdapter } from '../../files/file-read-providers';
import '../../test/msw/lifecycle';
import { apiUrl } from '../../test/msw/handlers';
import { createMswQueryClient } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { ProtectedFileButton } from './ProtectedFileButton';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ProtectedFileButton Controller ownership', () => {
  it('keeps provider file URLs alive in the session cache across identity changes and unmounts', async () => {
    let sequence = 0;
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:provider-${++sequence}`) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    server.use(
      http.post(apiUrl('/api/buyer-portal/files/:fileId/read-intents'), ({ params }) => HttpResponse.json({
        data: { read_intent_id: `intent-${params['fileId']}`, file_object_id: params['fileId'],
          access_token: 'provider-token'.padEnd(40, 'x'), access_token_available: true,
          expires_at: 99, replayed: false }, meta: { request_id: 'provider-request' },
      })),
      http.get(apiUrl('/api/buyer-portal/file-read-intents/:id/content'), () => new Response(Uint8Array.of(1, 2), {
        headers: { 'Content-Type': 'image/png', 'Content-Length': '2', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
      })),
    );
    const make = (id: string) => new GenericBuyerFileReadIntentAdapter({
      file_object_id: id, file_version: 1, purpose: 'ORDER_EVIDENCE', visibility: 'BUYER_VISIBLE',
    });
    const client = createMswQueryClient();
    const rendered = render(<QueryClientProvider client={client}><ProtectedFileButton provider={make('file-1')} /></QueryClientProvider>);
    await userEvent.click(screen.getByRole('button', { name: '查看文件' }));
    expect(await screen.findByRole('link', { name: '打开文件' })).toHaveAttribute('href', 'blob:provider-1');
    rendered.rerender(<QueryClientProvider client={client}><ProtectedFileButton provider={make('file-2')} /></QueryClientProvider>);
    await userEvent.click(screen.getByRole('button', { name: '查看文件' }));
    expect(await screen.findByRole('link', { name: '打开文件' })).toHaveAttribute('href', 'blob:provider-2');
    rendered.unmount();
    // 带版本引用的 provider 文件进入会话缓存：切换与卸载不回收 URL，
    // 重开同一文件零网络（由会话缓存测试覆盖），仅在淘汰/清空时回收。
    expect(revoke).not.toHaveBeenCalled();
  });
});
