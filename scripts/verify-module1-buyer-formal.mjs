import { existsSync } from 'node:fs';
import { assert, filesUnder, read, relative, report } from './wave13-verifier-lib.mjs';

const change = 'openspec/changes/module1-buyer-complete-business-loop';
const mappings = Object.freeze({
  'buyer-demand-reservation': [
    'apps/web/src/buyer/demands/BuyerDemandsPage.tsx',
    'apps/web/src/buyer/demands/BuyerDemandDetailPage.tsx',
    'apps/web/src/buyer/reservations/BuyerReservationDetailPage.tsx',
    'apps/web/e2e/module1-buyer.spec.ts',
  ],
  'buyer-formal-orders': [
    'migrations/0028_buyer_amazon_order_date.sql',
    'apps/api/src/buyer-formal-orders/read-model.ts',
    'apps/web/src/buyer/formal-orders/BuyerFormalOrderDetailPage.tsx',
    'apps/api/src/module1-migration-0028.test.ts',
  ],
  'buyer-mobile-accessibility': [
    'apps/web/src/styles/global.css',
    'apps/web/src/ui/primitives.tsx',
    'apps/web/e2e/module1-buyer.spec.ts',
  ],
  'buyer-order-evidence': [
    'packages/contracts/src/order-evidence.ts',
    'packages/domain/src/time/date-only.ts',
    'apps/api/src/buyer-order-evidence-portal/routes.ts',
    'apps/web/src/buyer/order-evidence/BuyerOrderEvidenceFormPage.tsx',
    'apps/api/src/buyer-order-evidence-portal/buyer-order-evidence-portal.test.ts',
  ],
  'buyer-order-instruction': [
    'apps/api/src/order-instructions/routes.ts',
    'apps/web/src/buyer/instructions/BuyerInstructionPage.tsx',
    'apps/web/src/files/file-read-providers.msw.test.ts',
    'apps/web/e2e/module1-buyer.spec.ts',
  ],
  'buyer-refund-status': [
    'packages/contracts/src/buyer-refund-portal.ts',
    'apps/api/src/buyer-refund-status/read-model.ts',
    'apps/web/src/buyer/refunds/BuyerRefundDetailPage.tsx',
    'apps/web/e2e/module1-buyer.spec.ts',
  ],
  'buyer-registration-profile': [
    'apps/api/src/buyer-self-registration/routes.ts',
    'apps/web/src/buyer/registration/registration.ts',
    'apps/web/src/buyer/registration/registration.msw.test.ts',
    'apps/web/e2e/module1-buyer.spec.ts',
  ],
  'buyer-review-workflow': [
    'apps/api/src/buyer-reviews/routes.ts',
    'apps/web/src/buyer/reviews/BuyerReviewFormPage.tsx',
    'apps/web/src/buyer/reviews/BuyerReviewDetailPage.tsx',
    'apps/web/e2e/module1-buyer.spec.ts',
  ],
  'buyer-routing-dashboard': [
    'apps/web/src/App.tsx',
    'apps/web/src/buyer/routes/BuyerLayout.tsx',
    'apps/web/src/buyer/dashboard/tasks.test.ts',
    'apps/web/e2e/module1-buyer.spec.ts',
  ],
  'buyer-testing-quality': [
    'scripts/verify-module1-buyer-security.mjs',
    'scripts/verify-module1-migration-0028.mjs',
    'apps/web/e2e/module1-buyer.spec.ts',
    'openspec/changes/module1-buyer-complete-business-loop/tasks.md',
  ],
});

let requirements = 0;
let scenarios = 0;
const mapped = [];
for (const absolute of filesUnder(`${change}/specs`, (path) => path.endsWith('/spec.md'))) {
  const path = relative(absolute);
  const capability = path.split('/').at(-2);
  const source = read(path);
  const requirementTitles = [...source.matchAll(/^### Requirement: (.+)$/gmu)].map((match) => match[1]);
  const scenarioTitles = [...source.matchAll(/^#### Scenario: (.+)$/gmu)].map((match) => match[1]);
  assert(requirementTitles.length > 0 && scenarioTitles.length === requirementTitles.length * 2,
    `${capability} must keep exact two-scenario requirement structure`);
  const evidence = mappings[capability];
  assert(evidence !== undefined && evidence.length >= 3, `${capability} has no formal evidence mapping`);
  for (const evidencePath of evidence) assert(existsSync(evidencePath), `${capability} missing evidence: ${evidencePath}`);
  requirements += requirementTitles.length;
  scenarios += scenarioTitles.length;
  mapped.push({ capability, requirements: requirementTitles.length, scenarios: scenarioTitles.length, evidence });
}
assert(Object.keys(mappings).length === 10 && mapped.length === 10, 'formal capability count must be 10');
assert(requirements === 58, `formal requirement count changed: ${requirements}`);
assert(scenarios === 116, `formal scenario count changed: ${scenarios}`);
const tasks = read(`${change}/tasks.md`);
assert(tasks.includes('COMPLETE=58') && tasks.includes('Scenarios=116/116'), 'tasks lack final formal verification result');

report('module1-buyer-formal', {
  COMPLETE: requirements,
  INCONSISTENT: 0,
  MISSING: 0,
  PARTIAL: 0,
  NOT_VERIFIED: 0,
  CRITICAL: 0,
  WARNING: 0,
  SUGGESTION: 0,
  Scenarios: `${scenarios}/${scenarios}`,
  mappings: mapped,
});
