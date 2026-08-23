import { afterAll, afterEach, beforeAll } from 'vitest';
import { clearSessionBlobCache } from '../../files/blob-session-cache';
import { server } from './server';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  clearSessionBlobCache();
});

afterAll(() => {
  server.close();
});
