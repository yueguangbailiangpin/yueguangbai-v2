import { defineConfig } from 'vitest/config';

// Stage 7.5 batch 1 capacity verification: 20,000 historical orders plus 200
// same-day orders against the real staff order list route. Excluded from the
// normal *.test.* suites; run via `npm run verify:order-list-capacity`.
export default defineConfig({
  test: {
    include: [
      'apps/api/src/staff-order-detail/order-list.capacity.verify.ts',
      'apps/api/src/staff-order-detail/staff-order-list-multimarket-index.test.ts',
    ],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    environment: 'node',
  },
});
