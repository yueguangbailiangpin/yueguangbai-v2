import { describe, expect, it } from 'vitest';
import {
  ORDER_COMMUNICATION_SCREENSHOT_HTTP_PATHS,
} from './order-communication-screenshot';

describe('order communication screenshot contract (D-056 §4.1)', () => {
  it('freezes the unified HTTP paths', () => {
    expect(ORDER_COMMUNICATION_SCREENSHOT_HTTP_PATHS).toMatchObject({
      staffIntents:
        '/api/staff/formal-orders/:id/communication-screenshots/intents',
      staffAttach:
        '/api/staff/formal-orders/:id/communication-screenshots',
      sellerList:
        '/api/seller-portal/formal-orders/:id/communication-screenshots',
      sellerReadIntent:
        '/api/seller-portal/formal-orders/:id/communication-screenshots/:fileObjectId/read-intent',
    });
  });
});
