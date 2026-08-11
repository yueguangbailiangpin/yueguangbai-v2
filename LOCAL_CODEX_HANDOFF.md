# LOCAL CODEX HANDOFF

Branch: `feature/frozen-portals-staff-acquisition-core`
Baseline: `d621513b8dfe7450e0af7f278cbfb17d9616b00f`
Current target schema: **64**

You are the integration/test owner, not the product designer.

Read, in order:
1. `FINAL_SCHEMA64_CODEX_HANDOFF.md`
2. `LATEST_CODEX_HANDOFF.md`
3. `docs/CODE_INTEGRITY_CLEANUP_FREEZE.md`
4. `docs/SECOND_LAYER_HARDENING_FREEZE.md`
5. `docs/OPERATING_INTEGRITY_FREEZE.md`
6. remaining onboarding/privacy/product freeze docs referenced by LATEST.

Run real clean-checkout migration/typecheck/Vitest/build/Playwright/historical-D1 tests. Fix compile, migration, contract, browser, accessibility and historical-data drift only. Do not restore stale behavior for old tests. Do not merge main, run production migration, deploy, or modify production Cloudflare configuration without explicit approval.
