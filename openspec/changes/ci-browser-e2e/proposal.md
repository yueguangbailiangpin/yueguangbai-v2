# Change: Run the Local Playwright Suite in GitHub CI

## Why

The repository already has 13 Playwright specs covering the Web journeys, but the two existing CI jobs do not execute them. A separate browser job makes those checks part of every Pull Request and `main` push without mixing Chromium resource usage into the repository test/build job.

## What Changes

- Add one independent `browser-e2e` job to `.github/workflows/ci.yml`.
- Keep the job on Node `24.19.0`, with the same pre-install lifecycle provenance proof and temporary Wrangler/XDG directories as the existing jobs.
- Install Chromium and its Linux dependencies, build `@ygb/web`, and run the root `npm run test:browser` script.
- Upload Playwright report and test-result directories only after a failure, using a fixed SHA-pinned artifact action.
- Extend the local final-go workflow verifier so the new job has an explicit, narrow command and action allowlist.
- Repair five stale Playwright fixture/copy/label expectations exposed by the first complete run, without changing business runtime code or weakening strict response schemas.
- Synchronize the two canonical routing requirements with the already approved and implemented dedicated-link copy.
- Record the 13 specs / 188 expanded tests and localhost-only boundary in this Change.

## Non-Goals

- No business code, API, D1 schema, migration, staging configuration, production configuration, Secrets, DNS, Cloudflare resource, or real data changes.
- No staging or production URL, authentication session, secret, or remote service is used by this CI job.
- No changes to archived OpenSpec Changes or historical evidence.

## Rollback

Revert the workflow, root browser script, verifier extension, governance wording, and this active Change. Existing static and repository test/build jobs remain independently usable.
