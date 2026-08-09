export const staffWorkbenchKeys = Object.freeze({
  accessManagement: ['staff', 'access-management'] as const,
  sellerPrincipalRatePolicies: (authorizationVersion: number, organizationId: string) =>
    ['staff', 'seller-principal-rate-policies', authorizationVersion, organizationId] as const,
  root: ['staff', 'workbench'] as const,
  queueRoot: ['staff', 'workbench', 'queue'] as const,
  productsRoot: ['staff', 'products'] as const,
  products: (authorizationVersion: number, search: string, cursor: string|null) =>
    ['staff', 'products', authorizationVersion, 'list', search, cursor] as const,
  product: (authorizationVersion: number, id: string) =>
    ['staff', 'products', authorizationVersion, 'detail', id] as const,
  reservationSchedule: (authorizationVersion: number, id: string, cursor: string|null) =>
    ['staff', 'products', authorizationVersion, 'reservation-schedule', id, cursor] as const,
  queue: (status: string, workType: string | null, cursor: string | null) =>
    ['staff', 'workbench', 'queue', status, workType, cursor] as const,
  demandReview: (id: string) => ['staff', 'workbench', 'demand-review', id] as const,
  orderEvidence: (id: string) => ['staff', 'workbench', 'order-evidence', id] as const,
  review: (id: string) => ['staff', 'workbench', 'review', id] as const,
  refund: (id: string) => ['staff', 'workbench', 'refund', id] as const,
  settlement: (id: string) => ['staff', 'workbench', 'settlement', id] as const,
  payables: (id: string) => ['staff', 'workbench', 'settlement', id, 'payables'] as const,
  payments: (id: string) => ['staff', 'workbench', 'settlement', id, 'payments'] as const,
  acquisition: ['staff', 'acquisition'] as const,
  acquisitionChannels: ['staff', 'acquisition', 'channels'] as const,
  acquisitionAssignments: ['staff', 'acquisition', 'assignments'] as const,
  acquisitionConsultations: (from: string, to: string) => ['staff', 'acquisition', 'consultations', from, to] as const,
  acquisitionConsultationHistory: (id: string) => ['staff', 'acquisition', 'consultations', id, 'history'] as const,
  acquisitionLeads: (type: string|null) => ['staff', 'acquisition', 'leads', type] as const,
  acquisitionFunnel: (from: string, to: string) => ['staff', 'acquisition', 'funnel', from, to] as const,
  adminDashboard: ['staff', 'admin-business-dashboard'] as const,
  adminDashboardSummary: (authorizationVersion: number, window: string) =>
    ['staff', 'admin-business-dashboard', authorizationVersion, 'summary', window] as const,
  adminDashboardTrend: (authorizationVersion: number, from: string, to: string, granularity: string) =>
    ['staff', 'admin-business-dashboard', authorizationVersion, 'trend', from, to, granularity] as const,
  adminDashboardDrillDown: (authorizationVersion: number, metric: string, from: string, to: string, cursor: string|null) =>
    ['staff', 'admin-business-dashboard', authorizationVersion, 'drill-down', metric, from, to, cursor] as const,
});
