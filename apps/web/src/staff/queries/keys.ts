export const staffWorkbenchKeys = Object.freeze({
  root: ['staff', 'workbench'] as const,
  queue: (status: string, workType: string | null, cursor: string | null) => ['staff', 'workbench', 'queue', status, workType, cursor] as const,
  orderEvidence: (id: string) => ['staff', 'workbench', 'order-evidence', id] as const,
  review: (id: string) => ['staff', 'workbench', 'review', id] as const,
  refund: (id: string) => ['staff', 'workbench', 'refund', id] as const,
  settlement: (id: string) => ['staff', 'workbench', 'settlement', id] as const,
  payables: (id: string) => ['staff', 'workbench', 'settlement', id, 'payables'] as const,
  payments: (id: string) => ['staff', 'workbench', 'settlement', id, 'payments'] as const,
});
