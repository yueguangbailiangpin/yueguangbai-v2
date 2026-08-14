# ci-browser-e2e Specification

## Purpose

Provide independent GitHub CI evidence for the existing local Web Playwright suite while preserving the repository's install provenance, action pinning, and no-remote-operation boundaries.

## ADDED Requirements

### Requirement: Independent browser CI execution

The CI workflow SHALL run a separate `browser-e2e` job on Pull Requests and `main` pushes with Node `24.19.0`, a 30-minute timeout, workflow-level `contents: read` only, runner-temporary Wrangler/XDG directories, and no job Secrets or environment that targets staging or production.

#### Scenario: Browser job is isolated from repository tests

- **WHEN** the CI workflow runs `static-governance`, `tests-and-build`, and `browser-e2e`
- **THEN** `browser-e2e` runs as its own `ubuntu-latest` job and does not add Chromium work to `tests-and-build`

#### Scenario: Install provenance precedes npm install

- **WHEN** `browser-e2e` reaches dependency installation
- **THEN** it runs the committed lifecycle provenance verifier and Node self-test before `npm ci`, with no `--ignore-scripts` bypass

### Requirement: Local Playwright suite and failure evidence

The browser job SHALL install Chromium with its Linux dependencies, build `@ygb/web`, run `npm run test:browser`, and upload both `apps/web/playwright-report` and `apps/web/test-results` only after a failed job using the fixed SHA-pinned `actions/upload-artifact` v4.6.2 action.

#### Scenario: Complete suite uses only the local preview

- **WHEN** the browser job runs the current Playwright inventory
- **THEN** it executes 13 spec files expanding to 188 tests against the validated loopback base URL and does not navigate to staging or production

#### Scenario: Failure artifacts are bounded

- **WHEN** Chromium installation, Web build, or Playwright execution fails
- **THEN** the job attempts one seven-day artifact upload for the report and test-result directories, ignoring absent files without masking the failed job
