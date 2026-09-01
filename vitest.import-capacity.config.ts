import { defineConfig } from 'vitest/config';

// Historical-import capacity verification runs on demand via
// `npm run verify:historical-import-capacity` and is excluded from the
// normal suites: 20,000 orders + 100,000 file plans (import) and 100,000+
// physical image files (inventory) each take tens of seconds.
export default defineConfig({
  test: {
    include: [
      'tools/imports/historical-order-importer/import-capacity.verify.ts',
      'tools/imports/historical-order-importer/image-inventory-capacity.verify.ts',
    ],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    environment: 'node',
  },
});
