## CI workflow and governance

- [x] Add the independent `browser-e2e` job with Node `24.19.0`, temporary Wrangler/XDG paths, minimal inherited permissions, and no Secrets or remote URLs.
- [x] Preserve lifecycle provenance verification before `npm ci` and use the locked dependency graph.
- [x] Install Chromium with Linux dependencies, build `@ygb/web`, and run `npm run test:browser` in that order.
- [x] Upload Playwright report and test-result artifacts only on failure through the approved SHA-pinned action.
- [x] Extend the final-go verifier and negative tests to enforce the browser job's exact steps, action SHA, command allowlist, and 30-minute timeout.

## OpenSpec and local validation

- [x] Record the 13-spec / 188-test inventory and localhost-only, no-staging/no-production boundary in the Change artifacts.
- [x] Reconcile the first-run fixture/copy/label drift against current runtime, strict DTO contracts and the approved copy record; do not modify business runtime code or relax a schema.
- [x] Run the complete unfiltered Playwright inventory and record its final result: 187 passed, 1 intentional environment-gated visual-review skip, 0 failed.
- [x] Run the final-go verifier and Node tests, OpenSpec target/all strict, workflow checks, Web typecheck/build, repository tests and `git diff --check`.
- [x] Complete Formal Verify, sync the routing-spec deltas, archive this Change, and validate the archived state.
- [x] Do not modify archived Changes or historical evidence or touch staging/production/Cloudflare resources or real data.
- [x] Commit the final scope, open a Draft PR, obtain fixed-SHA independent review and require all three CI jobs to pass before any Ready/merge decision.
