export class StaffAssignmentError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'IDEMPOTENCY_CONFLICT'
      | 'NO_ELIGIBLE_ASSIGNEE'
      | 'OWNER_FALLBACK_NOT_CONFIGURED'
      | 'OWNER_FALLBACK_INVALID'
      | 'ASSIGNMENT_STATE_CONFLICT'
      | 'WORK_ITEM_STATE_CONFLICT'
      | 'BATCH_STATE_CONFLICT'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'StaffAssignmentError';
  }
}

export function normalizeStaffAssignmentError(
  error: unknown,
): StaffAssignmentError {
  if (error instanceof StaffAssignmentError) return error;
  const record = error as { code?: unknown };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new StaffAssignmentError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new StaffAssignmentError('REQUEST_IN_PROGRESS', 409);
  }
  const message = String(error);
  if (message.includes('invalid_assignment_reason')
    || message.includes('invalid_assignment_identifier')) {
    return new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  if (message.includes('staff_assignment_cursor_version_conflict')
    || message.includes('UNIQUE constraint failed: buyer_staff_assignments')
    || message.includes('UNIQUE constraint failed: seller_staff_assignments')) {
    return new StaffAssignmentError('VERSION_CONFLICT', 409);
  }
  if (message.includes('uq_staff_work_item_open_source')
    || message.includes('staff_work_items.source_entity_type')) {
    return new StaffAssignmentError('WORK_ITEM_STATE_CONFLICT', 409);
  }
  if (message.includes('transaction_assertion_failed')) {
    return new StaffAssignmentError('VERSION_CONFLICT', 409);
  }
  return new StaffAssignmentError('DEPENDENCY_UNAVAILABLE', 503);
}
