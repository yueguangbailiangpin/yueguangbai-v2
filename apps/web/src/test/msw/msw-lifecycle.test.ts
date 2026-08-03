// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { apiRequest } from '../../api/transport';
import { server } from './server';
import { z } from 'zod';

const phantomRoute = '/api/staff/order-evidence/evidence-1/internal-communication-files';

describe('formal MSW lifecycle and phantom route rejection', () => {
  it('has no phantom internal-communication handler and fails its active request as unhandled', async () => {
    expect(server.listHandlers()).toHaveLength(0);

    let unhandledPath: string | null = null;
    const recordUnhandled = ({ request }: { request: Request }) => {
      unhandledPath = new URL(request.url).pathname;
    };
    server.events.on('request:unhandled', recordUnhandled);
    try {
      await expect(apiRequest({
        path: phantomRoute,
        method: 'POST',
        schema: z.object({}).strict(),
        body: {},
      })).rejects.toMatchObject({ code: 'NETWORK_FAILURE', category: 'NETWORK' });
      expect(unhandledPath).toBe(phantomRoute);
    } finally {
      server.events.removeListener('request:unhandled', recordUnhandled);
    }
  });
});
