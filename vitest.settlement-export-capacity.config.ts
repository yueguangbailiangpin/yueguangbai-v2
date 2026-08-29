import { defineConfig } from 'vitest/config';

// Stage 7.5R capacity verification: a settlement batch at the exact
// 5,000-member export ceiling against the real staff export route. Excluded
// from the normal *.test.* suites; run via `npm run verify:settlement-export-capacity`.
export default defineConfig({
  test: {
    include: ['apps/api/src/seller-settlements/settlement-export.capacity.verify.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    environment: 'node',
  },
});
