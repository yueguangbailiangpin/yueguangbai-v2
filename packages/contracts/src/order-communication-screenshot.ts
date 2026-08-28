export const ORDER_COMMUNICATION_SCREENSHOT_HTTP_PATHS = Object.freeze({
  staffIntents: '/api/staff/formal-orders/:id/communication-screenshots/intents',
  staffAttach: '/api/staff/formal-orders/:id/communication-screenshots',
  staffList: '/api/staff/formal-orders/:id/communication-screenshots',
  sellerList: '/api/seller-portal/formal-orders/:id/communication-screenshots',
  sellerReadIntent:
    '/api/seller-portal/formal-orders/:id/communication-screenshots/:fileObjectId/read-intent',
} as const);

/**
 * D-056 §4.1: buyer chat and seller order-communication screenshots are one
 * business kind — ORDER_COMMUNICATION_SCREENSHOT, attached to the formal
 * order, staff-uploaded, multiple per order, visible to every ACTIVE member
 * of the seller organization, never to buyers, concealed 404 for other
 * organizations, cold-archived six months after full order closure.
 */
export interface OrderCommunicationScreenshotReferenceDto {
  file_object_id: string;
  file_version: number;
  purpose: 'ORDER_COMMUNICATION_SCREENSHOT';
  visibility: 'SELLER_VISIBLE';
  uploaded_at: number;
  uploaded_by_staff_id: string | null;
  /** Present when the uploading staff account is still resolvable. */
  uploaded_by_staff_name?: string | null;
}

export interface AttachOrderCommunicationScreenshotRequest {
  file_object_id: string;
  expected_file_version: number;
}

export interface AttachOrderCommunicationScreenshotResult {
  formal_order_id: string;
  file_object_id: string;
  replayed: boolean;
}

export interface StaffOrderCommunicationScreenshotListDto {
  formal_order_id: string;
  seller_organization_id: string;
  screenshots: readonly OrderCommunicationScreenshotReferenceDto[];
}

export interface SellerOrderCommunicationScreenshotListDto {
  formal_order_id: string;
  screenshots: readonly OrderCommunicationScreenshotReferenceDto[];
}

export interface SellerOrderCommunicationScreenshotReadIntentRequest {
  expected_file_version: number;
}

export interface OrderCommunicationScreenshotReadIntentDto {
  read_intent_id: string;
  access_token: string | null;
  access_token_available: boolean;
  expires_at: number;
  replayed: boolean;
}
