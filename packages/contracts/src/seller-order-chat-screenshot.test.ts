import { describe, expect, it } from 'vitest';
import {
  SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS,
  type SellerOrderChatScreenshotReadIntentRequest,
  type SellerOrderChatScreenshotReadIntentResponseDto,
  type StaffAttachSellerOrderChatScreenshotRequest,
  type StaffAttachSellerOrderChatScreenshotResponseDto,
} from './seller-order-chat-screenshot';

describe('Seller formal-order chat screenshot HTTP contract', () => {
  it('freezes the two entity-specific route templates', () => {
    expect(SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS).toEqual({
      staffAttach: '/api/staff/formal-orders/:id/chat-screenshot',
      sellerReadIntent:
        '/api/seller-portal/formal-orders/:id/chat-screenshot/read-intent',
    });
    expect(Object.isFrozen(SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS)).toBe(true);
  });

  it('publishes exact request and snake_case response DTOs', () => {
    const staffRequest = {
      file_object_id: 'file-1',
      expected_file_version: 2,
    } satisfies StaffAttachSellerOrderChatScreenshotRequest;
    const sellerRequest = {
      expected_file_version: 2,
    } satisfies SellerOrderChatScreenshotReadIntentRequest;
    const staffResponse = {
      chat_screenshot: {
        formal_order_id: 'formal-order-1',
        screenshot_id: 'screenshot-1',
        file_object_id: 'file-1',
        replayed: false,
      },
    } satisfies StaffAttachSellerOrderChatScreenshotResponseDto;
    const sellerResponse = {
      read_intent: {
        read_intent_id: 'intent-1',
        access_token: 'opaque-token',
        access_token_available: true,
        expires_at: 1000,
        replayed: false,
      },
    } satisfies SellerOrderChatScreenshotReadIntentResponseDto;

    expect(staffRequest).toEqual({
      file_object_id: 'file-1',
      expected_file_version: 2,
    });
    expect(sellerRequest).toEqual({ expected_file_version: 2 });
    expect(staffResponse.chat_screenshot.formal_order_id)
      .toBe('formal-order-1');
    expect(JSON.stringify(sellerResponse)).toContain('read_intent_id');
    expect(JSON.stringify(sellerResponse)).not.toContain('readIntentId');
    expect(JSON.stringify(sellerResponse)).not.toContain('object_key');
  });
});
