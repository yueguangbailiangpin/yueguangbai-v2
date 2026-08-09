export const SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS = Object.freeze({
  staffAttach: '/api/staff/formal-orders/:id/chat-screenshot',
  sellerReadIntent:
    '/api/seller-portal/formal-orders/:id/chat-screenshot/read-intent',
} as const);

export const SELLER_ORDER_CHAT_SCREENSHOT_STATUSES = [
  'AVAILABLE',
  'NONE',
] as const;

export type SellerOrderChatScreenshotStatus =
  typeof SELLER_ORDER_CHAT_SCREENSHOT_STATUSES[number];

export interface SellerOrderChatScreenshotStatusDto {
  status: SellerOrderChatScreenshotStatus;
  file_version: number | null;
}

export interface StaffAttachSellerOrderChatScreenshotRequest {
  file_object_id: string;
  expected_file_version: number;
}

export interface SellerOrderChatScreenshotReadIntentRequest {
  expected_file_version: number;
}

export interface AttachSellerOrderChatScreenshotResult {
  formal_order_id: string;
  screenshot_id: string;
  file_object_id: string;
  replayed: boolean;
}

export interface StaffAttachSellerOrderChatScreenshotResponseDto {
  chat_screenshot: AttachSellerOrderChatScreenshotResult;
}

export interface SellerOrderChatScreenshotReadIntentDto {
  read_intent_id: string;
  access_token: string | null;
  access_token_available: boolean;
  expires_at: number;
  replayed: boolean;
}

export interface SellerOrderChatScreenshotReadIntentResponseDto {
  read_intent: SellerOrderChatScreenshotReadIntentDto;
}

export function isSellerOrderChatScreenshotStatus(
  value: unknown,
): value is SellerOrderChatScreenshotStatus {
  return typeof value === 'string'
    && (SELLER_ORDER_CHAT_SCREENSHOT_STATUSES as readonly string[])
      .includes(value);
}
