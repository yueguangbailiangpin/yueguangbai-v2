export type RouteGroup = 'health' | 'api' | 'other';

export type ErrorCategory =
  | 'unhandled_exception'
  | 'handled_server_error';

export interface ErrorLogEvent {
  event: 'worker_error';
  request_id: string;
  method: string;
  route_group: RouteGroup;
  status: number;
  error_category: ErrorCategory;
  cf_ray: string | null;
}

export function routeGroup(pathname: string): RouteGroup {
  if (pathname === '/health') return 'health';
  if (pathname === '/api' || pathname.startsWith('/api/')) return 'api';
  return 'other';
}

export function errorLogEvent(
  input: Omit<ErrorLogEvent, 'event'>,
): ErrorLogEvent {
  return { event: 'worker_error', ...input };
}

export function writeErrorLog(event: ErrorLogEvent): void {
  // Deliberately log a strict allow-list. Never include raw errors, request
  // bodies, credentials, customer identifiers, or stack traces here.
  console.error(JSON.stringify(event));
}
