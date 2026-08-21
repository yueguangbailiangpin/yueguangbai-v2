export type StaffAccessManagementErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'STATE_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'DEPENDENCY_UNAVAILABLE';

export class StaffAccessManagementError extends Error {
  constructor(
    public readonly code: StaffAccessManagementErrorCode,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 503,
    public readonly details: unknown = null,
  ) {
    super(code);
    this.name = 'StaffAccessManagementError';
  }
}
