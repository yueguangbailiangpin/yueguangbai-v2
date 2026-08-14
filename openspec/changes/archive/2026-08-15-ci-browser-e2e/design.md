# Design: Isolated Local Playwright CI Job

## Boundary

`browser-e2e` is a third job rather than an extra step in `tests-and-build`. It runs on its own `ubuntu-latest` runner with a 30-minute timeout, so Chromium processes and the Vite preview do not compete with the full Vitest/build workload in the existing job. The timeout is a bounded CI budget selected after measuring the complete local suite and retaining headroom for a slower hosted runner.

The job has no job-level permissions or environment and inherits only the workflow's `contents: read`. It declares no Secrets, remote URL, Cloudflare binding, Access session, or staging/production variable. The Playwright config fixes the base URL to `http://127.0.0.1:<validated-port>` and starts a local Vite preview.

## Execution order

1. Checkout with the repository's fixed `actions/checkout` SHA.
2. Create runner-temporary Wrangler/XDG directories.
3. Set up Node `24.19.0` with npm cache keyed by `package-lock.json`.
4. Run lifecycle provenance verifier and its Node self-test before `npm ci`.
5. Install the locked dependency graph with `npm ci`.
6. Run `npx playwright install --with-deps chromium`.
7. Build only the `@ygb/web` workspace.
8. Run `npm run test:browser`, which executes the 13 specs with the line and HTML reporters (`playwright test -c apps/web/playwright.config.ts --reporter=line,html`). The HTML reporter materializes `apps/web/playwright-report` for failure evidence.
9. On failure, upload `apps/web/playwright-report` and `apps/web/test-results` with `actions/upload-artifact` commit `ea165f8d65b6e75b540449e92b4886f43607fa02` (`v4.6.2`), seven-day retention, and ignore-if-empty behavior.

The final-go verifier models this exact order and rejects alternate action SHAs, extra commands, remote Wrangler commands, shell indirection, secrets, or an unapproved Playwright command. The existing two jobs retain their six-step canonical contract.

## Test scope and evidence

The current `playwright --list` inventory expands to 13 spec files and 188 tests. All browser navigation is relative to the local base URL; fixtures and mocked API responses are local test data. CI therefore proves browser behavior against the built local application only. It does not prove staging Access, remote D1/R2, DNS, Secrets, Scheduler, or production behavior.

The first complete local run exposed 13 existing failures: seven refund and task surfaces rejected fixtures that predated the required T7 `reminder` projection, while six assertions used Chinese copy or form labels that had already been approved and implemented. The repair is limited to five Playwright spec files: fixtures now satisfy the unchanged strict refund schema, and assertions now match the current runtime. No business runtime or API contract was loosened. Two canonical routing requirements are also corrected from the superseded root copy to the already approved dedicated-link copy so tests, runtime and specification no longer disagree.

After those corrections, the complete local inventory finished with 187 passed, 1 intentional environment-gated visual-review skip, and 0 failed in about 1.2 minutes. The 30-minute job budget therefore has substantial measured headroom while leaving room for a slower hosted runner and Chromium dependency setup. The CI command does not filter the suite or convert failures into success.

## Rejected alternatives

- Adding Playwright to `tests-and-build` was rejected because it would couple Chromium startup, preview-server lifetime, and visual matrix work to the existing 25-minute repository test/build budget.
- Reusing `test:wave14a:browser` was rejected because that script rebuilds Web and would duplicate the explicit CI build step; `test:browser` keeps the CI order visible and performs one Web build.
- Unpinned or tag-only artifact actions were rejected because the repository's CI policy requires auditable SHA-pinned actions.
- Running against staging or production was rejected because this Change is local CI evidence, not remote environment acceptance.
