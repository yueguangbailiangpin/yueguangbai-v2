export type CursorPageParameters = Readonly<{
  limit: number;
  cursor: string | null;
  status?: readonly string[] | null;
  outstandingOnly?: boolean | null;
}>;

export type FormalOrderPageParameters = CursorPageParameters & Readonly<{
  marketplace: string | null;
  productName: string | null;
  reviewType: string | null;
  confirmedBusinessDate: string | null;
  formalOrderId: string | null;
  amazonOrderNumber: string | null;
}>;

const page = (parameters: CursorPageParameters) => Object.freeze({
  limit: parameters.limit,
  cursor: parameters.cursor,
  ...(parameters.status && parameters.status.length > 0
    ? { status: [...parameters.status].sort() }
    : {}),
  ...(parameters.outstandingOnly ? { outstandingOnly: true } : {}),
});

const formalPage = (parameters: FormalOrderPageParameters) => Object.freeze({
  limit: parameters.limit,
  cursor: parameters.cursor,
  marketplace: parameters.marketplace,
  productName: parameters.productName,
  reviewType: parameters.reviewType,
  confirmedBusinessDate: parameters.confirmedBusinessDate,
  formalOrderId: parameters.formalOrderId,
  amazonOrderNumber: parameters.amazonOrderNumber,
});

export const buyerQueryKeys = Object.freeze({
  root: ['buyer'] as const,
  me: () => ['buyer', 'me'] as const,
  demandsRoot: ['buyer', 'demands'] as const,
  demandsPage: (parameters: CursorPageParameters) => ['buyer', 'demands', 'page', page(parameters)] as const,
  demand: (id: string) => ['buyer', 'demands', 'detail', id] as const,
  reservationsRoot: ['buyer', 'reservations'] as const,
  reservationsPage: (parameters: CursorPageParameters) => ['buyer', 'reservations', 'page', page(parameters)] as const,
  reservation: (id: string) => ['buyer', 'reservations', 'detail', id] as const,
  instructionState: (id: string) => ['buyer', 'instructions', id, 'state'] as const,
  instruction: (id: string, version: number) => ['buyer', 'instructions', id, 'content', version] as const,
  evidenceEligibleRoot: ['buyer', 'order-evidence', 'eligible'] as const,
  evidenceEligiblePage: (parameters: CursorPageParameters) => ['buyer', 'order-evidence', 'eligible', 'page', page(parameters)] as const,
  evidenceListRoot: ['buyer', 'order-evidence', 'list'] as const,
  evidenceListPage: (parameters: CursorPageParameters) => ['buyer', 'order-evidence', 'list', 'page', page(parameters)] as const,
  evidence: (id: string) => ['buyer', 'order-evidence', 'detail', id] as const,
  formalOrdersRoot: ['buyer', 'formal-orders'] as const,
  formalOrdersPage: (parameters: FormalOrderPageParameters) => ['buyer', 'formal-orders', 'page', formalPage(parameters)] as const,
  formalOrder: (id: string) => ['buyer', 'formal-orders', 'detail', id] as const,
  reviewEligibleRoot: ['buyer', 'reviews', 'eligible'] as const,
  reviewEligiblePage: (parameters: CursorPageParameters) => ['buyer', 'reviews', 'eligible', 'page', page(parameters)] as const,
  reviewsRoot: ['buyer', 'reviews', 'list'] as const,
  reviewsPage: (parameters: CursorPageParameters) => ['buyer', 'reviews', 'list', 'page', page(parameters)] as const,
  review: (id: string) => ['buyer', 'reviews', 'detail', id] as const,
  refundsRoot: ['buyer', 'refunds'] as const,
  refundsPage: (parameters: CursorPageParameters) => ['buyer', 'refunds', 'page', page(parameters)] as const,
  refund: (id: string) => ['buyer', 'refunds', 'detail', id] as const,
});

export function cursorQuery(parameters: CursorPageParameters): string {
  const search = new URLSearchParams({ limit: String(parameters.limit) });
  if (parameters.cursor !== null) search.set('cursor', parameters.cursor);
  if (parameters.status && parameters.status.length > 0) {
    search.set('status', parameters.status.join(','));
  }
  if (parameters.outstandingOnly) search.set('outstanding_only', 'true');
  return search.toString();
}

export function formalOrderQuery(parameters: FormalOrderPageParameters): string {
  const search = new URLSearchParams({ limit: String(parameters.limit) });
  if (parameters.cursor !== null) search.set('cursor', parameters.cursor);
  const optional = [
    ['marketplace', parameters.marketplace],
    ['product_name', parameters.productName],
    ['review_type', parameters.reviewType],
    ['confirmed_business_date', parameters.confirmedBusinessDate],
    ['formal_order_id', parameters.formalOrderId],
    ['amazon_order_number', parameters.amazonOrderNumber],
  ] as const;
  for (const [key, value] of optional) if (value !== null) search.set(key, value);
  return search.toString();
}
