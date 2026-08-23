export const BUYER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS = Object.freeze({
  staffAttach: '/api/staff/formal-orders/:id/buyer-chat-screenshots',
} as const);

export interface StaffAttachBuyerChatScreenshotRequest {
  file_object_id: string;
  expected_file_version: number;
}

export interface AttachBuyerChatScreenshotResult {
  formal_order_id: string;
  screenshot_id: string;
  file_object_id: string;
  file_version: number;
  attached_at: number;
  replayed: boolean;
}

export interface StaffAttachBuyerChatScreenshotResponseDto {
  chat_screenshot: AttachBuyerChatScreenshotResult;
}

/**
 * Staff-only chat screenshots with the buyer, parked on the formal order the
 * conversation confirmed.  Reference shape feeds the staff ProtectedImage
 * preview (batch read-intent pipeline); nothing here is ever exposed through
 * buyer-portal DTOs.
 */
export interface BuyerChatScreenshotReferenceDto {
  file_object_id: string;
  file_version: number;
  purpose: 'ORDER_EVIDENCE';
  visibility: 'INTERNAL_ONLY';
}
