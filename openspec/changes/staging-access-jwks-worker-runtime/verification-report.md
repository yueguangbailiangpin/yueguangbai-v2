# Verification Report: Staging Access JWKS Worker Runtime

Date: 2026-08-16

## Scope

This report verifies only the Cloudflare Access JWKS runtime compatibility repair. It does not claim T9 A-H acceptance, T10 recovery or Production GO.

## Reproduction evidence

- Real staging tail: `POST /api/staff-auth/access/bootstrap` reached the Worker.
- Both `Cf-Access-Jwt-Assertion` and authenticated-email headers were present.
- Bootstrap failed closed with reason `JWKS_FETCH`.
- The deployed Access team-domain, audience, allowed-origin, application-origin and release-SHA bindings matched the managed staging configuration.
- The exact configured public certificate endpoint returned HTTP 200 from an independent read-only probe.

Raw request identifiers, provider identifiers, email values and managed configuration remain Git-external.

## Implementation evidence

- The fixed team JWKS subrequest uses `redirect: 'manual'`.
- Any redirect remains non-2xx and is rejected by the existing `response.ok` guard.
- Exact issuer, audience, time, RS256, key-ID, bounded response and signature validation are unchanged.

## Executed checks

- Focused Cloudflare Access test: 1 file, 4 tests passed.
- Staff authentication production check: 3 files, 15 tests passed; API/contracts typechecks passed.
- Full repository `npm run check`: 254 test files and 1,711 tests passed.
- OpenSpec strict: 74/74 items passed.
- Secret scan: 1,696 project files passed.
- Migrations: 0001-0070 continuous, Schema 70, integrity `ok`, zero foreign-key errors.
- Workspace typechecks, builds and static web build verification passed.
- `git diff --check` passed.

## Remaining external gate

The merged fixed SHA must be deployed only to the isolated staging Worker. An authenticated Owner bootstrap and session read must pass before T9 resumes. Production remains `NO_GO`.
