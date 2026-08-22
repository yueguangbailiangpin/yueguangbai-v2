export const staffWorkbenchKeys = Object.freeze({
  accessManagement: ['staff', 'access-management'] as const,
  sellerPrincipalRatePolicies: (
    authorizationVersion: number,
    organizationId: string | null,
    asOf: number | null = null,
  ) =>
    ['staff', 'seller-principal-rate-policies', authorizationVersion, organizationId, asOf] as const,
  rateCenter: (
    authorizationVersion: number,
    businessDate: string,
    organizationId: string | null,
    asOf: number | null = null,
  ) =>
    ['staff', 'rate-center', authorizationVersion, businessDate, organizationId, asOf] as const,
  sellerServiceFees: (
    authorizationVersion: number,
    organizationId: string,
    asOf: number | null = null,
  ) =>
    ['staff', 'seller-service-fees', authorizationVersion, organizationId, asOf] as const,
  root: ['staff', 'workbench'] as const,
  queueRoot: ['staff', 'workbench', 'queue'] as const,
  productsRoot: ['staff', 'products'] as const,
  products: (authorizationVersion: number, search: string, cursor: string | null) =>
    ['staff', 'products', authorizationVersion, 'list', search, cursor] as const,
  product: (authorizationVersion: number, id: string) =>
    ['staff', 'products', authorizationVersion, 'detail', id] as const,
  reservationSchedule: (authorizationVersion: number, id: string, cursor: string | null) =>
    ['staff', 'products', authorizationVersion, 'reservation-schedule', id, cursor] as const,
  queue: (
    staffId: string,
    authorizationVersion: number,
    sessionVersion: number,
    effectiveScopeFingerprint: string,
    status: string,
    workType: string | null,
    cursor: string | null,
  ) =>
    [
      'staff',
      'workbench',
      'queue',
      staffId,
      authorizationVersion,
      sessionVersion,
      effectiveScopeFingerprint,
      status,
      workType,
      cursor,
    ] as const,
  demandReview: (id: string) => ['staff', 'workbench', 'demand-review', id] as const,
  workItem: (id: string) => ['staff', 'workbench', 'work-item', id] as const,
  productApplicationReview: (id: string) =>
    ['staff', 'workbench', 'product-application-review', id] as const,
  reservationReview: (id: string) => ['staff', 'workbench', 'reservation-review', id] as const,
  orderInstruction: (id: string) => ['staff', 'workbench', 'order-instruction', id] as const,
  orderEvidence: (id: string) => ['staff', 'workbench', 'order-evidence', id] as const,
  orderEvidencePreflight: (id: string) =>
    ['staff', 'workbench', 'order-evidence', id, 'preflight'] as const,
  review: (id: string) => ['staff', 'workbench', 'review', id] as const,
  refund: (id: string) => ['staff', 'workbench', 'refund', id] as const,
  settlement: (id: string) => ['staff', 'workbench', 'settlement', id] as const,
  payables: (id: string) => ['staff', 'workbench', 'settlement', id, 'payables'] as const,
  payments: (id: string) => ['staff', 'workbench', 'settlement', id, 'payments'] as const,
  acquisition: ['staff', 'acquisition'] as const,
  acquisitionChannels: ['staff', 'acquisition', 'channels'] as const,
  acquisitionAssignments: ['staff', 'acquisition', 'assignments'] as const,
  acquisitionConsultations: (from: string, to: string) =>
    ['staff', 'acquisition', 'consultations', from, to] as const,
  acquisitionConsultationHistory: (id: string) =>
    ['staff', 'acquisition', 'consultations', id, 'history'] as const,
  acquisitionLeads: (type: string | null) => ['staff', 'acquisition', 'leads', type] as const,
  acquisitionFunnel: (from: string, to: string) =>
    ['staff', 'acquisition', 'funnel', from, to] as const,
});
