// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { useLocation } from 'react-router-dom';
import { z } from 'zod';
import '../test/msw/lifecycle';
import { FrontendApiError, isFrontendApiError } from '../api/errors';
import { queryKeys } from '../api/query-client';
import { apiRequest } from '../api/transport';
import { RequestIdDisplay } from '../ui/primitives';
import { buyerSessionFixture, failureEnvelopeFixture, staffSessionFixture } from '../test/msw/fixtures';
import { apiUrl } from '../test/msw/handlers';
import { createMswQueryClient, renderWithMsw } from '../test/msw/render';
import { server } from '../test/msw/server';

afterEach(cleanup);

const protectedSchema = z.object({ ok: z.literal(true) }).strict();
const protectedApi = Object.freeze({
  read: (path: '/api/buyer-portal/me' | '/api/staff/me/assignments') => apiRequest({
    path,
    method: 'GET',
    schema: protectedSchema,
  }),
});

function ProtectedProbe({ path }: { path: '/api/buyer-portal/me' | '/api/staff/me/assignments' }) {
  const location = useLocation();
  const [error, setError] = useState<FrontendApiError | null>(null);
  return (
    <main>
      <div>PATH:{location.pathname}</div>
      <button type="button" onClick={() => {
        void protectedApi.read(path).catch((caught: unknown) => {
          if (isFrontendApiError(caught)) setError(caught);
        });
      }}>读取保护资源</button>
      {error && <div role="alert"><span>{error.code}</span><RequestIdDisplay requestId={error.requestId} /></div>}
    </main>
  );
}

describe('403 and 404 preserve identity Sessions through real protected requests', () => {
  it.each([
    ['customer', '/api/buyer-portal/me', 403, 'FORBIDDEN'],
    ['customer', '/api/buyer-portal/me', 404, 'NOT_FOUND'],
    ['staff', '/api/staff/me/assignments', 403, 'FORBIDDEN'],
    ['staff', '/api/staff/me/assignments', 404, 'NOT_FOUND'],
  ] as const)('%s protected API on %s returns %i without clearing Session state', async (
    _identity,
    path,
    status,
    code,
  ) => {
    server.use(http.get(apiUrl(path), () => HttpResponse.json(
      failureEnvelopeFixture(code, 'public message', {
        reason: 'internal-only',
        token: 'secret-token',
        object_key: 'private-key',
      }, `request-protected-${status}`),
      { status },
    )));
    const client = createMswQueryClient();
    client.setQueryData(queryKeys.buyer.session, buyerSessionFixture);
    client.setQueryData(queryKeys.seller.session, { ...buyerSessionFixture, account_type: 'SELLER_MEMBER' });
    client.setQueryData(queryKeys.staff.session, staffSessionFixture);
    const user = userEvent.setup();
    renderWithMsw(<ProtectedProbe path={path} />, { route: '/protected', client });
    await user.click(screen.getByRole('button', { name: '读取保护资源' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(code);
    expect(screen.getByText(`请求编号：request-protected-${status}`)).toBeVisible();
    expect(screen.getByText('PATH:/protected')).toBeVisible();
    expect(screen.queryByText(/secret-token|private-key|internal-only/u)).not.toBeInTheDocument();
    expect(client.getQueryData(queryKeys.buyer.session)).toEqual(buyerSessionFixture);
    expect(client.getQueryData(queryKeys.seller.session)).toMatchObject({ account_type: 'SELLER_MEMBER' });
    expect(client.getQueryData(queryKeys.staff.session)).toEqual(staffSessionFixture);
  });
});
