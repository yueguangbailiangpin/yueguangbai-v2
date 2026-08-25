import { defineConfig } from 'vitest/config';

// Capacity verification runs on demand via `npm run verify:archive-capacity`
// and is deliberately excluded from the normal *.test.* suites: seeding
// 20,000 orders and 100,000 file manifests takes tens of seconds.
export default defineConfig({
  test: {
    include: ['apps/api/src/cold-image-archive/capacity.verify.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    environment: 'node',
  },
});
