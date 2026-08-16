# Verification Report: Staging Access JWKS Public Fetch

Date: 2026-08-16

## Scope

This report covers only the Cloudflare Workers routing contract required by the existing Staff Access JWKS validation. It does not claim authenticated staging bootstrap, any T9 A-H item, T10 recovery or Production GO.

## Evidence and decision

- The previously merged `redirect: 'manual'` repair remained deployed when real staging again failed closed with `JWKS_FETCH`.
- The Worker received the Access assertion and authenticated-email headers; the configured public JWKS endpoint separately returned HTTP 200.
- Cloudflare's current Fetch documentation states that Worker-to-Worker global `fetch()` requires a Service binding or `global_fetch_strictly_public`.
- Cloudflare's Access documentation identifies the configured team-domain `/cdn-cgi/access/certs` endpoint as the public signing-key source.
- The API source audit found one global outbound `fetch()`: the exact configured Access JWKS request. Other outbound fetch operations use explicit bindings.

Provider identifiers, request identifiers, identities and managed configuration remain Git-external.

## Implementation evidence

- Staging and production deployment templates require exactly `global_fetch_strictly_public`.
- Release preflight rejects a missing flag, `global_fetch_private_origin` and any expanded flag set.
- The static Cloudflare release verifier independently asserts the exact template contract.
- The Git-external staging rendering passes the same preflight. No remote deploy occurred during local verification.
- Production template parity is repository-only; production was not queried or deployed.

## Executed checks

- Focused release-preflight test: 1 file, 23 tests passed.
- Static Cloudflare release verifier: PASS; external acceptance remains `UNVERIFIED`, Production GO remains `NO_GO`.
- Full repository `npm run check`: 254 test files and 1,713 tests passed.
- OpenSpec strict: 75/75 items passed.
- Secret scan: 1,702 project files passed.
- Migrations: 0001-0070 continuous, Schema 70, integrity `ok`, zero foreign-key errors.
- Workspace typechecks, builds, Cloudflare dry-run and static web build verification passed.
- `git diff --check` passed.

## Remaining external gate

Publish and independently review the fixed SHA, ordinarily merge it, update only the Git-external staging release rendering to the merge SHA, and deploy only the existing staging Worker. A real authenticated Owner bootstrap and session read must pass before the canonical 67-item T9 register resumes. Production remains `NO_GO`.
